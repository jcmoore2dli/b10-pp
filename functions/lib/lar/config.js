// functions/lib/lar/config.js
// LAR comparer configuration.
//
// Everything a rubric change would touch lives here, so that a rubric change
// is a config edit and never a code edit (Stage 06).
//
// THREE KINDS OF VALUE LIVE HERE, and they are marked differently:
//
//   FROM SPEC        BAND_PATTERNS band labels and their named features, taken
//                    verbatim from the LAR spec text. Bands are 0..5.
//   INTERPRETATION   numbers standing in for spec words that carry no number
//                    ("several", "most", "a few", "longer prompts"). Every one
//                    is band-affecting and needs sign-off individually.
//   provisional:true NOT from the spec at all — a placeholder. Any output
//                    computed under one is stamped in `provisionalRules` so it
//                    can never be mistaken for a scored value.

"use strict";

// ── Contract (Stage 01) ────────────────────────────────────────────────────
const UTTERANCE_COUNT = 7;

// ── Transposition window (Decision 4, CONFIRMED) ───────────────────────────
// W = 3, measured as distance in the post-alignment op sequence.
// Non-adjacent moves still collapse to a single transposition.
const TRANSPOSITION_WINDOW = 3;

// PENDING SIGN-OFF - NOT part of the six confirmed decisions.
// An ADJACENT swap ("quick brown" -> "brown quick") does not surface from
// minimum-edit alignment as the DEL+INS pair Stage 05 looks for; it surfaces
// as two SUBs, and therefore costs TWO deviations, not one. Setting this true
// collapses a consecutive SUB pair whose tokens are each other's counterpart
// into a single TRANSPOSITION.
// This is BAND-AFFECTING. Left false so the shipped behaviour is exactly the
// design as written. See the build report.
const ADJACENT_SWAP_AS_TRANSPOSITION = false;

// ── Self-correction collapse (Decision 6, CONFIRMED) ───────────────────────
// "restarted within roughly one second"
const SELF_CORRECTION_MAX_GAP_MS = 1000;
// "a word or short function-word sequence" — max length of a repeated
// function-word run that collapses as one restart.
const SELF_CORRECTION_MAX_SEQ = 3;
// A truncated false start ("the-", "wal-") is a prefix of the retry.
// Minimum prefix length, so "a" does not swallow every following a-word.
const SELF_CORRECTION_MIN_PREFIX = 2;

// PHRASE RESTART (corpus ruling, item 2): "the cat... the dog sat" is scored
// as "the dog sat". The aborted attempt shares a leading FUNCTION word with
// the retry but carries a different content word, so the repeat-of-itself
// test cannot see it. Max length of the aborted run that may be dropped —
// kept tight (2) because a larger span starts swallowing genuine material:
// "the man walked to the store" repeats "the" at distance 4.
const SELF_CORRECTION_MAX_ABORTED_RUN = 2;

// ── Intelligibility (Decision 3, CONFIRMED; producer ruling JC 2026-09-18) ──
// Decision 3: unintelligible WITHHOLDS; it never floors. Only a human in
// live-class Layer 3 may reach it — the automated producer
// (lib/lar/intelligibility.js) can say "clear" or "uncertain", never
// "unintelligible". The old 0.85 / 0.60 thresholds, whose "below 0.60 →
// unintelligible" contradicted that ruling, were never read and are gone.
//
// PROVISIONAL, ALL THREE NUMBERS: chosen before any real learner speech
// existed, so none is validated. An utterance is "uncertain" only when BOTH
// hold — broad (most words low) AND sustained (a run of low words together).
// Either alone is an isolated dip and triggers nothing.
const INTELLIGIBILITY = {
  provisional: true,
  lowWordConf: 0.70,  // a word below this Deepgram confidence is "low"
  minLowShare: 0.50,  // broad: at least this share of the utterance's words low
  minLowRun: 3,       // sustained: at least this many low words in a row
  // Filled pauses carry no content to be trustworthy about. Same set as
  // claudeScorer's FILLED_PAUSE_TOKENS, which counts them for delivery.
  fillerTokens: ["uh", "um", "eh", "uh-huh", "mm"],
};

// ── Orphan policy (Decision 5, CONFIRMED) ──────────────────────────────────
// Orphans are excluded from deviation counts, counted, and persisted.
// Above this ratio the boundaries are suspect and a data-quality flag is
// raised — it never lowers a student's band.
const ORPHAN_RATIO_FLAG = 0.25;

// ── Band patterns (Stage 06) ───────────────────────────────────────────────
// FROM SPEC, verbatim, six bands 0..5. Top band = 5.
//
// These are QUALITATIVE FEATURE PATTERNS, not a deviation-rate lookup. Each
// band is a declarative predicate over the feature vector (see features.js),
// evaluated by a generic matcher in band.js — so the rubric stays data here
// and never becomes logic there.
//
// SCORING RULE (JC, holistic-rating judgment, not spec text):
// take the LOWEST band that any genuinely-present feature set independently
// supports. Never average upward from an isolated band-4 feature.
//
// Values written as "@NAME" resolve to the INTERPRETATION constant of that
// name below.

const BAND_TOP = 5;

// ── Caps (Stage 06c), applied AFTER matching, BEFORE the gate ──────────────
// FROM THE CORPUS RULING (item 1), not interpretation: three or more
// function-word slips cross into band 3 even where each alone reads as band 4.
// Held as an explicit mechanical check on the functionDeviations count, kept
// deliberately OUT of the meaning-preservation framing in BAND_PATTERNS.
const FUNCTION_WORD_ACCUMULATION = {
  threshold: 3,
  capBand: 3,
  reason: "three or more function-word slips",
};

// Spec words that carry no number. These are OPERATIONALIZATIONS, not spec
// text, and every one of them is band-affecting. Marked so they can be found
// and signed off individually.
const INTERPRETATION = {
  // "one or two function words" — FROM SPEC, not interpretation.
  FUNCTION_DEVIATIONS_MINOR_MAX: 2,
  // "several function words changed/missing"
  FUNCTION_DEVIATIONS_SEVERAL_MIN: 3,
  // "most of the content words"
  MOST_CONTENT_WORDS: 0.6,
  // "a few words only"
  FEW_WORDS_MAX: 3,
  // "(longer prompts)" — target length at which a missing content word is minor
  LONGER_PROMPT_MIN_TOKENS: 12,
  // "a full sentence" / "not a self-standing sentence"
  FULL_SENTENCE_MIN_LENGTH_RATIO: 0.7,
};

const BAND_PATTERNS = [
  {
    band: 5,
    label: "exact repetition, fully intelligible",
    anyOf: [
      {
        id: "exact",
        when: { all: [["exact", "==", true], ["selfCorrectionCount", "==", 0]] },
      },
    ],
  },
  {
    band: 4,
    label: "meaning preserved with minor deviation",
    anyOf: [
      {
        // "one or two function words missing/changed"
        id: "minor-function-words",
        when: {
          all: [
            ["functionDeviations", ">=", 1],
            ["functionDeviations", "<=", "@FUNCTION_DEVIATIONS_MINOR_MAX"],
            ["contentDeviationsEffective", "==", 0],
          ],
        },
      },
      {
        // "tense/aspect/number markers off"
        id: "morphological-marker",
        when: {
          all: [
            ["morphContentSubs", ">=", 1],
            ["contentDeviationsEffective", "==", 0],
          ],
        },
      },
      {
        // "two words transposed"
        id: "transposition",
        when: { all: [["transpositions", ">=", 1]] },
      },
      {
        // "a self-correction that still completes the sentence"
        id: "self-correction-completed",
        when: { all: [["selfCorrectionCompleted", "==", true]] },
      },
      {
        // "or (longer prompts) missing" — one content word, long prompt
        id: "content-word-missing-longer-prompt",
        when: {
          all: [
            ["tokenCount", ">=", "@LONGER_PROMPT_MIN_TOKENS"],
            ["contentDeviationsEffective", "==", 1],
            ["contentDeletions", "==", 1],
            ["contentSubs", "==", 0],
          ],
        },
      },
      {
        // "a content word replaced by a RELATED word".
        // Relatedness is not decidable from a diff. This clause can only fire
        // when a lexical resource supplies the judgment; while
        // `contentRelatednessAvailable` is false it never fires, and the
        // single-content-substitution case falls to band 3 with
        // `needsHumanReview` set. Conservative by construction: it never
        // inflates a band on a guess.
        id: "content-word-related-substitution",
        when: {
          all: [
            ["contentSubs", "==", 1],
            ["contentDeviationsEffective", "==", 1],
            ["contentRelatednessAvailable", "==", true],
            ["contentSubIsRelated", "==", true],
          ],
        },
      },
    ],
  },
  {
    band: 3,
    label:
      "full sentence, most content words, original meaning not accurately captured",
    anyOf: [
      {
        // "several function words changed/missing" — a PURE COUNT check, with
        // no meaning-preservation conditions attached, per the corpus ruling
        // (item 1). This mirrors the FUNCTION_WORD_ACCUMULATION cap in
        // applyCaps and reads the same threshold; the cap is the rule of
        // record, this clause keeps BAND_PATTERNS exhaustive so such a vector
        // matches a band instead of withholding.
        id: "function-word-accumulation",
        when: {
          all: [
            ["functionDeviations", ">=", "@FUNCTION_DEVIATIONS_SEVERAL_MIN"],
          ],
        },
      },
      {
        // CORPUS RULING (item 3): a self-correction followed by an abandoned
        // or trailing-off attempt scores the missing portion as missing
        // content, landing at band 3 OR 2 by severity — never automatically
        // band 2. Most of the content still retained lands here.
        id: "incomplete-most-content-retained",
        when: {
          all: [
            ["isFullSentence", "==", false],
            ["contentRecallRatio", ">=", "@MOST_CONTENT_WORDS"],
            ["hypTokenCount", ">", "@FEW_WORDS_MAX"],
          ],
        },
      },
      {
        // "one or more content words missing or substantively changed"
        id: "content-words-substantively-changed",
        when: {
          all: [
            ["isFullSentence", "==", true],
            ["contentRecallRatio", ">=", "@MOST_CONTENT_WORDS"],
            ["contentDeviationsEffective", ">=", 2],
          ],
        },
      },
      {
        // Band 4 treats ONE missing content word as minor only on a longer
        // prompt. On a shorter prompt the same omission is band 3's "one or
        // more content words missing". Without this clause that case matches
        // no pattern at all and withholds.
        id: "one-content-word-missing-short-prompt",
        when: {
          all: [
            ["isFullSentence", "==", true],
            ["contentRecallRatio", ">=", "@MOST_CONTENT_WORDS"],
            ["contentDeviationsEffective", "==", 1],
            ["contentDeletions", "==", 1],
            ["tokenCount", "<", "@LONGER_PROMPT_MIN_TOKENS"],
          ],
        },
      },
      {
        // The undecidable single content substitution lands here, not at 4.
        id: "content-substitution-relatedness-unknown",
        when: {
          all: [
            ["isFullSentence", "==", true],
            ["contentRecallRatio", ">=", "@MOST_CONTENT_WORDS"],
            ["contentDeviationsEffective", "==", 1],
            ["contentSubs", "==", 1],
            ["contentRelatednessAvailable", "==", false],
          ],
        },
      },
    ],
  },
  {
    band: 2,
    label:
      "significant part missing or highly inaccurate; not a self-standing sentence",
    anyOf: [
      {
        // CORPUS RULING (item 3): the severity half of the trailing-loss
        // split. A significant part of the content actually lost lands here;
        // most of it retained lands at band 3 instead.
        // No hypTokenCount guard: band 1 now requires isFullSentence == false,
        // so it no longer needs protecting from band 2. With the guard in
        // place a SHORT target whose only content word was wrong matched no
        // band at all and withheld.
        id: "significant-content-missing",
        when: {
          all: [["contentRecallRatio", "<", "@MOST_CONTENT_WORDS"]],
        },
      },
    ],
  },
  {
    band: 1,
    label: "a few words only, or an attempt that is mostly unintelligible",
    anyOf: [
      {
        // "a few words only" describes a FRAGMENTARY response, not a short
        // prompt. Without the isFullSentence condition a three-word target
        // repeated perfectly bands 1 on absolute token count alone.
        id: "few-words-only",
        when: {
          all: [
            ["hypTokenCount", ">=", 1],
            ["hypTokenCount", "<=", "@FEW_WORDS_MAX"],
            ["isFullSentence", "==", false],
            ["isNoAttempt", "==", false],
          ],
        },
      },
    ],
  },
  {
    band: 0,
    label: 'nothing, no English, unconnected, or "I don\'t know"',
    anyOf: [
      { id: "nothing", when: { all: [["hypTokenCount", "==", 0]] } },
      { id: "no-attempt", when: { all: [["isNoAttempt", "==", true]] } },
    ],
  },
];

// Band 0's "no English" and "unconnected" are not decidable from a diff
// against an English reference; only "nothing" and the fixed no-attempt
// phrases below are detected. See the build report.
const NO_ATTEMPT_PHRASES = [
  "i do not know",
  "i don't know",
  "no idea",
  "i can not remember",
  "i do not remember",
  "pass",
];

// ── Normalization rules (Stage 03) ─────────────────────────────────────────
// Decision 1 (CONFIRMED): split on hyphen on BOTH sides.
const HYPHEN_SPLIT = true;

// "spec rule" in the design; the spec is not in this repo.
const CONTRACTIONS = {
  provisional: true,
  map: {
    "don't": "do not", "doesn't": "does not", "didn't": "did not",
    "won't": "will not", "wouldn't": "would not", "can't": "can not",
    "cannot": "can not", "couldn't": "could not", "shouldn't": "should not",
    "isn't": "is not", "aren't": "are not", "wasn't": "was not",
    "weren't": "were not", "haven't": "have not", "hasn't": "has not",
    "hadn't": "had not", "i'm": "i am", "i've": "i have", "i'll": "i will",
    "i'd": "i would", "you're": "you are", "you've": "you have",
    "you'll": "you will", "you'd": "you would", "he's": "he is",
    "she's": "she is", "it's": "it is", "we're": "we are", "we've": "we have",
    "we'll": "we will", "we'd": "we would", "they're": "they are",
    "they've": "they have", "they'll": "they will", "they'd": "they would",
    "that's": "that is", "there's": "there is", "what's": "what is",
    "let's": "let us",
  },
};

// Single-token number words only. Multi-token compounds ("twenty five") are
// deliberately NOT joined — see the numeral/hyphen interaction flagged in the
// build report.
const NUMERALS = {
  provisional: true,
  map: {
    zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
    six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11",
    twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15",
    sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19",
    twenty: "20", thirty: "30", forty: "40", fifty: "50", sixty: "60",
    seventy: "70", eighty: "80", ninety: "90", hundred: "100",
    thousand: "1000",
  },
};

// ── Function words (Stage 04) ──────────────────────────────────────────────
// Closed class, fixed list: determiner, preposition, auxiliary, pronoun,
// conjunction, particle, copula.
const FUNCTION_WORDS = new Set([
  // determiners
  "a", "an", "the", "this", "that", "these", "those", "some", "any", "each",
  "every", "no", "another", "both", "either", "neither", "such", "what",
  "which", "whose",
  // prepositions
  "about", "above", "across", "after", "against", "along", "among", "around",
  "at", "before", "behind", "below", "beneath", "beside", "between", "beyond",
  "by", "despite", "down", "during", "except", "for", "from", "in", "inside",
  "into", "near", "of", "off", "on", "onto", "out", "outside", "over", "past",
  "since", "through", "throughout", "to", "toward", "towards", "under",
  "until", "up", "upon", "with", "within", "without",
  // auxiliaries + copula
  "am", "is", "are", "was", "were", "be", "been", "being", "do", "does",
  "did", "have", "has", "had", "having", "will", "would", "shall", "should",
  "can", "could", "may", "might", "must", "ought",
  // pronouns
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us",
  "them", "my", "your", "his", "its", "our", "their", "mine", "yours",
  "hers", "ours", "theirs", "myself", "yourself", "himself", "herself",
  "itself", "ourselves", "yourselves", "themselves", "who", "whom",
  // conjunctions
  "and", "but", "or", "nor", "so", "yet", "because", "although", "though",
  "while", "whereas", "if", "unless", "whether", "than", "as", "when",
  "where", "why", "how", "that",
  // particles / negation
  "not", "n't", "there", "here",
]);

// ── Morphological variants (band 4: "tense/aspect/number markers off") ─────
// Suffix stripping catches the regular cases; the table catches the
// high-frequency irregulars that a stemmer cannot. HEURISTIC — band-affecting.
const MORPH_SUFFIXES = ["ing", "ed", "es", "en", "s", "d", "n"];

const MORPH_IRREGULARS = [
  ["is", "are"], ["is", "was"], ["is", "were"], ["are", "were"],
  ["was", "were"], ["be", "been"], ["be", "being"], ["am", "is"],
  ["am", "was"], ["has", "have"], ["has", "had"], ["have", "had"],
  ["do", "does"], ["do", "did"], ["does", "did"],
  ["this", "these"], ["that", "those"],
  ["man", "men"], ["woman", "women"], ["child", "children"],
  ["person", "people"], ["foot", "feet"], ["tooth", "teeth"],
  ["goes", "went"], ["go", "went"], ["take", "took"], ["give", "gave"],
  ["find", "found"], ["make", "made"], ["come", "came"], ["see", "saw"],
];

module.exports = {
  UTTERANCE_COUNT,
  TRANSPOSITION_WINDOW,
  ADJACENT_SWAP_AS_TRANSPOSITION,
  SELF_CORRECTION_MAX_GAP_MS,
  SELF_CORRECTION_MAX_SEQ,
  SELF_CORRECTION_MIN_PREFIX,
  SELF_CORRECTION_MAX_ABORTED_RUN,
  INTELLIGIBILITY,
  ORPHAN_RATIO_FLAG,
  BAND_TOP,
  FUNCTION_WORD_ACCUMULATION,
  BAND_PATTERNS,
  INTERPRETATION,
  NO_ATTEMPT_PHRASES,
  MORPH_SUFFIXES,
  MORPH_IRREGULARS,
  HYPHEN_SPLIT,
  CONTRACTIONS,
  NUMERALS,
  FUNCTION_WORDS,
};
