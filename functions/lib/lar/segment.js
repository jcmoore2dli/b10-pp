// functions/lib/lar/segment.js
// Stage 02 — Segment by maximal overlap. Pure function.
//
// Each word is assigned to the response window it overlaps MOST — not the
// window containing its midpoint — so a long word straddling a boundary
// follows its mass.
//
// Words overlapping no window are ORPHANS. They are never dropped silently:
// the recording is continuous, so it also contains the stimulus playback and
// any speech between prompts. Orphans are exactly the words that must not
// count toward accuracy, and their volume is a data-quality signal.
//
// This is what replaces speaker diarization for LAR. The stimulus is in the
// same recording and is near-identical to what the student then says, so
// diarization is the wrong instrument; `responseBoundaries` separates stimulus
// from response by construction.

"use strict";

const { ORPHAN_RATIO_FLAG } = require("./config");

/** Overlap of a word against a boundary window, in ms. Zero if disjoint. */
function overlapMs(word, boundary) {
  const lo = Math.max(word.startMs, boundary.responseStartMs);
  const hi = Math.min(word.endMs, boundary.responseEndMs);
  return hi > lo ? hi - lo : 0;
}

/**
 * @param {Array} words - [{ w, startMs, endMs, conf }] integer ms
 * @param {Array} boundaries - contract-validated, each carrying `pos`
 * @returns {{ byPos: Array<Array>, orphans: Array, orphanRatio: number,
 *             orphanFlag: boolean }}
 */
function segment(words, boundaries) {
  const byPos = boundaries.map(() => []);
  const orphans = [];

  for (const word of words) {
    let bestOverlap = 0;
    let bestPos = -1;

    for (const b of boundaries) {
      const ov = overlapMs(word, b);
      if (ov <= 0) continue;
      // Strict > keeps the FIRST (lower index) window on a tie, because
      // `boundaries` arrives sorted by pos from Stage 01.
      if (ov > bestOverlap) {
        bestOverlap = ov;
        bestPos = b.pos;
      }
    }

    if (bestPos === -1) {
      orphans.push(word);
    } else {
      byPos[bestPos].push(word);
    }
  }

  const total = words.length;
  const orphanRatio = total === 0 ? 0 : orphans.length / total;

  return {
    byPos,
    orphans,
    orphanCount: orphans.length,
    orphanRatio,
    // Decision 5: a high orphan ratio means the BOUNDARIES are wrong. It
    // surfaces as data quality — it never lowers the student's band.
    orphanFlag: orphanRatio > ORPHAN_RATIO_FLAG,
  };
}

module.exports = { segment, overlapMs };
