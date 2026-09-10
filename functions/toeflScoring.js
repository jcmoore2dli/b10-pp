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
const { EM_RUBRIC_PROMPT } = require("./lib/toeflLayerABPrompts");
// Modular import deliberately: under the functions emulator, the namespaced
// admin.firestore.FieldValue is undefined (the runtime wraps admin.firestore
// without carrying its statics). This form is unaffected, and is the v13
// recommendation regardless. See CLAUDE.md, "Functions emulator note".
const { FieldValue } = require("firebase-admin/firestore");

// Same secret already used by B10-PP's own Claude routes in index.js.
// defineSecret is keyed by name, so declaring it here binds the same secret,
// it does not create a second one.
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

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
  AP: scoreMcq,
  AT: scoreMcq,
  RDL: scoreMcq,
  LCR: scoreMcq,
  LTA: scoreMcq,

  // Constructed response — Layer A/B.
  INT: notBuiltYet("INT", "Layer A/B, next"),
  EM: scoreEmail,
  DISC: notBuiltYet("DISC", "Layer A/B, next"),

  // Remaining deterministic types — later gates.
  CTW: notBuiltYet("CTW", "perGapResults, later gate"),
  BAS: notBuiltYet("BAS", "orderCorrect, later gate"),
  LAR: notBuiltYet("LAR", "transcript comparer, later gate"),
};

// ── Trigger ───────────────────────────────────────────────────────────────────

exports.onToeflSubmissionCreated = onDocumentCreated(
  // secrets: the EM branch (and INT/DISC after it) calls the Anthropic API.
  // Declared on the trigger so the runtime mounts it; the five MCQ types never
  // read it.
  { document: "toeflSubmissions/{submissionId}", secrets: [ANTHROPIC_API_KEY] },
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

      const result = await scorer(db, { submissionId, submission, itemId });

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
