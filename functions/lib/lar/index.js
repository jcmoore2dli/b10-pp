// functions/lib/lar/index.js
// LAR comparer pipeline - Stages 01..06.
//
// Pure logic over known field shapes. No emulator, no corpus, no audio, no
// transcription. Stage 00 (persisting wordTimings + sttMeta at pass-1 time)
// is upstream of this module and lives in functions/index.js.
//
// Contract in:
//   targets         Array<string>, length 7, array order = utterance position
//   boundaries      Array<{ utteranceIndex, responseStartMs, responseEndMs }>
//   wordTimings     Array<{ w, startMs, endMs, conf }>  integer ms
//   intelligibility { perUtterance: [{ utteranceIndex, verdict, source, conf }],
//                     overall: "clear"|"uncertain"|"unintelligible" }
//
// A contract failure WITHHOLDS. It never returns a band.

"use strict";

const config = require("./config");
const { assertContract, assertWordTimings, ContractFailure } = require("./contract");
const { segment } = require("./segment");
const { normalizeTarget, normalizeHypothesis } = require("./normalize");
const { align, MATCH } = require("./align");
const { collapseTranspositions, TRANSPOSITION } = require("./transpositions");
const { featureVector } = require("./features");
const { bandUtterance, applyGate, WITHHELD } = require("./band");

const VALID_VERDICTS = new Set(["clear", "uncertain", "unintelligible"]);

function withheld(reason, extra = {}) {
  return { status: "withheld", reason, ...extra };
}

/** Intelligibility is injected. A malformed input withholds; it never defaults. */
function assertIntelligibility(intel, boundaries) {
  if (!intel || typeof intel !== "object") {
    throw new ContractFailure("intelligibility is required and must be injected");
  }
  if (!VALID_VERDICTS.has(intel.overall)) {
    throw new ContractFailure(
      `intelligibility.overall must be one of ${[...VALID_VERDICTS].join("|")} ` +
      `(got ${JSON.stringify(intel.overall)})`
    );
  }
  if (!Array.isArray(intel.perUtterance)) {
    throw new ContractFailure("intelligibility.perUtterance must be an array");
  }
  const byIndex = new Map();
  for (const p of intel.perUtterance) {
    if (!VALID_VERDICTS.has(p.verdict)) {
      throw new ContractFailure(
        `intelligibility.perUtterance[${p.utteranceIndex}].verdict invalid ` +
        `(got ${JSON.stringify(p.verdict)})`
      );
    }
    byIndex.set(p.utteranceIndex, p);
  }
  for (const b of boundaries) {
    if (!byIndex.has(b.utteranceIndex)) {
      throw new ContractFailure(
        `intelligibility.perUtterance missing utterance ${b.utteranceIndex}`
      );
    }
  }
  return byIndex;
}

function countDeviations(ops) {
  const counts = { MATCH: 0, SUB: 0, DEL: 0, INS: 0, TRANSPOSITION: 0 };
  for (const o of ops) counts[o.op] = (counts[o.op] || 0) + 1;
  // A transposition is counted ONCE.
  const deviations =
    counts.SUB + counts.DEL + counts.INS + counts.TRANSPOSITION;
  return { counts, deviations };
}

/**
 * The per-utterance diff a human reviewer reads alongside the band.
 * Carries token indices and timings so a deviation can be located in the
 * audio, not just read as a word pair.
 */
function buildDiffResult(ops) {
  return ops.map((o) => ({
    op: o.op,
    target: o.tTok ? o.tTok.text : null,
    hyp: o.hTok ? o.hTok.text : null,
    targetIndex: o.tIdx,
    hypIndex: o.hIdx,
    hypStartMs: o.hTok ? o.hTok.startMs : null,
    hypEndMs: o.hTok ? o.hTok.endMs : null,
    hypConf: o.hTok ? o.hTok.conf : null,
    ...(o.op === "TRANSPOSITION"
      ? { distance: o.distance, direction: o.direction }
      : {}),
  }));
}

/**
 * Run the comparer.
 * @returns {{ status: "scored"|"withheld", ... }}
 */
function compareLAR({ targets, boundaries, wordTimings, intelligibility }, opts = {}) {
  const bandOpts = {
    patterns: opts.bandPatterns || config.BAND_PATTERNS,
    interpretation: opts.interpretation || config.INTERPRETATION,
    topBand: opts.topBand || config.BAND_TOP,
  };
  let sortedBoundaries;
  let intelByIndex;

  // ---- Stage 01 ----------------------------------------------------------
  try {
    sortedBoundaries = assertContract(boundaries, targets);
    assertWordTimings(wordTimings);
    intelByIndex = assertIntelligibility(intelligibility, sortedBoundaries);
  } catch (err) {
    if (err instanceof ContractFailure) return withheld(err.reason, { stage: "01" });
    throw err;
  }

  // ---- Stage 02 ----------------------------------------------------------
  const seg = segment(wordTimings, sortedBoundaries);

  // ---- Stages 03-06, per utterance ---------------------------------------
  const utterances = sortedBoundaries.map((b) => {
    const targetText = targets[b.pos];
    const hypWords = seg.byPos[b.pos];

    // Target first: its normalized tokens feed the Decision 6 guard that
    // stops genuine reference repetition being read as a repair.
    const tNorm = normalizeTarget(targetText);
    const targetTexts = tNorm.tokens.map((t) => t.text);
    const hNorm = normalizeHypothesis(hypWords, targetTexts);

    const aligned = align(tNorm.tokens, hNorm.tokens);
    const collapsed = collapseTranspositions(aligned.ops);
    const { counts, deviations } = countDeviations(collapsed.ops);

    const hypTexts = hNorm.tokens.map((t) => t.text);

    // Stage 06a -> 06b -> 06c
    const features = featureVector({
      ops: collapsed.ops,
      targetTokens: targetTexts,
      hypTokens: hypTexts,
      selfCorrections: hNorm.trace.selfCorrections,
      relatedness: opts.relatedness || null,
    });

    const verdict = intelByIndex.get(b.utteranceIndex).verdict;
    const banded = bandUtterance({ features, verdict }, bandOpts);

    return {
      utteranceIndex: b.utteranceIndex,
      ...banded,
      // The diff a human reviewer reads alongside the band.
      diffResult: buildDiffResult(collapsed.ops),
      features,
      opCounts: counts,
      deviations,
      transpositions: collapsed.transpositions.length,
      selfCorrections: hNorm.trace.selfCorrections,
      suppressedCollapses: hNorm.trace.suppressedCollapses,
      targetTokens: targetTexts,
      hypTokens: hypTexts,
      hypWordCount: hypWords.length,
      traces: opts.includeTraces
        ? { target: tNorm.trace, hypothesis: hNorm.trace }
        : undefined,
    };
  });

  // ---- Response-level gate -----------------------------------------------
  // Decision 3: unintelligible WITHHOLDS the whole response. It never floors.
  if (intelligibility.overall === "unintelligible") {
    return withheld("intelligibility.overall === 'unintelligible'", {
      stage: "06",
      orphanCount: seg.orphanCount,
      orphanRatio: seg.orphanRatio,
      orphanFlag: seg.orphanFlag,
    });
  }

  // An overall "uncertain" caps every utterance on top of its own cap.
  const gated = utterances.map((u) => {
    if (u.band === WITHHELD) return u;
    const g = applyGate(u.band, intelligibility.overall, bandOpts.topBand);
    return { ...u, band: g.band, capped: u.capped || g.capped };
  });

  return {
    status: "scored",
    utterances: gated,
    // NO RESPONSE-LEVEL ROLLUP, EVER. Per-utterance only, matching INT's
    // precedent. Confirmed from the spec text.
    intelligibilityOverall: intelligibility.overall,
    orphanCount: seg.orphanCount,
    orphanRatio: seg.orphanRatio,
    orphanFlag: seg.orphanFlag,
    orphans: seg.orphans.map((o) => o.w),
    needsHumanReview: gated.some((u) => u.needsHumanReview),
    provisionalRules: {
      // INTERPRETATION constants stand in for spec words carrying no number
      // ("several", "most", "a few", "longer prompts"). Band-affecting.
      interpretationConstants: config.INTERPRETATION,
      contractions: config.CONTRACTIONS.provisional === true,
      numerals: config.NUMERALS.provisional === true,
      intelligibilityThresholds: config.INTELLIGIBILITY.provisional === true,
      contentRelatednessAvailable: typeof opts.relatedness === "function",
    },
  };
}

module.exports = {
  compareLAR,
  config,
  WITHHELD,
  TRANSPOSITION,
  MATCH,
  ContractFailure,
};
