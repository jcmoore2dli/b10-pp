// functions/lib/lar/features.js
// Stage 06a — the feature vector.
//
// The spec's six bands are qualitative FEATURE PATTERNS, not a deviation-rate
// lookup, so Stage 06 no longer reduces a diff to a scalar. This module
// extracts the named features the patterns in config.BAND_PATTERNS refer to,
// and nothing else. It makes no banding decision.
//
// Everything here is derivable from Stages 03-05 output. Two features are
// deliberately NOT derivable and are reported as unavailable rather than
// approximated:
//
//   contentSubIsRelated   "a content word replaced by a RELATED word" (band 4)
//                         needs a lexical resource. While unavailable the
//                         single-content-substitution case falls to band 3 and
//                         raises needsHumanReview.
//   "no English" /        band 0. Not decidable from a diff against an English
//   "unconnected"         reference; only "nothing" and the fixed no-attempt
//                         phrases are detected.

"use strict";

const {
  FUNCTION_WORDS,
  NO_ATTEMPT_PHRASES,
  MORPH_SUFFIXES,
  MORPH_IRREGULARS,
  INTERPRETATION,
} = require("./config");

const IRREGULAR_PAIRS = new Set(
  MORPH_IRREGULARS.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`])
);

function isFunctionWord(text) {
  return FUNCTION_WORDS.has(text);
}

/** Strip one regular inflectional suffix, longest first. */
function stem(word) {
  for (const suf of MORPH_SUFFIXES) {
    if (word.length > suf.length + 2 && word.endsWith(suf)) {
      return word.slice(0, -suf.length);
    }
  }
  return word;
}

/**
 * "tense/aspect/number markers off" (band 4) — the two tokens are the same
 * lexeme wearing a different inflection, not a different word.
 * HEURISTIC. Band-affecting.
 */
function isMorphologicalVariant(a, b) {
  if (!a || !b || a === b) return false;
  if (IRREGULAR_PAIRS.has(`${a}|${b}`)) return true;
  const sa = stem(a);
  const sb = stem(b);
  return sa === sb && sa.length >= 3;
}

function isNoAttemptText(tokens) {
  if (tokens.length === 0) return true;
  const joined = tokens.join(" ");
  return NO_ATTEMPT_PHRASES.some((p) => joined === p);
}

/**
 * Build the feature vector for one utterance.
 *
 * @param {Object} args
 * @param {Array}  args.ops            Stage 05 output
 * @param {Array}  args.targetTokens   normalized target tokens (text)
 * @param {Array}  args.hypTokens      normalized hypothesis tokens (text)
 * @param {Array}  args.selfCorrections Stage 03 trace entries
 * @param {Object} [args.relatedness]  optional lexical judgment supplier
 * @returns {Object} feature vector
 */
function featureVector({
  ops,
  targetTokens,
  hypTokens,
  selfCorrections = [],
  relatedness = null,
}) {
  const counts = { MATCH: 0, SUB: 0, DEL: 0, INS: 0, TRANSPOSITION: 0 };
  for (const o of ops) counts[o.op] = (counts[o.op] || 0) + 1;

  let functionDeviations = 0;
  let contentSubs = 0;
  let contentDeletions = 0;
  let contentInsertions = 0;
  let morphContentSubs = 0;
  let contentMatched = 0;
  const contentSubPairs = [];

  for (const o of ops) {
    // A transposition is one deviation and is counted on its own axis, never
    // as a content or function deviation — the word was said, in the wrong
    // place.
    if (o.op === "TRANSPOSITION") continue;

    const ref = o.tTok || o.hTok;
    const isContent = ref ? !isFunctionWord(ref.text) : false;

    if (o.op === "MATCH") {
      if (isContent) contentMatched += 1;
      continue;
    }

    if (!isContent) {
      functionDeviations += 1;
      continue;
    }

    if (o.op === "SUB") {
      if (isMorphologicalVariant(o.tTok.text, o.hTok.text)) {
        morphContentSubs += 1;
      } else {
        contentSubs += 1;
        contentSubPairs.push({ target: o.tTok.text, hyp: o.hTok.text });
      }
    } else if (o.op === "DEL") {
      contentDeletions += 1;
    } else if (o.op === "INS") {
      contentInsertions += 1;
    }
  }

  // A morphological variant is a band-4 feature in its own right, so it is
  // excluded from the "substantively changed" count that pulls toward band 3.
  const contentDeviationsEffective =
    contentSubs + contentDeletions + contentInsertions;

  const contentTotal = targetTokens.filter((t) => !isFunctionWord(t)).length;
  const contentRecallRatio =
    contentTotal === 0 ? 1 : contentMatched / contentTotal;

  // Omission runs — scattered loss reads differently from a missing chunk.
  let maxOmittedRun = 0;
  let run = 0;
  for (const o of ops) {
    if (o.op === "DEL") {
      run += 1;
      maxOmittedRun = Math.max(maxOmittedRun, run);
    } else {
      run = 0;
    }
  }

  // Trailing omission — did the response reach the end of the sentence, or
  // trail off? Band 4's self-correction clause requires genuine completion.
  let tailOmittedRun = 0;
  for (let i = ops.length - 1; i >= 0; i--) {
    if (ops[i].op === "DEL") tailOmittedRun += 1;
    else break;
  }
  const reachesEnd = tailOmittedRun === 0;

  const tokenCount = targetTokens.length;
  const hypTokenCount = hypTokens.length;
  const lengthRatio = tokenCount === 0 ? 0 : hypTokenCount / tokenCount;

  // "a full sentence" (band 3) vs "not a self-standing sentence" (band 2).
  // INTERPRETATION: reached the end, and is not substantially shorter than
  // the target.
  const isFullSentence =
    reachesEnd &&
    lengthRatio >= INTERPRETATION.FULL_SENTENCE_MIN_LENGTH_RATIO;

  // "a self-correction that still completes the sentence" (band 4).
  // JC: genuine completion required — a self-correction inside an abandoned
  // or trailing-off attempt has NOT completed the sentence and must fall
  // through to whatever its incompleteness warrants.
  const selfCorrectionCount = selfCorrections.length;
  const selfCorrectionCompleted = selfCorrectionCount > 0 && isFullSentence;

  // Relatedness is injected or absent. It is never inferred here.
  const contentRelatednessAvailable =
    typeof relatedness === "function" && contentSubPairs.length === 1;
  const contentSubIsRelated = contentRelatednessAvailable
    ? relatedness(contentSubPairs[0].target, contentSubPairs[0].hyp) === true
    : false;

  const exact =
    counts.SUB === 0 &&
    counts.DEL === 0 &&
    counts.INS === 0 &&
    counts.TRANSPOSITION === 0;

  return {
    exact,
    substitutions: counts.SUB,
    deletions: counts.DEL,
    insertions: counts.INS,
    transpositions: counts.TRANSPOSITION,
    matches: counts.MATCH,

    functionDeviations,
    contentSubs,
    contentDeletions,
    contentInsertions,
    morphContentSubs,
    contentDeviationsEffective,

    contentTotal,
    contentMatched,
    contentRecallRatio,

    tokenCount,
    hypTokenCount,
    lengthRatio,
    isFullSentence,
    reachesEnd,
    tailOmittedRun,
    maxOmittedRun,

    selfCorrectionCount,
    selfCorrectionCompleted,

    contentRelatednessAvailable,
    contentSubIsRelated,
    contentSubPairs,

    isNoAttempt: isNoAttemptText(hypTokens),
  };
}

module.exports = {
  featureVector,
  isMorphologicalVariant,
  isFunctionWord,
  stem,
};
