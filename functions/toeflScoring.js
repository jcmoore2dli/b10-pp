"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// B10-PP · functions/toeflScoring.js
// TOEFL submission scoring trigger — data model v1.16, Collection 3.
//
// ONE trigger, ONE dispatch table, MANY task types. This is deliberately not an
// MCQ-only function: EM/DISC/INT scoring is the same trigger pattern arriving
// Wednesday, and CTW/BAS/LAR after that. Adding a type means writing its scorer
// and registering it in SCORERS below — nothing else in this file changes.
//
// SECURITY — the reason this function exists at all (Decision 1, data model
// v1.7+). toeflItems/{itemId}/answerKey/key is unreadable by students. This
// function reaches it via the Admin SDK, which bypasses Firestore rules
// entirely. It is the ONLY place that document's contents are ever read, and
// the only path by which a correct answer or a rationale can reach a student —
// copied onto their own already-submitted toeflSubmissions document, after the
// fact, where reading it is the feedback screen doing its job rather than a
// shortcut around engaging with the item.
// ─────────────────────────────────────────────────────────────────────────────

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const Anthropic = require("@anthropic-ai/sdk");
const {
  EM_RUBRIC_PROMPT,
  DISC_RUBRIC_PROMPT,
  INT_RUBRIC_PROMPT,
} = require("./lib/toeflLayerABPrompts");
// LAR's comparer. Deterministic and self-contained — no network, no model
// call, no Firestore. Stages 01-06 with their own suite (npm run test:lar).
const { compareLAR } = require("./lib/lar");
// Modular import deliberately: under the functions emulator, the namespaced
// admin.firestore.FieldValue is undefined (the runtime wraps admin.firestore
// without carrying its statics). This form is unaffected, and is the v13
// recommendation regardless. See CLAUDE.md, "Functions emulator note".
const { FieldValue } = require("firebase-admin/firestore");

// Same secret already used by B10-PP's own Claude routes in index.js.
// defineSecret is keyed by name, so declaring it here binds the same secret,
// it does not create a second one.
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
// Same for Deepgram: B10-PP's Pass 1 key, bound by name, not a second secret.
const DEEPGRAM_API_KEY = defineSecret("DEEPGRAM_API_KEY");
const { TRANSCRIBERS } = require("./lib/toeflTranscription");

// ── Scorers ───────────────────────────────────────────────────────────────────

// The five MCQ types share one renderer and one scorer (data model Collection 1).
//
// Deterministic, no AI call: compare each selectedOptionId against the private
// correctOptionId and copy the rationales back. Cheap and fast — but still
// server-side, because as of v1.7 the client physically cannot compute this.
async function scoreMcq(db, { submissionId, submission, itemId }) {
  // Exactly one answer-key document per item, at the literal ID "key" (data
  // model v1.16 — the {key} notation in the rules file names the wildcard
  // parameter, not the document ID). Fetched directly by ID: unlike a
  // .limit(1) query, this cannot quietly return the wrong document if a second
  // one ever lands in the subcollection.
  const keyRef = db
    .collection("toeflItems")
    .doc(itemId)
    .collection("answerKey")
    .doc("key");

  const keySnap = await keyRef.get();

  // get() on a missing document resolves rather than rejecting — the snapshot
  // just has .exists === false. The loud failure is raised here deliberately;
  // without this check a missing key would surface later as an opaque
  // "cannot read properties of undefined" on answerKey.questions.
  if (!keySnap.exists) {
    throw new Error(
      `answerKey document missing at toeflItems/${itemId}/answerKey/key`
    );
  }

  const answerKey = keySnap.data();
  logger.info("scoreMcq: answer key loaded", { submissionId, itemId });

  if (!Array.isArray(answerKey.questions)) {
    throw new Error(`answerKey for ${itemId} has no questions array`);
  }

  const keyByIndex = new Map(
    answerKey.questions.map((k) => [k.questionIndex, k])
  );

  const answers = submission.responseContent?.answers;
  if (!Array.isArray(answers)) {
    throw new Error(
      `submission ${submissionId} has no responseContent.answers array`
    );
  }

  // Exactly the v1.16 perQuestionResults shape:
  //   {questionIndex, selectedOptionId, correctOptionId, isCorrect, rationales}
  const perQuestionResults = answers.map((answer) => {
    const keyEntry = keyByIndex.get(answer.questionIndex);
    if (!keyEntry) {
      throw new Error(
        `answerKey for ${itemId} has no entry for questionIndex ${answer.questionIndex}`
      );
    }
    return {
      questionIndex: answer.questionIndex,
      selectedOptionId: answer.selectedOptionId,
      correctOptionId: keyEntry.correctOptionId,
      isCorrect: answer.selectedOptionId === keyEntry.correctOptionId,
      rationales: keyEntry.rationales ?? [],
    };
  });

  return { perQuestionResults };
}

// ── Layer A/B scoring — constructed response (INT/EM/DISC) ────────────────────
//
// Governing docs: LayerAB_Scoring_Specification_v1_0.md §2/§3.3/§4/§5, plus one
// prompt doc per task type. Each prompt doc's "Trigger-side requirements"
// section is the spec for the code below, not background for it — the numbered
// comments cite it directly. A branch that trusts model output without these
// checks is not done.
//
// The rubric text itself lives in lib/prompts/, verbatim. It is never edited
// here for wording (CLAUDE.md, Data).

// Same call shape as lib/claudeScorer.js: default-export client, one-shot
// messages.create, temperature 0 (index.js Step 5's standing rule). Model held
// deliberately at the codebase's existing one — JC's call, Sep 9. A newer model
// would rescore the same email differently, and calibration data gathered under
// two models is not comparable.
const LAYER_AB_MODEL = "claude-sonnet-4-6";

// 1024 in claudeScorer, raised here: this payload is a rationale plus up to
// three item/observation/target triples. A response truncated at the cap is
// invalid JSON, which requirement 1 correctly turns into "error" — an
// avoidable one.
const LAYER_AB_MAX_TOKENS = 2048;

// Requirement 3: the label is a constant the trigger owns, not a model choice.
const LAYER_B_LABEL = "practice focus — project diagnostic, not part of the score";

// Requirement 4: instructorConfirmRequired comes from the course calibration
// phase (spec §7 — 100% in course W1–2), never from the model.
//
// JC CHECK: hardcoded true is correct for W1–2 and needs real wiring before
// Week 3's ~1-in-3 sampling and the G4 cut-over rule apply. Nothing in this
// codebase knows the course week today — the authoritative week map is the
// external ISD v1.3.1 file (CLAUDE.md). Tracked, not blocking.
const INSTRUCTOR_CONFIRM_REQUIRED = true;

// Email's closed lists, from TOEFL_Email_Scoring_Prompt_LayerAB_v1_2.md — the
// Layer B feature table and the attention-flag list. Anything not on these
// lists is dropped, not fatal (requirement 3).
const EM_FEATURES = new Set([
  "Elaboration vs. purpose",
  "Required elements",
  "Prompt-copying",
  "Syntactic variety and word choice",
  "Social conventions",
  "Accuracy",
]);
const EM_FLAGS = new Set([
  "ELEMENT_UNADDRESSED",
  "REGISTER_MISMATCH",
  "STIMULUS_BORROWED",
  "INCOMPLETE_DATA",
]);

// Discussion's closed lists, from TOEFL_Discussion_Scoring_Prompt_LayerAB_v1_1.md
// — the Layer B feature table and the attention-flag list. Five features and
// three flags: a different, shorter set than Email's, not a superset. Note
// there is deliberately no "Social conventions" entry — the Discussion rubric
// retires the register/social-conventions item outright ("Retired — do not
// report"), and hedging moves under "Syntactic variety and word choice" as a
// structural resource rather than a politeness one.
const DISC_FEATURES = new Set([
  "Relevance / contribution",
  "Elaboration depth",
  "Prompt-copying",
  "Syntactic variety and word choice",
  "Accuracy",
]);
const DISC_FLAGS = new Set([
  "NO_CONTRIBUTION",
  "STIMULUS_BORROWED",
  "INCOMPLETE_DATA",
]);

// Interview's closed lists, from TOEFL_Interview_Scoring_Prompt_LayerAB_v1_1.md.
// Six features and five flags — the largest set of the three constructed-
// response types, because INT is the only one with delivery evidence to judge
// (Fluency signals, Intelligibility) on top of the text.
const INT_FEATURES = new Set([
  "Elaboration",
  "Prompt-copying",
  "Fluency signals",
  "Intelligibility",
  "Grammar and vocabulary",
  "Organization",
]);
const INT_FLAGS = new Set([
  "DELIVERY_LIMITING",
  "OFF_TOPIC",
  "PROMPT_RECYCLED",
  "INTELLIGIBILITY_UNCERTAIN",
  "INCOMPLETE_DATA",
]);

// INT question types, from the input contract's TYPE enum. The corpus tags its
// questions more richly than the contract does ("Preference + Reason — B2+",
// "Descriptive/Observational — B2 accessible — Indirect framing"), so the
// importer stores the raw tag and this maps it to the contract's four values
// by leading phrase.
//
// The corpus structure is fixed and was verified across all 48 items (192
// tags): exactly 48 of each family, one per position — Q1 Descriptive,
// Q2 Preference-Reason, Q3 Trend-Evaluation, Q4 Prediction-Hypothesis. So the
// prefix mapping is cross-checked against position below, and a disagreement
// is a loud failure rather than a silent mismap. That check is the whole point
// of mapping by prefix instead of by position alone: an item regenerated with
// a reordered question set stays correct, and an unrecognised tag stops the
// import rather than being guessed at.
const INT_TYPE_BY_PREFIX = [
  [/^Descriptive\/Observational/i, "Descriptive"],
  [/^Preference \+ Reason/i, "Preference-Reason"],
  [/^Trend\/Policy Evaluation/i, "Trend-Evaluation"],
  [/^Prediction\/Hypothesis/i, "Prediction-Hypothesis"],
];
const INT_TYPE_BY_POSITION = [
  "Descriptive",
  "Preference-Reason",
  "Trend-Evaluation",
  "Prediction-Hypothesis",
];

// Delivery-evidence divergence, stated in code because it changes what the
// model is shown.
//
// The v1.1 input contract asks for "mean run length: [words between pauses >
// 0.495s]" and "long pauses: [count per minute]". This pipeline cannot produce
// either as specified: computeDisfluencyMetadata() in lib/claudeScorer.js
// measures pauses at 1.5s and 2.5s, never 0.495s, and
// claudeScorer_TOEFL_INTERVIEW_v3_2.md records that the 0.495s figures are
// "unusable as calibration seeds for anything in this pipeline" — the threshold
// is a retired artifact of the old taxonomy.
//
// JC's call, Sep 10: render what the pipeline actually produces and label the
// divergence honestly in the input, rather than hold INT or fabricate a
// 0.495s number. The rendered block therefore names its own thresholds, so the
// model is never silently told it is reading a metric it is not.
//
// OPEN ITEM — NEEDS A REAL OWNER, not just this comment. Reconciling the
// 0.495s contract against the 1.5s/2.5s pipeline is carried to the next Fable
// calibration session as an explicit agenda item (JC, Sep 10). Until then A3
// governs: the evidence is qualitative and "no number in the delivery evidence
// maps to a band", which is what makes rendering different thresholds safe
// rather than score-affecting.
const DELIVERY_PAUSE_THRESHOLDS = { long: 1.5, severe: 2.5 };

// Four questions per Interview attempt, fixed (data model v1.17 —
// interviewClips is the four-clip parent shape; the prompt's OUTPUT requires
// exactly four entries in each array).
const INT_QUESTION_COUNT = 4;

// Seven utterances per LAR item, fixed. The importer's LAR parser enforces it
// (scripts/importToeflCorpus.js — "LAR must have exactly 7 utterances") and the
// comparer's Stage 01 contract asserts it again independently. Declared here so
// a malformed item fails naming the ITEM, rather than deep inside the comparer
// where the error would name a contract.
const LAR_UTTERANCE_COUNT = 7;

// LAR's Layer B closed lists, from LayerAB_Scoring_Specification_v1_0.md §4.
//
// Deterministic, so unlike EM/DISC/INT these are not validating a model's
// output — nothing can invent a feature name here. The closed list still
// governs: it is what the review UI renders, and what the layerA/layerB shape
// promises every consumer.
const LAR_FEATURES = new Set([
  "Content words dropped or changed",
  "Function words dropped or changed",
  "Tense, number, and aspect",
  "Transpositions",
  "Run length and hesitation",
  "Intelligibility",
]);

// LAR's own two flags, NOT the generic set. DELIVERY_LIMITING, OFF_TOPIC and
// PROMPT_RECYCLED have no meaning for a repetition task, and INCOMPLETE_DATA
// cannot arise here: a LAR submission missing its runtime inputs throws as a
// data failure long before Layer B is built.
const LAR_FLAGS = new Set(["INTELLIGIBILITY_UNCERTAIN", "PARTIAL_ATTEMPT"]);

// Four rationales plus up to twelve item/observation/target triples from one
// call — materially more output than EM or DISC. Raised above their 2048 for
// the same reason theirs was raised above claudeScorer's 1024: a response
// truncated at the cap is invalid JSON, and requirement 1 turns that into an
// avoidable "error".
const INT_MAX_TOKENS = 4096;

// ── CTW — Complete the Words ──────────────────────────────────────────────────
//
// Deterministic comparer, no Anthropic call. Same family as scoreMcq, not the
// Layer A/B branches: CTW has exactly one correct exact-letter-string per gap
// (CTW_Content_Spec_v1_2.md §4), so there is nothing for a model to judge.
//
// SCORING IS BINARY PER GAP, NO PARTIAL CREDIT. §4 deferred within-gap partial
// credit to "the platform's scoring implementation"; that confirmation was
// given by JC on Sep 4 and recorded in Data Model v1.12 ("Binary
// correct/incorrect per gap, no partial credit"). CTW_Content_Spec_v1_2.md §4
// and CTW_Review_Prompt_v1_2.md both still carry the open-item language and are
// stale relative to that decision — raised with corpus Sep 10, not this
// function's problem to resolve.
const CTW_GAP_COUNT = 10;

// SEAM 1 — US/UK spelling variants. DECIDED (corpus, Sep 10): accept both.
//
// Corpus's reasoning, recorded because it is a construct judgment: CTW tests
// word-recognition from context, not spelling convention, so rejecting a
// correctly-spelled British variant would test something this task type was
// never built to measure. This is a distinct question from the partial-credit
// one the Sep 4 decision closed — that was "is a near-miss partly right?"
// (no); this is "is a variant spelling a different answer?" (no).
//
// Keyed by the AUTHORED completion; the value lists additionally-acceptable
// completions. Keying by completion makes each entry global across all gaps,
// so the set below was verified against all 530 real imported gaps before
// being written (Sep 10):
//   · the 5 entries hit exactly 7 gaps, matching the 7 identified as exposed —
//     no inert entries, no over-reach
//   · zero gaps carry an authored British completion, so no inverted mapping
//     is needed
//   · the only other completions containing "ise"/"ising"/"isation" are
//     "wise" (otherwise, x2) and "rtisers" (Advertisers), none of which any
//     entry below touches
//
// The 7 gaps covered: organization (CTW-AM-022 g3), revitalization
// (CTW-AM-044 g5), privatization (CTW-BE-006 g7), symbolizing (CTW-AM-046 g3),
// emphasize (CTW-ED-054 g1), specialized (CTW-PT-030 g2), pressurizes
// (CTW-PT-052 g5). Note realized (CTW-HA-025 g6) needs no entry: its "z" sits
// in the given prefix, so the completion is "ed" in either variety.
const CTW_VARIANT_EQUIVALENCE = Object.freeze({
  ization: ["isation"],
  olizing: ["olising"],
  asize: ["asise"],
  ialized: ["ialised"],
  izes: ["ises"],
});

function ctwAcceptableCompletions(correctCompletion) {
  const extra = CTW_VARIANT_EQUIVALENCE[correctCompletion];
  return extra ? [correctCompletion, ...extra] : [correctCompletion];
}

// SEAM 2 — prefix case. DECIDED (JC, Sep 10): case-insensitive.
//
// 43 of 530 authored gaps have a capitalised given part ("Resear" + "chers" =
// "Researchers"). Since responses are whole reconstructed words (decision
// below), the student types that capital. JC's reasoning, recorded because it
// is a construct judgment and not an implementation convenience: CTW tests
// whether the student can supply the correct completing letters, not whether
// they can reproduce an item-authored capital that has nothing to do with
// vocabulary or spelling. "Researchers" and "researchers" represent identical
// knowledge.
//
// Note this applies ONLY to the given prefix. The completion itself is still
// compared case-sensitively — and that costs nothing, because all 530 authored
// completions are purely lowercase [a-z]+ (verified against real imported
// content, Sep 10).
function ctwPrefixMatches(response, givenLetters) {
  return (
    response.length >= givenLetters.length &&
    response.slice(0, givenLetters.length).toLowerCase() ===
      givenLetters.toLowerCase()
  );
}

// SEAM 3 — response shape. DECIDED (JC, Sep 10): the WHOLE reconstructed word,
// not the completion alone.
//
// Data model v1.6 defines responseContent as
// {gapResponses: [{gapIndex, response}, ...]} but never says which of the two
// `response` holds. JC's call: the whole word, because it is what a real CTW
// renderer most naturally produces (the student sees and edits the full word,
// not an isolated fragment) and it makes the stored response self-describing
// without needing the item alongside it to interpret. The comparer strips
// givenLetters itself, which is cheap.
//
// A response that does NOT start with givenLetters is therefore an integration
// mismatch, not a wrong answer, and is reported as such — see below. The CTW
// renderer does not exist yet (Frontend Scaffold v1.10 schedules it
// separately), so silently absorbing a completion-only response as ten wrong
// answers would hide the renderer disagreeing with this decision.
async function scoreCompleteTheWords(db, { submissionId, submission, itemId }) {
  const ctx = { submissionId, taskType: "CTW", itemId };

  const itemRef = db.collection("toeflItems").doc(itemId);
  const itemSnap = await itemRef.get();
  if (!itemSnap.exists) {
    throw new Error(`item document missing at toeflItems/${itemId}`);
  }
  const item = itemSnap.data();

  const keySnap = await itemRef.collection("answerKey").doc("key").get();
  if (!keySnap.exists) {
    throw new Error(
      `answerKey document missing at toeflItems/${itemId}/answerKey/key`
    );
  }
  const answerKey = keySnap.data();

  // Ten gaps on both sides is a hard corpus rule (§3.1, "no exceptions"), so
  // any other count is a data failure rather than a variation to absorb — the
  // same discipline the importer applies when writing these.
  const gaps = item.gaps;
  const keyGaps = answerKey.gaps;
  if (!Array.isArray(gaps) || gaps.length !== CTW_GAP_COUNT) {
    throw new Error(
      `item ${itemId} has ${Array.isArray(gaps) ? gaps.length : "no"} public ` +
        `gaps, expected exactly ${CTW_GAP_COUNT}`
    );
  }
  if (!Array.isArray(keyGaps) || keyGaps.length !== CTW_GAP_COUNT) {
    throw new Error(
      `answerKey for ${itemId} has ` +
        `${Array.isArray(keyGaps) ? keyGaps.length : "no"} gaps, expected ` +
        `exactly ${CTW_GAP_COUNT}`
    );
  }

  const gapResponses = submission.responseContent?.gapResponses;
  if (!Array.isArray(gapResponses)) {
    throw new Error(
      `submission ${submissionId} has no responseContent.gapResponses array`
    );
  }

  const givenByIndex = new Map(gaps.map((g) => [g.gapIndex, g.givenLetters]));
  const keyByIndex = new Map(
    keyGaps.map((g) => [g.gapIndex, g.correctCompletion])
  );

  const perGapResults = [];
  const mismatches = [];

  for (const gap of gaps) {
    const gapIndex = gap.gapIndex;
    const givenLetters = givenByIndex.get(gapIndex);
    const correctCompletion = keyByIndex.get(gapIndex);

    if (typeof correctCompletion !== "string" || correctCompletion === "") {
      throw new Error(
        `answerKey for ${itemId} has no correctCompletion for gap ${gapIndex}`
      );
    }

    const entry = gapResponses.find((r) => r && r.gapIndex === gapIndex);
    // An unanswered gap is a wrong answer, not an error: a student may leave
    // one blank. Distinct from a malformed response, below.
    const rawResponse = entry && typeof entry.response === "string"
      ? entry.response
      : "";
    const response = rawResponse.trim();

    let supplied = null;
    let malformed = false;

    if (response === "") {
      supplied = "";
    } else if (ctwPrefixMatches(response, givenLetters)) {
      supplied = response.slice(givenLetters.length);
    } else {
      // Does not begin with the given letters. Either the renderer sent the
      // completion alone (disagreeing with the whole-word decision) or the
      // student overwrote the given portion. Recorded and reported, and scored
      // incorrect rather than guessed at — never re-interpreted as a
      // completion, which would silently paper over a renderer mismatch.
      malformed = true;
      supplied = null;
    }

    const isCorrect =
      !malformed &&
      supplied !== null &&
      ctwAcceptableCompletions(correctCompletion).includes(supplied);

    if (malformed) {
      mismatches.push({ gapIndex, response, givenLetters });
    }

    perGapResults.push({
      gapIndex,
      response: rawResponse,
      correctCompletion,
      isCorrect,
    });
  }

  if (mismatches.length) {
    // Loud, with the item ID, because this means the renderer and the data
    // model disagree about what `response` holds — an integration bug that
    // would otherwise present as a student scoring zero.
    logger.error(
      "scoreCompleteTheWords: responses do not start with the item's given letters",
      {
        ...ctx,
        mismatchCount: mismatches.length,
        mismatches: mismatches.slice(0, CTW_GAP_COUNT),
        note:
          "responseContent.gapResponses[].response must be the whole " +
          "reconstructed word (JC, Sep 10), not the completion alone",
      }
    );
  }

  const correctCount = perGapResults.filter((r) => r.isCorrect).length;
  logger.info("scoreCompleteTheWords: scored", {
    ...ctx,
    correct: correctCount,
    of: CTW_GAP_COUNT,
    malformed: mismatches.length,
  });

  // No aggregate score field: CTW is binary per gap and the data model defines
  // perGapResults as the result shape. A total would be a derived value no
  // spec asks for.
  return { perGapResults };
}

// The raw model text goes to the logs, not into the thrown message: the
// trigger's catch below logs err.message, and a 4KB model response in that
// field is unreadable. Requirement 1 wants both halves — a visible, retryable
// "error" status and the raw text server-side.
function rawFailure(what, raw, { submissionId, taskType }) {
  logger.error(`layerAB: ${what}`, { submissionId, taskType, raw });
  return new Error(`${taskType} ${submissionId}: ${what} — ${raw.slice(0, 200)}`);
}

// Requirement 1 — extract defensively, then parse strictly. Same fence-strip
// idiom as claudeScorer.scoreTranscript: the prompt says "no markdown fences"
// and the model usually complies, but not always.
function parseLayerAB(raw, ctx) {
  const cleaned = raw.replace(/```json|```/g, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw rawFailure("model returned non-JSON", raw, ctx);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw rawFailure("model returned JSON that is not an object", raw, ctx);
  }

  // "exactly the top-level keys layerA and layerB". The prompt's OUTPUT rules
  // forbid the model echoing itemId/attemptId/taskType or emitting
  // status/instructor, so an extra key means it is not following the contract
  // it was given — and status/instructor in particular are the trigger's to
  // write, never the model's to propose.
  const keys = Object.keys(parsed);
  if (keys.length !== 2 || !("layerA" in parsed) || !("layerB" in parsed)) {
    throw rawFailure(
      `top-level keys [${keys.join(", ")}], expected exactly layerA and layerB`,
      raw,
      ctx
    );
  }

  return parsed;
}

// Requirement 2 — Layer A is the score, so every failure here is fatal: no
// partial write, no guess. The return value is picked field by field, so
// anything the model invented inside layerA never reaches Firestore.
//
// Shared with INT when it lands, which runs this per entry of its four-element
// array (its own extra questionIndex alignment check sits above this).
function validateLayerAObject(layerA, raw, ctx) {
  if (!layerA || typeof layerA !== "object" || Array.isArray(layerA)) {
    throw rawFailure("layerA is not a single object", raw, ctx);
  }

  const { score, band0Gate, rationale } = layerA;

  // Number.isInteger rejects 4.5, "4", null and undefined in one check.
  if (!Number.isInteger(score) || score < 0 || score > 5) {
    throw rawFailure(
      `layerA.score is ${JSON.stringify(score)}, not an integer 0-5`,
      raw,
      ctx
    );
  }

  // band0Gate consistency: a reason string at 0, exactly false above it.
  if (score === 0) {
    if (typeof band0Gate !== "string" || band0Gate.trim() === "") {
      throw rawFailure(
        `score 0 with band0Gate ${JSON.stringify(band0Gate)}, not a reason string`,
        raw,
        ctx
      );
    }
  } else if (band0Gate !== false) {
    throw rawFailure(
      `score ${score} with band0Gate ${JSON.stringify(band0Gate)}, not false`,
      raw,
      ctx
    );
  }

  if (typeof rationale !== "string") {
    throw rawFailure(
      `layerA.rationale is ${JSON.stringify(rationale)}, not a string`,
      raw,
      ctx
    );
  }
  if (score > 0 && rationale.trim() === "") {
    throw rawFailure(`score ${score} with an empty rationale`, raw, ctx);
  }
  if (score === 0 && rationale.trim() !== "") {
    // Not a validation failure. Requirement 2 constrains emptiness to band 0
    // ("empty only when score === 0"); it does not forbid text there, and A0
    // merely instructs the model to leave it empty. Logged so prompt drift
    // stays visible during calibration rather than erroring a valid zero.
    logger.warn("layerAB: band-0 layerA carries a rationale", { ...ctx, rationale });
  }

  return { score, band0Gate, rationale };
}

// Requirement 3 — Layer B degrades rather than fails, because it never feeds
// the score. An invalid feature or flag is dropped and logged; the valid rest
// is written. But the log matters: a model inventing feature names is a prompt
// defect worth seeing in the function logs during calibration, not something
// to silently absorb.
function buildLayerB(layerB, { features, flags, bandZero }, ctx) {
  const dropped = [];

  const rawItems = Array.isArray(layerB?.items) ? layerB.items : [];
  if (!Array.isArray(layerB?.items)) {
    dropped.push(`items not an array: ${JSON.stringify(layerB?.items)}`);
  }

  const items = [];
  if (bandZero) {
    // Requirement 3, last line: for a band-0 response layerB.items must be
    // empty; drop any the model produced. Flags are deliberately not dropped
    // here — requirement 3 names items only, and INCOMPLETE_DATA on a band-0
    // response is still a true fact about the input.
    if (rawItems.length) {
      dropped.push(`${rawItems.length} item(s) on a band-0 response`);
    }
  } else {
    for (const entry of rawItems) {
      if (items.length === 3) {
        dropped.push(`item beyond three: ${JSON.stringify(entry)}`);
        continue;
      }
      if (
        !entry ||
        typeof entry !== "object" ||
        Array.isArray(entry) ||
        typeof entry.feature !== "string" ||
        typeof entry.observation !== "string" ||
        typeof entry.target !== "string"
      ) {
        dropped.push(`malformed item: ${JSON.stringify(entry)}`);
        continue;
      }
      if (!features.has(entry.feature)) {
        dropped.push(`feature not on the closed list: ${entry.feature}`);
        continue;
      }
      // Rebuilt field by field: an item that also carried, say, a score is
      // written without it.
      items.push({
        feature: entry.feature,
        observation: entry.observation,
        target: entry.target,
      });
    }
  }

  const rawFlags = Array.isArray(layerB?.flags) ? layerB.flags : [];
  if (!Array.isArray(layerB?.flags)) {
    dropped.push(`flags not an array: ${JSON.stringify(layerB?.flags)}`);
  }

  const flagsOut = [];
  for (const flag of rawFlags) {
    if (typeof flag !== "string" || !flags.has(flag)) {
      dropped.push(`flag not on the closed list: ${JSON.stringify(flag)}`);
    } else if (!flagsOut.includes(flag)) {
      flagsOut.push(flag);
    }
  }

  if (layerB?.label !== LAYER_B_LABEL) {
    dropped.push(`label overwritten, model sent: ${JSON.stringify(layerB?.label)}`);
  }

  if (dropped.length) {
    logger.warn("layerAB: dropped invalid Layer B content", { ...ctx, dropped });
  }

  return { items, flags: flagsOut, label: LAYER_B_LABEL };
}

// Requirement 2 for INT, which is the one place EM/DISC's shape genuinely does
// not port: layerA and layerB are two PARALLEL four-entry arrays, one entry per
// question, never averaged into a task score.
//
// validateLayerAObject is reused verbatim, called once per entry — it already
// enforces every per-entry bullet requirement 2 lists (single object, integer
// score 0-5, band0Gate consistency, rationale string empty only at 0) and
// returns a field-by-field pick, so anything the model invented inside an
// entry never reaches Firestore. Nothing of its internals is duplicated here.
// What this function adds is only the array envelope and the alignment check.
function validateLayerAArray(layerA, layerB, raw, ctx) {
  if (!Array.isArray(layerA)) {
    throw rawFailure("layerA is not an array", raw, ctx);
  }
  if (!Array.isArray(layerB)) {
    throw rawFailure("layerB is not an array", raw, ctx);
  }
  if (layerA.length !== INT_QUESTION_COUNT) {
    throw rawFailure(
      `layerA has ${layerA.length} entries, expected ${INT_QUESTION_COUNT}`,
      raw,
      ctx
    );
  }
  if (layerB.length !== INT_QUESTION_COUNT) {
    throw rawFailure(
      `layerB has ${layerB.length} entries, expected ${INT_QUESTION_COUNT}`,
      raw,
      ctx
    );
  }

  const out = [];
  for (let i = 0; i < INT_QUESTION_COUNT; i++) {
    // The alignment check corpus asked about. Checked BEFORE per-entry
    // validation on purpose: a misaligned array should fail as misalignment,
    // not as a confusing score error three questions downstream.
    //
    // One strict positional comparison covers all three failure modes the spec
    // names, which is why there is no separate dedupe or ordering pass:
    //   · out of order  — a value lands at an index that isn't its own
    //   · missing       — undefined !== i
    //   · duplicated    — a repeat forces some later index to mismatch
    //                     ([0,1,1,3] fails at i=2)
    // Strict === against a number also rejects the string "0", the same
    // discipline validateLayerAObject applies to score rejecting "4".
    if (layerA[i] == null || layerA[i].questionIndex !== i) {
      throw rawFailure(
        `layerA[${i}].questionIndex is ${JSON.stringify(
          layerA[i] == null ? layerA[i] : layerA[i].questionIndex
        )}, expected ${i} — arrays are parallel by index and must align`,
        raw,
        ctx
      );
    }
    if (layerB[i] == null || layerB[i].questionIndex !== i) {
      throw rawFailure(
        `layerB[${i}].questionIndex is ${JSON.stringify(
          layerB[i] == null ? layerB[i] : layerB[i].questionIndex
        )}, expected ${i} — arrays are parallel by index and must align`,
        raw,
        ctx
      );
    }

    const entry = validateLayerAObject(layerA[i], raw, {
      ...ctx,
      questionIndex: i,
    });

    // questionIndex is taken from the loop counter, not copied from the model.
    // We have just asserted the two are equal, so the value is identical —
    // but sourcing it from i makes the written field definitionally correct
    // rather than model-supplied, same reasoning as picking fields above.
    out.push({ questionIndex: i, ...entry });
  }

  return out;
}

// Layer B for INT: buildLayerB called once per question, unchanged.
//
// The one substantive difference from EM/DISC is bandZero. They pass a single
// value for the whole submission; INT passes four independent ones, each from
// that question's OWN score, because requirement 3's last bullet is about a
// band-0 QUESTION, not a band-0 attempt. A student can score 0 on Q2 and 4 on
// Q3, and only Q2's items get emptied.
function buildLayerBArray(layerB, layerAOut, ctx) {
  const out = [];
  for (let i = 0; i < INT_QUESTION_COUNT; i++) {
    const built = buildLayerB(
      layerB[i],
      {
        features: INT_FEATURES,
        flags: INT_FLAGS,
        bandZero: layerAOut[i].score === 0,
      },
      // questionIndex on ctx so buildLayerB's dropped-content warning says
      // which question the invalid feature or flag came from.
      { ...ctx, questionIndex: i }
    );
    out.push({ questionIndex: i, ...built });
  }
  return out;
}

// EM — Write an Email. One response, one holistic judgment, one layerA/layerB
// object (data model v1.17 — EM/DISC are a single map, INT an array of four).
// Governed by TOEFL_Email_Scoring_Prompt_LayerAB_v1_2.md.
async function scoreEmail(db, { submissionId, submission, itemId }) {
  const ctx = { submissionId, taskType: "EM", itemId };

  // No answerKey subcollection for EM — there is no fixed answer to hide (data
  // model v1.17, import spec §"INT/EM/DISC"). The item is read for the scenario
  // package the rubric needs, all of it already public to the student.
  const itemSnap = await db.collection("toeflItems").doc(itemId).get();
  if (!itemSnap.exists) {
    throw new Error(`item document missing at toeflItems/${itemId}`);
  }
  const item = itemSnap.data();

  // EM/DISC responseContent is {text, wordCount} (data model Collection 3).
  //
  // wordCount is deliberately not passed to the model: A3 makes word count a
  // non-criterion, and the surest way to keep it out of the judgment is to keep
  // it out of the prompt.
  //
  // An empty string is deliberately not short-circuited either. A0 owns the
  // band-0 call ("no response, or blank"), and reimplementing that gate here
  // would put rubric logic in code, where it is not reviewable as rubric. The
  // cost is one model call on an empty email.
  const responseText = submission.responseContent?.text;
  if (typeof responseText !== "string") {
    throw new Error(
      `submission ${submissionId} has no responseContent.text string`
    );
  }

  // Whether the item declares a relationship type is a fact the trigger can
  // prove. It drives both halves of the missing-type handling below: how the
  // input is rendered, and the flag written after Layer B comes back.
  const hasRelationshipType = typeof item.prompt?.relationshipType === "string";

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
  const response = await client.messages.create({
    model: LAYER_AB_MODEL,
    max_tokens: LAYER_AB_MAX_TOKENS,
    temperature: 0,
    // top_k 1 alongside temperature 0. Emulator testing on Sep 9 showed
    // run-to-run Layer B variance on an identical submission — the same email
    // scored the same band twice but swapped one closed-list feature for
    // another. Spec §7's calibration protocol compares scores across runs, so
    // that variance is worth closing rather than tolerating.
    top_k: 1,
    // The rubric is byte-identical on every EM call and the prompt doc declares
    // its own SYSTEM ROLE, so it goes in `system`; only the per-submission
    // input contract varies. claudeScorer puts everything in one user message,
    // which predates prompts having a declared system role.
    system: EM_RUBRIC_PROMPT,
    messages: [
      {
        role: "user",
        content: buildEmailInput({
          itemId,
          submission,
          item,
          responseText,
          hasRelationshipType,
        }),
      },
    ],
  });

  const raw = response.content?.[0]?.text || "";

  const parsed = parseLayerAB(raw, ctx);
  const layerA = validateLayerAObject(parsed.layerA, raw, ctx);
  const layerB = buildLayerB(
    parsed.layerB,
    { features: EM_FEATURES, flags: EM_FLAGS, bandZero: layerA.score === 0 },
    ctx
  );

  // INCOMPLETE_DATA, written deterministically rather than left to the model.
  //
  // This is the one Layer B entry the trigger authors, and it is different in
  // kind from every other one: it is a provable fact about the input, not a
  // judgment about the writing. The model can only infer it from a line that
  // is not there, and in emulator testing it twice failed to — once with the
  // rule absent from the prompt, and again after the rule was added verbatim.
  // Noticing an absence is exactly what it is bad at, and exactly what the
  // trigger is good at. JC's call, Sep 9.
  //
  // Deduplicated: if the model did raise it, buildLayerB has already kept it
  // (it is on EM_FLAGS) and this adds nothing. Applied at band 0 too — the
  // input was incomplete regardless of what the response scored, and only
  // items are emptied for a band-0 response, not flags.
  if (!hasRelationshipType && !layerB.flags.includes("INCOMPLETE_DATA")) {
    layerB.flags.push("INCOMPLETE_DATA");
    logger.info(
      "scoreEmail: added INCOMPLETE_DATA — item declares no relationshipType",
      ctx
    );
  }

  logger.info("scoreEmail: scored", { ...ctx, score: layerA.score });

  // Requirement 4 — status and instructor are the trigger's, never the model's.
  // The trigger's own write adds scoringStatus and scoredAt on top of this.
  return {
    layerA,
    layerB,
    status: {
      provisional: true,
      instructorConfirmRequired: INSTRUCTOR_CONFIRM_REQUIRED,
    },
    instructor: null,
  };
}

// The prompt doc's input contract, filled from the item. Field shapes confirmed
// against real corpus content (EM-001): one scenario string, exactly three
// bullets, a To:/Subject: header, and the relationship type spelled
// "Student/subordinate to authority figure".
function buildEmailInput({
  itemId,
  submission,
  item,
  responseText,
  hasRelationshipType,
}) {
  const scenario = item.stimulus?.scenarioText;
  const elements = item.prompt?.requiredElements;
  const header = item.prompt?.header;

  // An item that cannot fill the contract is an item-data failure, not a
  // student's zero. Loud, for the same reason MCQ's missing answerKey is loud:
  // silently scoring an email against half its scenario would produce a
  // plausible-looking wrong number.
  if (
    typeof scenario !== "string" ||
    !Array.isArray(elements) ||
    elements.length !== 3
  ) {
    throw new Error(
      `item ${itemId} is not a scorable EM item ` +
        `(needs stimulus.scenarioText and three prompt.requiredElements)`
    );
  }

  // A missing relationship type is a documented, non-fatal input state: the
  // input contract says score Layer A normally, judge register against the
  // scenario's evident recipient, and raise INCOMPLETE_DATA — explicitly "do
  // not guess a type from the four".
  //
  // Rendered as an explicit "(not provided)" rather than by dropping the line.
  // An omitted line asks the model to notice an absence, which it demonstrably
  // does not; a present line saying the value is missing is something it can
  // read. Either way, never substitute one of the four real values — and the
  // flag itself no longer depends on the model spotting this (see scoreEmail).
  const lines = [
    `ITEM ID: ${itemId}`,
    `ATTEMPT ID: ${submission.attemptId}`,
    `RELATIONSHIP TYPE: ${
      hasRelationshipType ? item.prompt.relationshipType : "(not provided)"
    }`,
    "",
    `SCENARIO: ${scenario}`,
    "REQUIRED ELEMENTS:",
    ...elements.map((element, i) => `  ${i + 1}. ${element}`),
    "HEADER (pre-filled, not written by the student):",
    `  To: ${header?.to ?? ""}`,
    `  Subject: ${header?.subject ?? ""}`,
    "",
    `STUDENT RESPONSE: ${responseText}`,
  ];

  return lines.join("\n");
}

// DISC — Write for an Academic Discussion. One post, one holistic judgment,
// one layerA/layerB object — the same shape as EM, not INT's array of four
// (data model v1.17). Governed by
// TOEFL_Discussion_Scoring_Prompt_LayerAB_v1_1.md, whose "Trigger-side
// requirements" section specifies this function's five obligations.
//
// Requirements 1, 2 and 3 are discharged entirely by the shared helpers
// parseLayerAB / validateLayerAObject / buildLayerB (and rawFailure beneath
// them), already built and emulator-tested for EM. They are called here, never
// reimplemented — the closed lists are the only per-type input they need.
// Requirement 5 (idempotency) is discharged upstream by the trigger's claim
// transaction, which every task type passes through; DISC inherits it by being
// registered in SCORERS and needs nothing of its own.
async function scoreDiscussion(db, { submissionId, submission, itemId }) {
  const ctx = { submissionId, taskType: "DISC", itemId };

  // No answerKey subcollection for DISC — there is no fixed answer to hide
  // (data model v1.17). The item is read for the thread the rubric judges
  // against, all of it already public to the student.
  const itemSnap = await db.collection("toeflItems").doc(itemId).get();
  if (!itemSnap.exists) {
    throw new Error(`item document missing at toeflItems/${itemId}`);
  }
  const item = itemSnap.data();

  // EM/DISC responseContent is {text, wordCount} (data model Collection 3).
  // wordCount is deliberately not passed to the model — A3 makes word count a
  // non-criterion, and the surest way to keep it out of the judgment is to
  // keep it out of the prompt. An empty string is deliberately not
  // short-circuited either: A0 owns the band-0 call, and reimplementing that
  // gate here would put rubric logic in code where it is not reviewable as
  // rubric. The cost is one model call on an empty post.
  const responseText = submission.responseContent?.text;
  if (typeof responseText !== "string") {
    throw new Error(
      `submission ${submissionId} has no responseContent.text string`
    );
  }

  // Whether the item actually supplies both peer posts is a fact the trigger
  // can prove, so it is computed here rather than inferred by the model.
  // A post with no text is not a post — an empty string would render as a
  // present-but-blank line, which is worse than a declared absence.
  const peers = Array.isArray(item.stimulus?.peerResponses)
    ? item.stimulus.peerResponses
    : [];
  const usablePeers = peers.filter(
    (p) => p && typeof p.text === "string" && p.text.trim() !== ""
  );
  const hasBothPeerPosts = usablePeers.length >= 2;

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
  const response = await client.messages.create({
    model: LAYER_AB_MODEL,
    max_tokens: LAYER_AB_MAX_TOKENS,
    temperature: 0,
    // top_k 1 alongside temperature 0, same standing reason as EM: Sep 9
    // emulator testing showed run-to-run Layer B variance on an identical
    // submission, and spec §7's calibration protocol compares scores across
    // runs.
    top_k: 1,
    system: DISC_RUBRIC_PROMPT,
    messages: [
      {
        role: "user",
        content: buildDiscussionInput({
          itemId,
          submission,
          item,
          responseText,
          usablePeers,
        }),
      },
    ],
  });

  const raw = response.content?.[0]?.text || "";

  const parsed = parseLayerAB(raw, ctx);
  const layerA = validateLayerAObject(parsed.layerA, raw, ctx);
  const layerB = buildLayerB(
    parsed.layerB,
    {
      features: DISC_FEATURES,
      flags: DISC_FLAGS,
      bandZero: layerA.score === 0,
    },
    ctx
  );

  // INCOMPLETE_DATA, written deterministically rather than left to the model —
  // the same call JC made for EM's missing relationshipType, applied to the
  // same failure mode. The input contract's rule is "peer posts were missing
  // from the input", which is a provable fact about the item, not a judgment
  // about the writing; the model can only infer it from a line that is not
  // there, and noticing an absence is exactly what it proved unreliable at.
  //
  // Deduplicated: if the model did raise it, buildLayerB has already kept it
  // (INCOMPLETE_DATA is on DISC_FLAGS) and this adds nothing. Applied at band 0
  // too — the input was incomplete regardless of what the post scored, and
  // only items are emptied for a band-0 response, not flags.
  //
  // Note what this deliberately does NOT do: it does not touch layerA. The
  // input contract is explicit that missing posts are "not a reason to lower
  // the placement", so the absence surfaces as feedback only.
  if (!hasBothPeerPosts && !layerB.flags.includes("INCOMPLETE_DATA")) {
    layerB.flags.push("INCOMPLETE_DATA");
    logger.info(
      "scoreDiscussion: added INCOMPLETE_DATA — item supplies fewer than two peer posts",
      { ...ctx, peerPostsFound: usablePeers.length }
    );
  }

  logger.info("scoreDiscussion: scored", { ...ctx, score: layerA.score });

  // Requirement 4 — status and instructor are the trigger's, never the
  // model's. The trigger's own write adds scoringStatus and scoredAt on top.
  return {
    layerA,
    layerB,
    status: {
      provisional: true,
      instructorConfirmRequired: INSTRUCTOR_CONFIRM_REQUIRED,
    },
    instructor: null,
  };
}

// The prompt doc's input contract, filled from the item. Field shapes are the
// ones confirmed against real corpus content while building the importer
// (Sep 10): stimulus.professorPrompt is one string, stimulus.peerResponses is
// an array of {label, peerName, text} where peerName is null for the 26 items
// that leave their peers unnamed and a real name for the 4 that don't
// (DISC-002 Sofia/Marcus, DISC-005 Daniel/Priya, DISC-007 Aisha/Tom,
// DISC-010 Wei/Grace).
function buildDiscussionInput({
  itemId,
  submission,
  item,
  responseText,
  usablePeers,
}) {
  const professorPrompt = item.stimulus?.professorPrompt;

  // An item that cannot fill the contract is an item-data failure, not a
  // student's zero. Loud, for the same reason EM's missing scenario is loud:
  // scoring a post for relevance against an absent question would produce a
  // plausible-looking wrong number. Relevance is judged against this text, so
  // its absence is not a degradable input the way a missing peer post is.
  if (typeof professorPrompt !== "string" || professorPrompt.trim() === "") {
    throw new Error(
      `item ${itemId} is not a scorable DISC item ` +
        `(needs stimulus.professorPrompt)`
    );
  }

  // Both post lines are always rendered, A then B. A missing post shows as an
  // explicit "(not provided)" rather than being dropped — an omitted line asks
  // the model to notice an absence, which it demonstrably does not; a present
  // line saying the value is missing is something it can read. The flag itself
  // no longer depends on the model spotting this (see scoreDiscussion).
  //
  // "unnamed" is the contract's own literal for a peer the item does not name
  // ("with the poster's name if the item gives one, otherwise 'unnamed'"), so
  // a real name is never invented and an absent one is never left ambiguous.
  const byLabel = new Map(usablePeers.map((p) => [p.label, p]));
  const postLine = (label) => {
    const peer = byLabel.get(label);
    if (!peer) return `STUDENT POST ${label}: (not provided)`;
    return `STUDENT POST ${label} (${peer.peerName || "unnamed"}): ${peer.text}`;
  };

  const lines = [
    `ITEM ID: ${itemId}`,
    `ATTEMPT ID: ${submission.attemptId}`,
    "",
    `PROFESSOR PROMPT: ${professorPrompt}`,
    postLine("A"),
    postLine("B"),
    "",
    `STUDENT RESPONSE: ${responseText}`,
  ];

  return lines.join("\n");
}

// INT — Interview. Four questions, one attempt, ONE model call, two parallel
// four-entry arrays out. Governed by
// TOEFL_Interview_Scoring_Prompt_LayerAB_v1_1.md, whose "Trigger-side
// requirements" section specifies this function's five obligations.
//
// Requirements 1 and 3 are discharged by the shared helpers parseLayerAB and
// buildLayerB (via buildLayerBArray), unchanged. Requirement 2 is discharged
// by validateLayerAArray, which reuses validateLayerAObject per entry and adds
// only the array envelope and the alignment check. Requirement 5 (idempotency)
// is discharged upstream by the trigger's claim transaction, inherited by
// being registered in SCORERS.
async function scoreInterview(db, { submissionId, submission, itemId }) {
  const ctx = { submissionId, taskType: "INT", itemId };

  // No answerKey subcollection for INT — there is no fixed answer to hide
  // (data model v1.17). The item is read for the four stems, their types, and
  // the interview framing, all of it already public to the student.
  const itemSnap = await db.collection("toeflItems").doc(itemId).get();
  if (!itemSnap.exists) {
    throw new Error(`item document missing at toeflItems/${itemId}`);
  }
  const item = itemSnap.data();

  // The attempt carries the four clips: storagePath, durationSeconds and
  // transcriptStatus per question (data model v1.17, interviewClips). This is
  // the ONLY source that can distinguish "the student recorded nothing" from
  // "a recording exists but transcription failed" — see buildInterviewInput.
  const attemptSnap = await db
    .collection("toeflAttempts")
    .doc(submission.attemptId)
    .get();
  if (!attemptSnap.exists) {
    throw new Error(`attempt ${submission.attemptId} not found`);
  }
  const attempt = attemptSnap.data();

  // buildInterviewInput throws on a transcription failure, and it is called
  // BEFORE the client is constructed on purpose: the input contract is
  // explicit that on a transcription failure "the trigger never calls you for
  // this attempt at all". Building the input first is what makes that true
  // rather than aspirational.
  const promptInput = buildInterviewInput({
    itemId,
    submission,
    item,
    attempt,
    ctx,
  });

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
  const response = await client.messages.create({
    model: LAYER_AB_MODEL,
    // Four rationales plus up to four x three item/observation/target triples
    // is materially more output than EM or DISC produce from one call. A
    // response truncated at the cap is invalid JSON, which requirement 1
    // correctly turns into "error" — an avoidable one.
    max_tokens: INT_MAX_TOKENS,
    temperature: 0,
    top_k: 1,
    system: INT_RUBRIC_PROMPT,
    messages: [{ role: "user", content: promptInput }],
  });

  const raw = response.content?.[0]?.text || "";

  // parseLayerAB is reused as-is. Its top-level contract — an object with
  // exactly the keys layerA and layerB — is identical for INT; only what those
  // keys hold differs, and it does not inspect that.
  const parsed = parseLayerAB(raw, ctx);
  const layerA = validateLayerAArray(parsed.layerA, parsed.layerB, raw, ctx);
  const layerB = buildLayerBArray(parsed.layerB, layerA, ctx);

  // Nothing is averaged, aggregated, or reduced to a task score. The OUTPUT
  // rules are explicit: "no task score, no average, no 1-6 band anywhere in
  // this object", and four per-question judgments are the result.
  logger.info("scoreInterview: scored", {
    ...ctx,
    scores: layerA.map((a) => a.score),
  });

  // Requirement 4 — status and instructor are the trigger's, never the
  // model's. The trigger's own write adds scoringStatus and scoredAt on top.
  return {
    layerA,
    layerB,
    status: {
      provisional: true,
      instructorConfirmRequired: INSTRUCTOR_CONFIRM_REQUIRED,
    },
    instructor: null,
  };
}

// The prompt doc's input contract, assembled from the item, the attempt's
// interviewClips, and the submission's per-question transcripts.
//
// THE DISTINCTION THIS FUNCTION EXISTS TO MAKE. A student who recorded nothing
// and a Deepgram call that failed are indistinguishable from inside the model,
// and only one of them is a band 0. They differ in SCOPE as well as outcome,
// which is the part a port of EM's single-missing-field logic would flatten:
//
//   no recording        per QUESTION.  storagePath absent. The model IS called,
//                       is told "[NO RECORDING]" for that question, and scores
//                       it band 0 / "no response" / empty Layer B. The other
//                       three questions score normally.
//
//   transcription fail  per ATTEMPT.   storagePath PRESENT but no usable
//                       transcript. The model is never called at all; this
//                       throws, the trigger's catch sets scoringStatus
//                       "error", and the failure is visible and retryable.
//                       A system failure is never scored as a student's zero.
//
// Precedence is explicit: storagePath absence wins. No recording is no
// recording regardless of what transcriptStatus says about it.
function buildInterviewInput({ itemId, submission, item, attempt, ctx }) {
  const contextSentence = item.stimulus?.contextSentence;
  const questions = item.prompt?.questions;

  // An item that cannot fill the contract is an item-data failure, not a
  // student's zero — same reasoning as EM's missing scenario and DISC's
  // missing professor prompt.
  if (!Array.isArray(questions) || questions.length !== INT_QUESTION_COUNT) {
    throw new Error(
      `item ${itemId} is not a scorable INT item ` +
        `(needs ${INT_QUESTION_COUNT} prompt.questions, found ` +
        `${Array.isArray(questions) ? questions.length : "none"})`
    );
  }

  const clips = Array.isArray(attempt.interviewClips)
    ? attempt.interviewClips
    : [];
  const transcripts = Array.isArray(submission.responseContent?.transcripts)
    ? submission.responseContent.transcripts
    : [];

  const blocks = [];
  for (let i = 0; i < INT_QUESTION_COUNT; i++) {
    // INDEX BASE CONVERSION, in one place and deliberately explicit.
    //
    // Corpus items number their questions 1..4 — the file's own Q1..Q4, which
    // the importer preserves verbatim, consistent with the MCQ types storing
    // 1..5. The scoring prompt's OUTPUT contract indexes layerA/layerB 0..3.
    // Runtime artifacts (interviewClips, responseContent.transcripts) are
    // 0-based to match the scoring contract, so only the item lookup converts.
    //
    // This was a real bug before it was a comment: a `find` on the raw loop
    // index matched the item's 1-based value, so output index 1 resolved to Q1,
    // 2 to Q2, 3 to Q3 — Q1 rendered twice and Q4 never scored, silently. The
    // array-position fallback that used to sit here masked it for index 0.
    // There is no fallback now: a missing question is loud.
    const question = questions.find((q) => q.questionIndex === i + 1);
    if (!question) {
      throw new Error(
        `item ${itemId} has no question with questionIndex ${i + 1} ` +
          `(found ${JSON.stringify(questions.map((q) => q.questionIndex))}) — ` +
          `items are 1-based, scoring output is 0-based`
      );
    }
    const clip = clips.find((c) => c && c.questionIndex === i);
    const entry = transcripts.find((t) => t && t.questionIndex === i);

    const hasRecording = !!(clip && clip.storagePath);
    const transcriptText =
      entry && typeof entry.transcript === "string" ? entry.transcript : null;

    if (hasRecording && (transcriptText === null || clip.transcriptStatus !== "complete")) {
      // Transcription failure, attempt-level. Thrown, never rendered: the
      // model must not be asked to score this attempt at all.
      //
      // transcriptStatus's legal values are not enumerated in data model
      // v1.17, so this fails closed on anything that is not an explicit
      // "complete" WITH a transcript — "pending" included. A submission
      // stuck at "error" is visible and retryable; a score computed from
      // evidence that had not arrived yet is neither.
      throw new Error(
        `INT transcription failure on Q${i + 1} of attempt ` +
          `${submission.attemptId}: recording exists at ` +
          `${clip.storagePath} but transcriptStatus is ` +
          `${JSON.stringify(clip.transcriptStatus)} and transcript is ` +
          `${transcriptText === null ? "absent" : "present"} — the model is ` +
          `deliberately not called for this attempt`
      );
    }

    blocks.push(
      renderQuestionBlock({
        index: i,
        question,
        clip,
        entry,
        hasRecording,
        transcriptText,
        ctx,
      })
    );
  }

  return [
    `ITEM ID: ${itemId}`,
    `ATTEMPT ID: ${submission.attemptId}`,
    `INTERVIEW CONTEXT: ${contextSentence || "(not provided)"}`,
    "",
    ...blocks,
  ].join("\n");
}

// One QUESTION block of the input contract.
function renderQuestionBlock({
  index,
  question,
  clip,
  entry,
  hasRecording,
  transcriptText,
  ctx,
}) {
  const lines = [
    `QUESTION ${index + 1}:`,
    `  TYPE: ${resolveQuestionType(question, index, ctx)}`,
    `  STEM: ${question.stem}`,
  ];

  if (!hasRecording) {
    // The literal token the input contract specifies. The model reads this and
    // scores the question band 0 with band0Gate "no response" — it is not
    // asked to infer anything from a missing line.
    lines.push(`  TRANSCRIPT: [NO RECORDING]`);
    lines.push(`  DELIVERY EVIDENCE: [NO RECORDING]`);
    return lines.join("\n");
  }

  lines.push(`  TRANSCRIPT: ${transcriptText}`);
  lines.push(...renderDeliveryEvidence(entry, clip));
  return lines.join("\n");
}

// The corpus tags questions more richly than the contract's four-value enum,
// so map by leading phrase and cross-check against the fixed positional
// structure. Disagreement is loud, never silently resolved in favour of one.
function resolveQuestionType(question, index, ctx) {
  const raw =
    typeof question.questionType === "string" ? question.questionType : null;
  const positional = INT_TYPE_BY_POSITION[index];

  if (!raw) {
    // No tag stored (an item imported before questionType capture). Fall back
    // to position and say so in the logs rather than silently asserting a type.
    logger.warn("scoreInterview: no questionType on item question, using position", {
      ...ctx,
      questionIndex: index,
      positional,
    });
    return positional;
  }

  const hit = INT_TYPE_BY_PREFIX.find(([re]) => re.test(raw));
  if (!hit) {
    // An unrecognised tag is reported, not guessed at. Position is used so the
    // attempt still scores, but the tag reaches the logs so a corpus tag the
    // mapping does not cover is visible during calibration.
    logger.warn("scoreInterview: unrecognised questionType tag", {
      ...ctx,
      questionIndex: index,
      raw,
      usingPositional: positional,
    });
    return positional;
  }

  if (hit[1] !== positional) {
    logger.warn(
      "scoreInterview: questionType tag disagrees with positional structure",
      { ...ctx, questionIndex: index, raw, fromTag: hit[1], fromPosition: positional }
    );
  }
  return hit[1];
}

// Delivery evidence, rendered from what this pipeline can actually produce.
//
// The divergence from the contract is named IN the block rather than hidden:
// the contract asks for run length and long pauses measured at 0.495s, which
// nothing here computes (see DELIVERY_PAUSE_THRESHOLDS). Labelling the real
// thresholds means the model is never silently told it is reading a metric it
// is not. Safe to do because A3 is explicit that "no number in the delivery
// evidence maps to a band" — the evidence is qualitative input, so different
// thresholds change what the model sees, not what any number entitles it to.
//
// Missing or malformed evidence is NOT estimated, per the contract: the line
// says so and the model scores from the transcript alone, raising
// INCOMPLETE_DATA for that question.
function renderDeliveryEvidence(entry, clip) {
  const ev = entry && typeof entry.deliveryEvidence === "object"
    ? entry.deliveryEvidence
    : null;
  const duration = clip && typeof clip.durationSeconds === "number"
    ? clip.durationSeconds
    : ev && typeof ev.durationSeconds === "number"
    ? ev.durationSeconds
    : null;

  if (!ev) {
    return [
      "  DELIVERY EVIDENCE: [NOT AVAILABLE — not estimated; score this question",
      "    from the transcript alone, state in the rationale that delivery could",
      "    not be assessed, and raise INCOMPLETE_DATA for this question]",
      `    duration: ${duration === null ? "unknown" : `${duration} seconds`}`,
    ];
  }

  const num = (v) => (typeof v === "number" ? v : null);
  const show = (v, unit) => (v === null ? "not available" : `${v}${unit || ""}`);

  return [
    "  DELIVERY EVIDENCE:",
    `    speaking rate: ${show(num(ev.wordsPerMinute), " wpm")}`,
    `    mean gap between words: ${show(num(ev.meanGapSeconds), "s")}`,
    `    long pauses (>=${DELIVERY_PAUSE_THRESHOLDS.long}s): ${show(num(ev.longPauseCount))}` +
      `${ev.longPauseTimestamps ? ` at ${ev.longPauseTimestamps}` : ""}`,
    `    severe pauses (>=${DELIVERY_PAUSE_THRESHOLDS.severe}s): ${show(num(ev.severePauseCount))}` +
      `${ev.severePauseTimestamps ? ` at ${ev.severePauseTimestamps}` : ""}`,
    `    filled pauses (uh/um/eh): ${show(num(ev.filledPauseCount))}`,
    `    word-confidence pattern: ${ev.wordConfidencePattern || "not available"}`,
    `    duration: ${show(duration, " seconds")}`,
    "    NOTE ON THRESHOLDS: pause counts above are measured at " +
      `${DELIVERY_PAUSE_THRESHOLDS.long}s and ${DELIVERY_PAUSE_THRESHOLDS.severe}s, ` +
      "not the 0.495s the input contract names, and no mean-run-length figure " +
      "is computed. Read these as the qualitative evidence A3 describes; do not " +
      "treat any number as mapping to a band.",
  ];
}

// ── BAS — Build a Sentence ────────────────────────────────────────────────────
//
// Deterministic comparer, no Anthropic call. Same family as scoreMcq and
// scoreCompleteTheWords.
//
// SCORING IS EXACT-MATCH, ALL-OR-NOTHING, per BAS_Content_Spec_v1_2.md §2.2
// ("a single target sentence per item, exact-order implied") and the resolution
// corpus reached with JC on Sep 10, 2026:
//   · exact-match against the item's accepted ordering — no within-item
//     partial credit for a partially-correct arrangement
//   · live grammatical-equivalence checking REJECTED — judging at scoring time
//     whether a student's alternative arrangement is also grammatical would
//     make BAS a holistic-judgment type, against the deterministic-comparer
//     premise it was scoped under. Architectural, not a cost decision.
//   · genuinely multi-valid items are handled by DATA, never by inference —
//     see ACCEPTED ORDERINGS below.
//
// §2.2 and BAS_Review_Prompt_v1_3.md Check 3 both still carry the open-item
// language this resolution closes; replacement text is drafted and pending a
// version-convention decision. scripts/checkSpecDrift.js tracks both.
const BAS_MIN_FRAGMENTS = 4; // §2.1: confirmed range 4-8 chunks per item

// ACCEPTED ORDERINGS — membership in a set, and the shape Firestore actually
// permits.
//
// Correctness is evaluated as MEMBERSHIP IN A SET of accepted orderings, not
// equality against a single one. Today that set has exactly one member,
// answerKey.correctOrder, and no real item is known to be multi-valid.
//
// THE SHAPE IS NOT THE OBVIOUS ONE, and the first version of this comment was
// wrong to claim the future addition needed no code change. The natural
// encoding — an array of orderings, each itself an array of fragmentIndex
// values — is a DIRECTLY NESTED ARRAY, which Firestore prohibits outright:
//
//     3 INVALID_ARGUMENT: Nested arrays are not allowed
//
// Verified against the emulator, Sep 11. So each ordering is wrapped in a map:
//
//     acceptedOrderings: [{ order: [6,2,5,1,0,4] }, { order: [6,2,5,1,4,0] }]
//
// That also matches the data model's existing house style — questions:
// [{questionIndex, …}], gaps: [{gapIndex, …}], fragments: [{fragmentIndex, …}]
// — and was confirmed to round-trip through the rules-enforced REST path with
// an admin claim, not merely through an Admin SDK bypass (the Admin SDK skips
// rules entirely, so a bypass proves nothing about what a real admin UI could
// write).
//
// How this was missed: the unit test written specifically to de-risk this
// scenario exercised an array of arrays against a plain-JS fake database,
// which holds any shape happily. It proved the comparison logic and was
// structurally incapable of catching the storage constraint.
//
// UNION, not replacement. correctOrder is always accepted; acceptedOrderings
// ADDS alternatives. A reviewer recording a second valid arrangement therefore
// cannot accidentally stop the primary answer from being accepted — which the
// previous "complete set" reading allowed.
//
// Nothing is inferred: an alternative exists only because a content reviewer
// explicitly confirmed that specific item has one.
function basAcceptedOrderings(answerKey, itemId) {
  const orderings = [answerKey.correctOrder];
  const raw = answerKey.acceptedOrderings;
  if (!Array.isArray(raw) || raw.length === 0) return orderings;

  raw.forEach((entry, i) => {
    // A bare array here is the nested-array mistake itself — thrown rather
    // than coerced, so the wrong shape fails loudly at the first scored
    // submission instead of silently never matching.
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      !Array.isArray(entry.order)
    ) {
      throw new Error(
        `answerKey for ${itemId} has a malformed acceptedOrderings[${i}]: ` +
          `expected {order: [fragmentIndex, ...]}, got ${JSON.stringify(entry)}`
      );
    }
    orderings.push(entry.order);
  });
  return orderings;
}

function basSameOrder(a, b) {
  return (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((v, i) => v === b[i])
  );
}

async function scoreBuildASentence(db, { submissionId, submission, itemId }) {
  const ctx = { submissionId, taskType: "BAS", itemId };

  const itemRef = db.collection("toeflItems").doc(itemId);
  const itemSnap = await itemRef.get();
  if (!itemSnap.exists) {
    throw new Error(`item document missing at toeflItems/${itemId}`);
  }
  const item = itemSnap.data();

  const keySnap = await itemRef.collection("answerKey").doc("key").get();
  if (!keySnap.exists) {
    throw new Error(
      `answerKey document missing at toeflItems/${itemId}/answerKey/key`
    );
  }
  const answerKey = keySnap.data();

  // ── Item-data assertions. A malformed item is a data failure, never a
  // student's zero — same discipline as MCQ's missing answerKey.
  const fragments = item.fragments;
  if (!Array.isArray(fragments) || fragments.length < BAS_MIN_FRAGMENTS) {
    throw new Error(
      `item ${itemId} has ${Array.isArray(fragments) ? fragments.length : "no"} ` +
        `fragments, expected at least ${BAS_MIN_FRAGMENTS} (spec §2.1 range 4-8)`
    );
  }

  // fragmentIndex is 0-BASED and contiguous. Asserted rather than assumed
  // because this data model carries three different index bases — MCQ
  // questionIndex and CTW gapIndex are 1-based (they come from the source's
  // own Q1..Qn numbering), while BAS fragmentIndex is 0-based (source chunks
  // are unnumbered, so it is array position). An off-by-one between
  // submittedOrder and fragmentIndex is exactly the bug class that silently
  // mis-assigned INT's questions on Sep 10.
  const indices = fragments.map((f) => f && f.fragmentIndex);
  const expected = fragments.map((_, i) => i);
  if (!basSameOrder(indices, expected)) {
    throw new Error(
      `item ${itemId} fragmentIndex values are ${JSON.stringify(indices)}, ` +
        `expected contiguous 0-based ${JSON.stringify(expected)}`
    );
  }

  const correctOrder = answerKey.correctOrder;
  if (!Array.isArray(correctOrder) || correctOrder.length === 0) {
    throw new Error(`answerKey for ${itemId} has no correctOrder array`);
  }

  // Every accepted ordering gets the SAME integrity checks, not just the
  // primary. Index 0 IS correctOrder, so nothing is duplicated — the checks are
  // generalised over the set. A reviewer-entered alternative deserves no weaker
  // guarantee than the authored answer: one carrying a duplicate or an
  // out-of-range index would otherwise either never match (silently dead data)
  // or accept an arrangement that is not really valid.
  //
  // Any ordering may legitimately be SHORTER than fragments: unused entries are
  // distractor chunks, and 45.5% of real items have none while 54.5% have one
  // (§3 — "a distractor-free item is not a defect"). Never assume a distractor
  // exists, and never assume one does not.
  const acceptedOrderings = basAcceptedOrderings(answerKey, itemId);
  acceptedOrderings.forEach((ordering, n) => {
    const where = n === 0 ? "correctOrder" : `acceptedOrderings[${n - 1}].order`;
    if (!Array.isArray(ordering) || ordering.length === 0) {
      throw new Error(
        `answerKey for ${itemId}: ${where} is not a non-empty array`
      );
    }
    if (new Set(ordering).size !== ordering.length) {
      throw new Error(
        `answerKey for ${itemId}: ${where} has a duplicate fragmentIndex: ` +
          JSON.stringify(ordering)
      );
    }
    if (ordering.some((i) => !Number.isInteger(i) || i < 0 || i >= fragments.length)) {
      throw new Error(
        `answerKey for ${itemId}: ${where} has an out-of-range fragmentIndex: ` +
          `${JSON.stringify(ordering)} against ${fragments.length} fragments`
      );
    }
    if (ordering.length > fragments.length) {
      throw new Error(
        `answerKey for ${itemId}: ${where} is longer than fragments ` +
          `(${ordering.length} > ${fragments.length})`
      );
    }
  });

  // ── The student's arrangement.
  const submittedOrder = submission.responseContent?.submittedOrder;
  if (!Array.isArray(submittedOrder)) {
    throw new Error(
      `submission ${submissionId} has no responseContent.submittedOrder array`
    );
  }

  // Malformed vs simply wrong — the distinction CTW established.
  //
  // A duplicate index, or an index outside the fragment set, cannot come from
  // a student using a working renderer: no drag-and-drop UI lets one chunk be
  // placed twice or invents a chunk that is not there. Those are integration
  // failures, logged loudly and scored incorrect, never silently absorbed —
  // the BAS component does not exist yet (Frontend Scaffold v1.10 schedules it
  // separately), so absorbing them would hide a renderer disagreeing with the
  // data model behind a plausible-looking zero.
  //
  // Everything else is an ordinary wrong answer:
  //   · including a distractor index      — the distractor doing its job
  //   · omitting fragments / wrong length — a partial arrangement is a real
  //                                         submission
  //   · an empty array                    — the student left it
  const problems = [];
  if (new Set(submittedOrder).size !== submittedOrder.length) {
    problems.push("duplicate fragmentIndex — one chunk placed more than once");
  }
  const outOfRange = submittedOrder.filter(
    (i) => !Number.isInteger(i) || i < 0 || i >= fragments.length
  );
  if (outOfRange.length) {
    problems.push(
      `fragmentIndex outside the item's ${fragments.length} fragments: ` +
        JSON.stringify(outOfRange)
    );
  }

  const orderCorrect =
    problems.length === 0 &&
    acceptedOrderings.some((ordering) => basSameOrder(submittedOrder, ordering));

  if (problems.length) {
    logger.error("scoreBuildASentence: malformed submittedOrder", {
      ...ctx,
      submittedOrder,
      fragmentCount: fragments.length,
      problems,
      note:
        "responseContent.submittedOrder must be 0-based fragmentIndex values, " +
        "each used at most once — a duplicate or out-of-range index indicates " +
        "the renderer and the item disagree, not a student mistake",
    });
  }

  logger.info("scoreBuildASentence: scored", {
    ...ctx,
    orderCorrect,
    acceptedOrderingCount: acceptedOrderings.length,
    malformed: problems.length > 0,
  });

  // Data model v1.17: {orderCorrect, correctOrder} — correctOrder is copied
  // back so the review screen can show the right answer, same reasoning as
  // MCQ's rationale copy-back. No aggregate or derived score: outcomeType for
  // BAS is percentCorrect, computed elsewhere, and a single sentence is 0 or
  // 100 by definition.
  return { orderCorrect, correctOrder };
}

// ── LAR — Listen and Repeat ──────────────────────────────────────────────────
//
// Deterministic: the comparer in functions/lib/lar/ does the whole job
// (Stages 01-06, 95 tests, no network, no model call). This branch is
// integration only — read the item, read the runtime inputs, hand them over,
// shape the result.

// compareLAR applies TWO intelligibility verdicts: the per-utterance one inside
// bandUtterance, and intelligibility.overall as a response-level cap afterwards.
// The second rewrites the band but leaves u.verdict holding the per-utterance
// value, so an utterance lowered by the overall verdict reads "clear" while
// carrying a lowered band. Taking the worse of the two is what keeps the
// rationale and the flag honest about why the band moved.
const LAR_VERDICT_SEVERITY = { clear: 0, uncertain: 1, unintelligible: 2 };
function larEffectiveVerdict(u, overall) {
  const a = LAR_VERDICT_SEVERITY[u.verdict] ?? 0;
  const b = LAR_VERDICT_SEVERITY[overall] ?? 0;
  return b > a ? overall : u.verdict;
}

// One sentence, same register as the other three types' rationales. Built from
// the clause that actually decided the band, so the sentence and the number can
// never disagree.
function larRationale(u, overall) {
  const verdict = larEffectiveVerdict(u, overall);
  // THE BAND THAT GETS WRITTEN IS THE GATED ONE, and the sentence has to
  // describe THAT band. bandLabel comes from the pre-gate match, so reading it
  // directly produces a rationale that contradicts the score: an utterance
  // capped to 4 by uncertain delivery would otherwise read "Repeated exactly
  // and intelligibly" next to a 4. Both lowering steps are handled before the
  // matched-clause path is reached.
  if (u.band < u.cappedBand) {
    return (
      `Delivery was ${verdict}, so band ${u.cappedBand} is withheld — ` +
      `the repetition itself was otherwise ${u.bandLabel}.`
    );
  }
  const loweredBy = (u.capsApplied || []).find((c) => c.lowered);
  if (loweredBy) {
    return `Lowered to band ${u.band} — ${loweredBy.reason}.`;
  }
  if (u.band === 5) return "Repeated exactly and intelligibly.";
  const because = {
    "minor-function-words": "one or two function words differed",
    "morphological-marker": "a tense, number or aspect ending differed",
    "transposition": "two words were repeated out of order",
    "self-correction-completed": "a self-correction still completed the sentence",
    "content-word-missing-longer-prompt": "one content word was missing from a long prompt",
    "function-word-accumulation": "three or more function words differed",
    "one-content-word-missing-short-prompt": "a content word was missing",
    "content-words-substantively-changed": "content words were substantively changed",
    "content-substitution-relatedness-unknown": "a content word was replaced",
    "incomplete-most-content-retained":
      "the sentence was not completed, though most content was retained",
    "significant-content-missing": "a significant part of the content was missing",
    "few-words-only": "only a few words were produced",
    nothing: "nothing was produced",
    "no-attempt": "no attempt was made",
  };
  const reason = u.matchedClauses
    .filter((c) => c.band === u.rawBand)
    .map((c) => because[c.clause])
    .filter(Boolean)[0];
  const label = u.bandLabel || "scored";
  return reason
    ? `${label.charAt(0).toUpperCase()}${label.slice(1)} — ${reason}.`
    : `${label.charAt(0).toUpperCase()}${label.slice(1)}.`;
}

// Ordered by how much each matters to the task, so the three that survive the
// cap are the three worth reading. Same three-item cap the other types enforce.
function larLayerB(u, overall) {
  const verdict = larEffectiveVerdict(u, overall);
  const f = u.features;
  const items = [];
  const add = (feature, observation, target) => {
    if (items.length < 3) items.push({ feature, observation, target });
  };

  // Band 0 carries no items, matching buildLayerB's bandZero rule. Flags are
  // deliberately still emitted — they remain true facts about the input.
  if (u.band !== 0) {
    if (f.contentDeviationsEffective > 0) {
      add(
        "Content words dropped or changed",
        `${f.contentMatched} of ${f.contentTotal} content words recalled; ` +
          `${f.contentDeviationsEffective} missing or replaced.`,
        "Hold the content words first — they carry the meaning this task measures."
      );
    }
    if (f.morphContentSubs > 0) {
      add(
        "Tense, number, and aspect",
        `${f.morphContentSubs} word(s) repeated with a different ending.`,
        "Match the ending you heard; tense and number change the meaning."
      );
    }
    if (f.transpositions > 0) {
      add(
        "Transpositions",
        `${f.transpositions} word(s) repeated out of order.`,
        "Keep the order you heard — the words were right, the sequence was not."
      );
    }
    if (f.functionDeviations > 0) {
      add(
        "Function words dropped or changed",
        `${f.functionDeviations} function word(s) changed or missing.`,
        "Keep the small words: articles, prepositions and auxiliaries complete the grammar."
      );
    }
    if (f.selfCorrectionCount > 0 || !f.reachesEnd) {
      add(
        "Run length and hesitation",
        f.reachesEnd
          ? `${f.selfCorrectionCount} self-correction(s), sentence completed.`
          : `Trailed off before the end; ${f.tailOmittedRun} word(s) never reached.`,
        "Carry the whole sentence through to its end before correcting detail."
      );
    }
    if (verdict !== "clear") {
      add(
        "Intelligibility",
        `Delivery was ${verdict} for this utterance.`,
        "Slow slightly and finish each word — clarity is part of the score."
      );
    }
  }

  const flags = [];
  if (verdict === "uncertain") flags.push("INTELLIGIBILITY_UNCERTAIN");
  if (!f.isFullSentence) flags.push("PARTIAL_ATTEMPT");

  // Belt and braces: these are built here, not parsed, but the closed lists are
  // the contract and a future edit that drifts from them should fail loudly
  // rather than write a feature name the review UI cannot render.
  for (const it of items) {
    if (!LAR_FEATURES.has(it.feature)) {
      throw new Error(`LAR Layer B feature not on the closed list: ${it.feature}`);
    }
  }
  for (const fl of flags) {
    if (!LAR_FLAGS.has(fl)) {
      throw new Error(`LAR Layer B flag not on the closed list: ${fl}`);
    }
  }

  return { items, flags, label: LAYER_B_LABEL };
}

// WHY THIS THROWS TODAY. None of the three runtime inputs has a producer yet:
// wordTimings and sttMeta are written by B10-PP's own pipeline into the
// `submissions` collection (functions/index.js Stage 00), NOT into
// toeflSubmissions; responseBoundaries has no producer anywhere in the repo;
// and intelligibility is an injected verdict the comparer refuses to infer.
// Week 1's transcription work is what lands them. Until then this is a data
// failure and is reported as one, naming exactly which inputs are absent — the
// same discipline BAS established: a missing input is never a student's zero.
// When the inputs land, the fix is to stop throwing, not to write this.
async function scoreListenAndRepeat(db, { submissionId, submission, itemId }) {
  const ctx = { submissionId, taskType: "LAR", itemId };

  const itemRef = db.collection("toeflItems").doc(itemId);
  const itemSnap = await itemRef.get();
  if (!itemSnap.exists) {
    throw new Error(`item document missing at toeflItems/${itemId}`);
  }
  const item = itemSnap.data();

  // No answerKey read, and deliberately none: LAR is the one type the importer
  // registers with answerKey:false. The "correct answer" IS the utterance text
  // on the item, because the task is repetition. Nothing here reaches the
  // protected subcollection.
  const utterances = item.utterances;
  if (!Array.isArray(utterances) || utterances.length !== LAR_UTTERANCE_COUNT) {
    throw new Error(
      `item ${itemId} has ${Array.isArray(utterances) ? utterances.length : "no"} ` +
        `utterances, expected exactly ${LAR_UTTERANCE_COUNT}`
    );
  }

  // INDEX BASE, asserted rather than assumed — this data model carries three.
  // MCQ questionIndex and CTW gapIndex are 1-based; BAS fragmentIndex is
  // 0-based. LAR's utteranceIndex is 1-BASED: the importer writes
  // `utterances.length + 1` as it walks the four part headers. The comparer's
  // Stage 01 expects 1-based too and converts to array position in exactly one
  // place, so nothing converts here. If the importer ever changed base, this
  // assertion is what catches it instead of a silent off-by-one shifting every
  // utterance's score by one — the INT bug class.
  //
  // basSameOrder is generic ordered array-equality despite the BAS-prefixed
  // name; reused rather than duplicated.
  const indices = utterances.map((u) => u && u.utteranceIndex);
  const expected = utterances.map((_, i) => i + 1);
  if (!basSameOrder(indices, expected)) {
    throw new Error(
      `item ${itemId} utteranceIndex values are ${JSON.stringify(indices)}, ` +
        `expected contiguous 1-based ${JSON.stringify(expected)}`
    );
  }

  const targets = utterances.map((u) => {
    if (typeof u.text !== "string" || u.text.trim() === "") {
      throw new Error(`item ${itemId} utterance ${u.utteranceIndex} has no text`);
    }
    return u.text;
  });

  // ── Runtime inputs. All three are absent today; see the note above.
  //
  // Read from responseContent because that is where every other branch reads
  // student runtime data (answers, gapResponses, text, transcripts,
  // submittedOrder). The exact field names are the transcription work's to
  // confirm — if it lands them elsewhere, this is the one place that changes.
  const rc = submission.responseContent || {};
  const missing = [];
  if (!Array.isArray(rc.wordTimings)) missing.push("wordTimings");
  if (!Array.isArray(rc.responseBoundaries)) missing.push("responseBoundaries");
  if (!rc.intelligibility) missing.push("intelligibility");

  if (missing.length) {
    logger.error("scoreListenAndRepeat: runtime inputs not available", {
      ...ctx,
      missing,
      note:
        "LAR scoring needs word-level timings, per-utterance response " +
        "boundaries, and an injected intelligibility verdict. None has a " +
        "producer yet — Week 1 transcription work lands them. The comparer " +
        "itself is built and tested; this is missing input, not missing logic.",
    });
    throw new Error(
      `submission ${submissionId}: LAR cannot be scored — responseContent is ` +
        `missing ${missing.join(", ")} (no producer exists yet)`
    );
  }

  const result = compareLAR({
    targets,
    boundaries: rc.responseBoundaries,
    wordTimings: rc.wordTimings,
    intelligibility: rc.intelligibility,
  });

  // DEFERRED, deliberately: the withheld-status design question.
  //
  // compareLAR has three outcomes; this trigger has two. A withheld result is
  // neither "scored" nor "queued" — the comparer ran correctly and REFUSED,
  // which is a real terminal outcome with no status value to carry it. That
  // needs a data-model decision, and it is not being made today, because no
  // genuine withheld case can occur until the inputs above exist.
  //
  // Until then this throws rather than guessing a status. It is loud on
  // purpose: writing "error" for a correct refusal would be wrong, and writing
  // "scored" with no bands would be wrong differently. Neither gets chosen by
  // accident.
  if (result.status === "withheld") {
    throw new Error(
      `submission ${submissionId}: LAR comparer withheld (${result.reason}) — ` +
        `no scoringStatus value models a deliberate refusal yet; this is the ` +
        `deferred withheld-status design question, not a scoring failure`
    );
  }

  logger.info("scoreListenAndRepeat: scored", {
    ...ctx,
    bands: result.utterances.map((u) => u.band),
    needsHumanReview: result.needsHumanReview,
    orphanFlag: result.orphanFlag,
  });

  // perUtteranceResults mirrors MCQ's perQuestionResults naming, with each
  // entry carrying EM/DISC/INT's layerA/layerB shape. NO aggregate band: the
  // spec forbids a response-level rollup outright, matching INT's precedent,
  // so there is nothing to total here.
  return {
    perUtteranceResults: result.utterances.map((u) => ({
      utteranceIndex: u.utteranceIndex,
      layerA: { score: u.band, rationale: larRationale(u, result.intelligibilityOverall) },
      layerB: larLayerB(u, result.intelligibilityOverall),
      // Sibling to layerA/layerB, not folded into either: the spec requires a
      // human reviewer to see the evidence behind the band, and Layer B is
      // practice focus rather than evidence. Same copy-back reasoning as MCQ's
      // rationales and BAS's correctOrder.
      diffResult: u.diffResult,
      // Named referenceText, not target: data model v1.17 already defined this
      // field as perUtteranceResults[].referenceText, and v1.18 settles the
      // spec name as the one of record (JC 2026-09-17).
      referenceText: targets[u.utteranceIndex - 1],
      // The student side of the pair. Data model v1.17 lists it in
      // perUtteranceResults and nothing was writing it, which left the output
      // with no student text at all — so "reference: X, you said: Y" feedback
      // was structurally impossible (JC 2026-09-17). The comparer already
      // segments the transcript per utterance; this is that segment's words, in
      // the comparer's normalised form (lower case, no punctuation, hyphens
      // split), which is what it actually scored against the reference.
      matchedTranscript: (u.hypTokens || []).join(" "),
      part: utterances[u.utteranceIndex - 1].part,
      matchedClauses: u.matchedClauses,
      capsApplied: u.capsApplied,
      selfCorrections: u.selfCorrections,
      needsHumanReview: u.needsHumanReview,
    })),
    needsHumanReview: result.needsHumanReview,
    orphanCount: result.orphanCount,
    orphanFlag: result.orphanFlag,
  };
}

// Registered but unbuilt. The branch exists so the dispatch shape is settled;
// the logic behind it is genuinely not written yet and must not pretend to be.
// An unbuilt type leaves scoringStatus at "queued" — accurate, since the
// submission really is queued for a scorer that does not exist. It is not an
// "error": nothing failed.
function notBuiltYet(taskType, arrivingWhen) {
  return async () => {
    logger.warn(`toeflScoring: no scorer for ${taskType} yet (${arrivingWhen})`);
    return null; // null = leave the document alone
  };
}

const SCORERS = {
  // MCQ — live today.
  //
  // LTC belongs here and was missing until Sep 10, which meant every LTC
  // submission fell through to the trigger's unknown-taskType branch and was
  // written as scoringStatus "error" — worse than notBuiltYet, which at least
  // leaves an unbuilt type at "queued". Confirmed against real content before
  // wiring it: LTC-001's answerKey is {questionIndex, correctOptionId,
  // rationales} with four options and four rationales per question, exactly
  // scoreMcq's contract. LTC is absent from the data model's own MCQ list and
  // from the import spec's both-writes check, which is how it went unnoticed
  // in both places — see the LTC SPEC GAP note the importer prints.
  AP: scoreMcq,
  AT: scoreMcq,
  LTC: scoreMcq,
  RDL: scoreMcq,
  LCR: scoreMcq,
  LTA: scoreMcq,

  // Constructed response — Layer A/B.
  INT: scoreInterview,
  EM: scoreEmail,
  DISC: scoreDiscussion,

  // Remaining deterministic types — later gates.
  CTW: scoreCompleteTheWords,
  BAS: scoreBuildASentence,

  // LAR was the LAST notBuiltYet entry. The comparer behind it is built and
  // tested; what is still missing is its three runtime inputs, which is a data
  // failure the branch reports by name rather than a missing scorer. See the
  // note above scoreListenAndRepeat.
  //
  // notBuiltYet is deliberately kept below even though nothing calls it now:
  // it documents the dispatch shape for the next type that needs it, and
  // scripts/testToeflScorerRegistry.js asserts explicitly that the set is
  // empty rather than passing vacuously over it.
  LAR: scoreListenAndRepeat,
};

// ── Trigger ───────────────────────────────────────────────────────────────────

exports.onToeflSubmissionCreated = onDocumentCreated(
  // secrets: the EM branch (and INT/DISC after it) calls the Anthropic API;
  // INT and LAR are transcribed with Deepgram first (lib/toeflTranscription).
  // Declared on the trigger so the runtime mounts them; the MCQ types never
  // read either.
  {
    document: "toeflSubmissions/{submissionId}",
    secrets: [ANTHROPIC_API_KEY, DEEPGRAM_API_KEY],
  },
  async (event) => {
    const submissionId = event.params.submissionId;
    const submission = event.data?.data();

    if (!submission) {
      logger.error("onToeflSubmissionCreated: no data on event", {
        submissionId,
      });
      return;
    }

    const db = admin.firestore();
    const submissionRef = db.collection("toeflSubmissions").doc(submissionId);
    const { taskType, attemptId } = submission;

    const scorer = SCORERS[taskType];
    if (!scorer) {
      logger.error("onToeflSubmissionCreated: unknown taskType", {
        submissionId,
        taskType,
      });
      await submissionRef.update({ scoringStatus: "error" });
      return;
    }

    // Retry-safe claim. Cloud Functions can redeliver the same event, including
    // while the first delivery is still mid-flight. The status read and the
    // "scoring" write therefore have to be one atomic step: a get-then-set
    // leaves a window in which a redelivery sees a non-terminal status and
    // proceeds, and for EM (and INT/DISC after it) proceeding means a second
    // paid Anthropic call for one submission, with no guarantee the second
    // score matches the first.
    //
    // The read is inside the transaction and against the live document on
    // purpose. event.data is the create-time snapshot and by definition never
    // carries a status written by an earlier delivery of the same event, which
    // is why the previous check could not see either terminal state.
    let skipReason;
    try {
      skipReason = await db.runTransaction(async (tx) => {
        const snap = await tx.get(submissionRef);
        if (!snap.exists) return "document gone";

        const status = snap.data().scoringStatus;
        if (status === "scoring" || status === "scored") return status;

        // scoringStartedAt is written for triage only: nothing reads it today.
        // A delivery that claims a document and then dies (OOM, timeout, deploy
        // eviction) leaves it at "scoring" forever, and the guard above will
        // correctly refuse to re-score it. This timestamp is what makes those
        // documents findable by query. Recovery itself is tracked separately.
        tx.update(submissionRef, {
          scoringStatus: "scoring",
          scoringStartedAt: FieldValue.serverTimestamp(),
        });
        return null; // null = this delivery owns the scoring
      });
    } catch (err) {
      // Deliberately no "error" write here. A failed claim means the status is
      // unknown, and another delivery may legitimately be holding the document
      // at "scoring"; stamping "error" would clobber a run that is still live.
      logger.error("onToeflSubmissionCreated: claim failed", {
        submissionId,
        taskType,
        error: err.message,
      });
      return;
    }

    if (skipReason !== null) {
      logger.info("onToeflSubmissionCreated: not claimed, skipping", {
        submissionId,
        taskType,
        skipReason,
      });
      return;
    }

    try {
      // toeflSubmissions carries no itemId (data model Collection 3) — the
      // route to the item, and therefore to the answer key, runs through the
      // parent attempt. Read only: the attempt's own completedAt is set
      // client-side at submit time, per Collection 2 ("marked complete when
      // they submit"), and is not this function's to touch.
      const attemptSnap = await db
        .collection("toeflAttempts")
        .doc(attemptId)
        .get();
      if (!attemptSnap.exists) {
        throw new Error(`attempt ${attemptId} not found`);
      }
      const itemId = attemptSnap.data().itemId;

      // Spoken types: transcribe inside the claimed run, so Deepgram is called
      // once per submission, then score what was actually heard. A failure
      // throws into the catch below and the submission is marked "error";
      // the scorer is never reached.
      const transcriber = TRANSCRIBERS[taskType];
      const toScore = transcriber
        ? await transcriber({
            db,
            bucket: admin.storage().bucket(),
            submissionRef,
            submission,
            apiKey: DEEPGRAM_API_KEY.value(),
            logger,
            serverTimestamp: () => FieldValue.serverTimestamp(),
          })
        : submission;

      const result = await scorer(db, { submissionId, submission: toScore, itemId });

      if (result === null) {
        // Unbuilt type. Put the status back rather than leaving it "scoring"
        // forever, and write nothing else.
        await submissionRef.update({ scoringStatus: "queued" });
        return;
      }

      // Unconditional overwrite of the result fields. The create rule does not
      // validate submission fields, so a client could in principle have written
      // its own perQuestionResults at create time; whatever it wrote is
      // replaced here with the server's computation.
      await submissionRef.update({
        ...result,
        scoringStatus: "scored",
        scoredAt: FieldValue.serverTimestamp(),
      });

      logger.info("onToeflSubmissionCreated: scored", {
        submissionId,
        taskType,
        itemId,
      });
    } catch (err) {
      logger.error("onToeflSubmissionCreated: scoring failed", {
        submissionId,
        taskType,
        error: err.message,
      });
      await submissionRef.update({ scoringStatus: "error" });
    }
  }
);
