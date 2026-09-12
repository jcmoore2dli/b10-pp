// functions/lib/lar/contract.js
// Stage 01 — Assert the contract, then refuse.
//
// Every assumption the comparer rests on is checked before any scoring
// happens. A failed assertion WITHHOLDS the score. It never falls back to a
// default band.
//
// INDEX DISCIPLINE: `utteranceIndex` is 1-based. This module is the ONLY
// place in the comparer that converts it to an array position (`idx - 1`).
// Downstream code uses the `pos` field produced here and never re-derives it.

"use strict";

const { UTTERANCE_COUNT } = require("./config");

class ContractFailure extends Error {
  constructor(reason) {
    super(reason);
    this.name = "ContractFailure";
    this.reason = reason;
  }
}

function isInt(n) {
  return typeof n === "number" && Number.isInteger(n);
}

/**
 * Validate boundaries and target utterances, and attach the single
 * 1-based → 0-based conversion.
 *
 * @param {Array} boundaries - [{ utteranceIndex, responseStartMs, responseEndMs }]
 * @param {Array<string>} targets - target utterance texts, array order = position
 * @returns {Array} boundaries sorted by position, each with `pos` (0-based)
 * @throws {ContractFailure}
 */
function assertContract(boundaries, targets) {
  if (!Array.isArray(boundaries)) {
    throw new ContractFailure("boundaries is not an array");
  }
  if (boundaries.length !== UTTERANCE_COUNT) {
    throw new ContractFailure(
      `boundaries.length === ${UTTERANCE_COUNT} (got ${boundaries.length})`
    );
  }

  const seen = new Set();
  for (const b of boundaries) {
    if (!isInt(b.utteranceIndex)) {
      throw new ContractFailure(
        `utteranceIndex must be an integer (got ${JSON.stringify(b.utteranceIndex)})`
      );
    }
    if (b.utteranceIndex < 1 || b.utteranceIndex > UTTERANCE_COUNT) {
      throw new ContractFailure(
        `utteranceIndex out of range 1..${UTTERANCE_COUNT} (got ${b.utteranceIndex})`
      );
    }
    if (seen.has(b.utteranceIndex)) {
      throw new ContractFailure(`duplicate utteranceIndex ${b.utteranceIndex}`);
    }
    seen.add(b.utteranceIndex);
  }
  if (seen.size !== UTTERANCE_COUNT) {
    throw new ContractFailure(
      `utteranceIndex set must be exactly {1..${UTTERANCE_COUNT}}`
    );
  }

  // Milliseconds, integer. A float here is the s/ms mix-up the design warns
  // about: it yields plausible-looking bands wrong by three orders of magnitude.
  for (const b of boundaries) {
    if (!isInt(b.responseStartMs) || !isInt(b.responseEndMs)) {
      throw new ContractFailure(
        `utterance ${b.utteranceIndex}: responseStartMs/responseEndMs must be ` +
        `integer milliseconds (got ${b.responseStartMs}, ${b.responseEndMs}) — ` +
        `a float here means seconds leaked past ingest`
      );
    }
    if (!(b.responseStartMs < b.responseEndMs)) {
      throw new ContractFailure(
        `utterance ${b.utteranceIndex}: responseStartMs < responseEndMs violated ` +
        `(${b.responseStartMs} >= ${b.responseEndMs})`
      );
    }
  }

  // THE one conversion. 1-based utteranceIndex → 0-based array position.
  const withPos = boundaries.map((b) => ({
    utteranceIndex: b.utteranceIndex,
    pos: b.utteranceIndex - 1,
    responseStartMs: b.responseStartMs,
    responseEndMs: b.responseEndMs,
  }));

  const sorted = [...withPos].sort((a, b) => a.pos - b.pos);

  // Sorted in time, and non-overlapping.
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.responseStartMs < prev.responseStartMs) {
      throw new ContractFailure(
        `boundaries not sorted: utterance ${cur.utteranceIndex} starts before ` +
        `utterance ${prev.utteranceIndex}`
      );
    }
    if (cur.responseStartMs < prev.responseEndMs) {
      throw new ContractFailure(
        `boundaries overlap: utterance ${prev.utteranceIndex} ends at ` +
        `${prev.responseEndMs}, utterance ${cur.utteranceIndex} starts at ` +
        `${cur.responseStartMs}`
      );
    }
  }

  // Every target utterance has exactly one boundary.
  if (!Array.isArray(targets)) {
    throw new ContractFailure("targets is not an array");
  }
  if (targets.length !== UTTERANCE_COUNT) {
    throw new ContractFailure(
      `targets.length === ${UTTERANCE_COUNT} (got ${targets.length})`
    );
  }
  for (let i = 0; i < targets.length; i++) {
    if (typeof targets[i] !== "string" || targets[i].trim() === "") {
      throw new ContractFailure(`target utterance at position ${i} is empty`);
    }
  }

  return sorted;
}

/**
 * Word timings must be integer milliseconds too — same s/ms trap.
 * @param {Array} words - [{ w, startMs, endMs, conf }]
 * @throws {ContractFailure}
 */
function assertWordTimings(words) {
  if (!Array.isArray(words)) {
    throw new ContractFailure("wordTimings is not an array");
  }
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (typeof w.w !== "string") {
      throw new ContractFailure(`wordTimings[${i}].w must be a string`);
    }
    if (!isInt(w.startMs) || !isInt(w.endMs)) {
      throw new ContractFailure(
        `wordTimings[${i}] ("${w.w}"): startMs/endMs must be integer ` +
        `milliseconds (got ${w.startMs}, ${w.endMs}) — a float here means ` +
        `seconds leaked past ingest`
      );
    }
    if (w.endMs < w.startMs) {
      throw new ContractFailure(
        `wordTimings[${i}] ("${w.w}"): endMs < startMs`
      );
    }
  }
  return words;
}

module.exports = { assertContract, assertWordTimings, ContractFailure };
