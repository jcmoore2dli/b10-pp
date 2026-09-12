// functions/lib/lar/transpositions.js
// Stage 05 - Collapse transpositions to one deviation. Post-alignment.
//
// A swapped pair surfaces from alignment as a DEL and an INS of the same
// normalized form a short distance apart. Collapsing them is what makes a
// transposition cost ONE deviation rather than two.
//
// Decision 4 (CONFIRMED): W = 3, and a non-adjacent move still counts as one
// transposition - matching "transposition as one deviation" as stated, rather
// than narrowing it to adjacent swaps.
//
// Distance is measured in positions of the post-alignment op sequence.
// Greedy, leftmost-first, each op consumed at most once -> deterministic.

"use strict";

const {
  TRANSPOSITION_WINDOW,
  ADJACENT_SWAP_AS_TRANSPOSITION,
} = require("./config");
const { DEL, INS, SUB } = require("./align");

const TRANSPOSITION = "TRANSPOSITION";

/**
 * @param {Array} ops - ops from Stage 04
 * @param {number} W - window, defaults to config
 * @returns {{ ops: Array, transpositions: Array }}
 */
function collapseTranspositions(ops, W = TRANSPOSITION_WINDOW) {
  const consumed = new Array(ops.length).fill(false);
  const replacement = new Map(); // op index -> TRANSPOSITION op
  const transpositions = [];

  for (let p = 0; p < ops.length; p++) {
    if (consumed[p]) continue;
    const del = ops[p];
    if (del.op !== DEL) continue;

    let bestQ = -1;
    let bestDist = Infinity;

    const lo = Math.max(0, p - W);
    const hi = Math.min(ops.length - 1, p + W);
    for (let q = lo; q <= hi; q++) {
      if (q === p || consumed[q]) continue;
      const ins = ops[q];
      if (ins.op !== INS) continue;
      if (ins.hTok.text !== del.tTok.text) continue;

      const dist = Math.abs(p - q);
      // Nearest wins; on a tie the earlier op index wins, so the scan order
      // (ascending q) already settles it with a strict <.
      if (dist < bestDist) {
        bestDist = dist;
        bestQ = q;
      }
    }

    if (bestQ === -1) continue;

    const ins = ops[bestQ];
    const t = {
      op: TRANSPOSITION,
      tIdx: del.tIdx,
      hIdx: ins.hIdx,
      tTok: del.tTok,
      hTok: ins.hTok,
      distance: bestDist,
      direction: bestQ > p ? "moved-later" : "moved-earlier",
    };

    consumed[p] = true;
    consumed[bestQ] = true;
    // The collapsed op keeps the leftmost position of the pair, so the op
    // sequence stays in reading order.
    replacement.set(Math.min(p, bestQ), t);
    transpositions.push(t);
  }

  // PENDING SIGN-OFF, default OFF. See config.ADJACENT_SWAP_AS_TRANSPOSITION.
  // An adjacent swap surfaces as two SUBs, never as DEL+INS, so the pass above
  // cannot see it.
  if (ADJACENT_SWAP_AS_TRANSPOSITION) {
    for (let p = 0; p + 1 < ops.length; p++) {
      if (consumed[p] || consumed[p + 1]) continue;
      const a = ops[p];
      const b = ops[p + 1];
      if (a.op !== SUB || b.op !== SUB) continue;
      if (a.tTok.text !== b.hTok.text) continue;
      if (b.tTok.text !== a.hTok.text) continue;

      const t = {
        op: TRANSPOSITION,
        tIdx: a.tIdx,
        hIdx: b.hIdx,
        tTok: a.tTok,
        hTok: b.hTok,
        distance: 1,
        direction: "adjacent-swap",
      };
      consumed[p] = true;
      consumed[p + 1] = true;
      replacement.set(p, t);
      transpositions.push(t);
    }
  }

  const out = [];
  for (let i = 0; i < ops.length; i++) {
    if (replacement.has(i)) {
      out.push(replacement.get(i));
      continue;
    }
    if (consumed[i]) continue; // the other half of a collapsed pair
    out.push(ops[i]);
  }

  return { ops: out, transpositions };
}

module.exports = { collapseTranspositions, TRANSPOSITION };
