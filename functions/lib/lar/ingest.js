// functions/lib/lar/ingest.js
// Stage 00 helpers - convert the STT word stream to the comparer's contract.
//
// THE UNIT BOUNDARY. `responseBoundaries` is milliseconds; the Deepgram word
// stream is SECONDS (computeDisfluencyMetadata compares gaps against 1.5 and
// 2.5 as seconds). Conversion happens exactly HERE, once, at ingest, and a
// float second must never reach the comparer: a silent s/ms mix-up yields
// plausible-looking bands that are wrong by three orders of magnitude.

"use strict";

/**
 * Convert a Deepgram word array (seconds) to comparer word timings (integer ms).
 *
 * @param {Array} words - [{ word, start, end, confidence }] seconds
 * @returns {Array} [{ w, startMs, endMs, conf }] integer milliseconds
 */
function toWordTimings(words) {
  if (!Array.isArray(words)) return [];
  return words.map((w) => ({
    w: w.word || "",
    startMs: Math.round((w.start || 0) * 1000),
    endMs: Math.round((w.end || 0) * 1000),
    conf: typeof w.confidence === "number" ? w.confidence : null,
  }));
}

/**
 * Per-word confidence arrives on the same objects and is never read today.
 * This summarises it so the intelligibility input has a provenance to cite.
 *
 * @returns {{ provider, model, meanConf, minConf, wordCount }}
 */
function buildSttMeta(words, { provider = "deepgram", model = "nova-2" } = {}) {
  const confs = (words || [])
    .map((w) => w.confidence)
    .filter((c) => typeof c === "number");

  const meanConf = confs.length
    ? Number((confs.reduce((a, b) => a + b, 0) / confs.length).toFixed(4))
    : null;
  const minConf = confs.length ? Number(Math.min(...confs).toFixed(4)) : null;

  return {
    provider,
    model,
    meanConf,
    minConf,
    wordCount: Array.isArray(words) ? words.length : 0,
  };
}

module.exports = { toWordTimings, buildSttMeta };
