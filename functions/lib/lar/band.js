// functions/lib/lar/band.js
// Stage 06b/c — match the feature vector against the band patterns, then gate.
//
// Four separate concerns, per the approved architecture:
//   featureVector(...)   features.js   — what is present in the diff
//   matchBand(...)       here          — which band the spec's patterns support
//   applyCaps(...)       here          — mechanical caps (corpus ruling item 1)
//   applyGate(...)       here          — the intelligibility cap
//
// SCORING RULE (JC, holistic-rating judgment, not spec text):
// take the LOWEST band that any genuinely-present feature set independently
// supports. Never average upward from an isolated band-4 feature. So this is
// NOT first-match-wins: every pattern is evaluated, and the minimum supported
// band is the result.
//
// The transposition "cap at band 4" from the earlier draft dissolved: under
// lowest-qualifying-band logic a transposition is simply a band-4 feature.
// `applyCaps` instead carries the function-word accumulation rule from the
// corpus ruling, which IS a genuine cap on a raw count.
//
// THE REFUSAL IS THE POINT. A comparer that silently awards a top band on a
// recording it could not hear is the failure mode worth engineering against.

"use strict";

const {
  BAND_PATTERNS,
  BAND_TOP,
  INTERPRETATION,
  FUNCTION_WORD_ACCUMULATION,
} = require("./config");

const WITHHELD = "WITHHELD";

/** Resolve an "@NAME" reference to its INTERPRETATION constant. */
function resolve(value, interp) {
  if (typeof value === "string" && value.startsWith("@")) {
    const key = value.slice(1);
    if (!(key in interp)) {
      throw new Error(`band pattern references unknown constant ${value}`);
    }
    return interp[key];
  }
  return value;
}

function compare(left, op, right) {
  switch (op) {
    case "==": return left === right;
    case "!=": return left !== right;
    case "<":  return left < right;
    case "<=": return left <= right;
    case ">":  return left > right;
    case ">=": return left >= right;
    default:
      throw new Error(`unknown comparison operator ${op}`);
  }
}

/** Evaluate one condition node against the feature vector. */
function evaluate(node, features, interp) {
  if (Array.isArray(node)) {
    const [name, op, rawValue] = node;
    if (!(name in features)) {
      throw new Error(`band pattern references unknown feature "${name}"`);
    }
    return compare(features[name], op, resolve(rawValue, interp));
  }
  if (node.all) return node.all.every((n) => evaluate(n, features, interp));
  if (node.any) return node.any.some((n) => evaluate(n, features, interp));
  throw new Error(`malformed band pattern node: ${JSON.stringify(node)}`);
}

/**
 * Which bands does this feature vector independently support, and why.
 *
 * @returns {{ band: number|null, supported: Array, matchedClauses: Array }}
 */
function matchBand(features, patterns = BAND_PATTERNS, interp = INTERPRETATION) {
  const supported = [];
  const matchedClauses = [];

  for (const pattern of patterns) {
    const hits = pattern.anyOf.filter((clause) =>
      evaluate(clause.when, features, interp)
    );
    if (hits.length === 0) continue;
    supported.push(pattern.band);
    for (const h of hits) {
      matchedClauses.push({
        band: pattern.band,
        label: pattern.label,
        clause: h.id,
      });
    }
  }

  // Lowest qualifying band wins.
  const band = supported.length === 0 ? null : Math.min(...supported);
  return { band, supported, matchedClauses };
}

/**
 * Mechanical caps, applied AFTER matching and BEFORE the intelligibility gate.
 *
 * CORPUS RULING (item 1): three or more function-word slips cross into band 3
 * even where each alone reads as band 4. Held here as an explicit check on the
 * functionDeviations count rather than folded into the meaning-preservation
 * framing in BAND_PATTERNS, so it applies on the count alone — independently
 * of whether the response is a full sentence or retains most content.
 *
 * A cap only ever lowers a band.
 *
 * @returns {{ band: number, applied: Array }}
 */
function applyCaps(band, features, accumulation = FUNCTION_WORD_ACCUMULATION) {
  const applied = [];
  let out = band;

  // Recorded whenever the rule FIRES, not only when it changes the number, so
  // a reviewer can see the rule was evaluated and why. `lowered` says whether
  // it actually moved the band — often it does not, because BAND_PATTERNS
  // carries a mirror clause at band 3 that has already pulled it there.
  if (features.functionDeviations >= accumulation.threshold) {
    const lowered = accumulation.capBand < out;
    applied.push({
      cap: "function-word-accumulation",
      capBand: accumulation.capBand,
      reason: accumulation.reason,
      functionDeviations: features.functionDeviations,
      from: out,
      lowered,
    });
    if (lowered) out = accumulation.capBand;
  }

  return { band: out, applied };
}

/**
 * Intelligibility gate, applied as a cap AFTER banding.
 *   clear          -> the band stands
 *   uncertain      -> min(band, BAND_TOP - 1); band 5 is "fully intelligible"
 *                     by its own wording, so an uncertain verdict cannot be 5
 *   unintelligible -> WITHHELD (Decision 3: withhold, never floor)
 */
function applyGate(band, verdict, topBand = BAND_TOP) {
  switch (verdict) {
    case "clear":
      return { band, capped: false, verdict };
    case "uncertain": {
      const capped = Math.min(band, topBand - 1);
      return { band: capped, capped: capped !== band, verdict };
    }
    case "unintelligible":
      return { band: WITHHELD, capped: true, verdict };
    default:
      // An unknown verdict is not a licence to guess.
      return { band: WITHHELD, capped: true, verdict: "unknown" };
  }
}

/**
 * Band one utterance end to end: match, then gate.
 * A feature vector no pattern supports WITHHOLDS — it never falls back.
 */
function bandUtterance({ features, verdict }, opts = {}) {
  const patterns = opts.patterns || BAND_PATTERNS;
  const interp = opts.interpretation || INTERPRETATION;
  const topBand = opts.topBand || BAND_TOP;

  const matched = matchBand(features, patterns, interp);

  if (matched.band === null) {
    return {
      band: WITHHELD,
      rawBand: null,
      withheldReason: "no band pattern matched the feature vector",
      capped: true,
      verdict,
      supportedBands: [],
      matchedClauses: [],
      needsHumanReview: true,
    };
  }

  const capped = applyCaps(
    matched.band,
    features,
    opts.accumulation || FUNCTION_WORD_ACCUMULATION
  );
  const gated = applyGate(capped.band, verdict, topBand);

  // Surface the case the spec cannot decide deterministically: a single
  // content-word substitution whose relatedness is unknown has been banded
  // conservatively at 3 rather than guessed at 4.
  const needsHumanReview = matched.matchedClauses.some(
    (c) => c.clause === "content-substitution-relatedness-unknown"
  );

  return {
    band: gated.band,
    rawBand: matched.band,
    cappedBand: capped.band,
    capsApplied: capped.applied,
    capped: gated.capped || capped.applied.some((c) => c.lowered),
    verdict: gated.verdict,
    bandLabel:
      (patterns.find((p) => p.band === matched.band) || {}).label || null,
    supportedBands: matched.supported,
    matchedClauses: matched.matchedClauses,
    needsHumanReview,
  };
}

module.exports = {
  matchBand,
  applyCaps,
  applyGate,
  bandUtterance,
  evaluate,
  WITHHELD,
};
