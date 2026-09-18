// functions/lib/lar/intelligibility.js
// The intelligibility producer: builds the injected verdict compareLAR
// requires. Pure function over the same wordTimings and responseBoundaries
// the comparer reads.
//
// THE QUESTION IT ASKS (JC 2026-09-18): "is this transcript trustworthy
// evidence of what was said?" — never "does this sound non-native?". The two
// carry very different accent-bias risk, so the rules are narrow:
//
//   - Word scoring is untouched. A word Deepgram mishears is already a
//     substitution or deletion in the comparer; this module adds nothing to it.
//   - An isolated low-confidence word never triggers anything, including a
//     correctly matched one (the accent-bias case).
//   - Only BROAD and SUSTAINED low confidence — most of the utterance, low
//     together — makes an utterance "uncertain" (config.INTELLIGIBILITY).
//   - The output is "clear" or "uncertain". Never "unintelligible": withholding
//     is a human decision, made live in class (Layer 3).
//   - overall is always "clear". compareLAR caps EVERY utterance when overall
//     is "uncertain", so one uncertain sentence would cap all seven; the
//     per-utterance verdicts carry the automated call instead.
//   - Evidence is counts only. No word identities, so nothing here can become
//     pronunciation feedback.
//
// Matched words DO count toward the share (JC 2026-09-18). One low matched word
// still cannot trigger — it is neither broad nor sustained — but a sentence
// that matches while low throughout is not trustworthy evidence either:
// Deepgram's language model can turn unclear audio into fluent, target-like
// text. Counting them needs no alignment, so this runs before the comparer.

"use strict";

const { INTELLIGIBILITY } = require("./config");
const { assertContract, ContractFailure } = require("./contract");
const { segment } = require("./segment");

const SOURCE = "stt-confidence-broad-sustained";

const FILLERS = new Set(INTELLIGIBILITY.fillerTokens);
const isFiller = (w) =>
  FILLERS.has(String(w || "").toLowerCase().replace(/[^a-z-]/g, ""));

/**
 * One utterance's verdict from its words, in time order.
 * A word with no confidence value is kept in the count but never counts as
 * low: missing data is not evidence of unreliability.
 */
function assessWords(words, cfg = INTELLIGIBILITY) {
  const scored = words
    .filter((w) => !isFiller(w.w))
    .sort((a, b) => a.startMs - b.startMs);

  let lowCount = 0;
  let run = 0;
  let longestLowRun = 0;
  const confs = [];
  for (const w of scored) {
    const hasConf = typeof w.conf === "number";
    if (hasConf) confs.push(w.conf);
    if (hasConf && w.conf < cfg.lowWordConf) {
      lowCount += 1;
      run += 1;
      longestLowRun = Math.max(longestLowRun, run);
    } else {
      run = 0;
    }
  }

  const wordCount = scored.length;
  const lowShare = wordCount === 0 ? 0 : lowCount / wordCount;
  const broad = lowShare >= cfg.minLowShare;
  const sustained = longestLowRun >= cfg.minLowRun;
  const meanConf = confs.length
    ? Number((confs.reduce((a, b) => a + b, 0) / confs.length).toFixed(4))
    : null;

  return {
    verdict: broad && sustained ? "uncertain" : "clear",
    conf: meanConf,
    evidence: {
      wordCount,
      lowCount,
      lowShare: Number(lowShare.toFixed(4)),
      longestLowRun,
      thresholds: {
        lowWordConf: cfg.lowWordConf,
        minLowShare: cfg.minLowShare,
        minLowRun: cfg.minLowRun,
      },
    },
  };
}

/**
 * @returns the compareLAR intelligibility input
 *   { perUtterance: [{ utteranceIndex, verdict, source, conf, evidence }],
 *     overall: "clear", source, provisional }
 *   or null when the boundaries fail the contract. compareLAR checks the
 *   contract before intelligibility, so it withholds on the real cause.
 */
function assessIntelligibility({ wordTimings, boundaries, targets }, cfg = INTELLIGIBILITY) {
  let sorted;
  try {
    sorted = assertContract(boundaries, targets);
  } catch (err) {
    if (err instanceof ContractFailure) return null;
    throw err;
  }
  const words = Array.isArray(wordTimings) ? wordTimings : [];
  const { byPos } = segment(words, sorted);

  return {
    perUtterance: sorted.map((b) => ({
      utteranceIndex: b.utteranceIndex,
      source: SOURCE,
      ...assessWords(byPos[b.pos], cfg),
    })),
    overall: "clear",
    source: SOURCE,
    provisional: cfg.provisional === true,
  };
}

module.exports = { assessIntelligibility, assessWords, SOURCE };
