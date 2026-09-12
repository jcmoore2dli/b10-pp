// functions/lib/lar/align.js
// Stage 04 - Content-word-first alignment. Two-pass.
//
// Content words are aligned first and become anchors; function words are then
// aligned only within the spans between consecutive anchors. This is what
// stops one dropped article from cascading into a misalignment that marks the
// rest of the utterance wrong.
//
// ops in {MATCH, SUB, DEL, INS}
//   DEL - token present in target, absent from hypothesis (omission)
//   INS - token present in hypothesis, absent from target (addition)

"use strict";

const { FUNCTION_WORDS } = require("./config");

const MATCH = "MATCH";
const SUB = "SUB";
const DEL = "DEL";
const INS = "INS";

function isFunctionWord(tok) {
  return FUNCTION_WORDS.has(tok.text);
}

/**
 * Plain edit alignment over two token arrays.
 * Deterministic: on equal cost the backtrace prefers diagonal, then DEL,
 * then INS - a fixed order, so the same input always yields the same ops.
 *
 * @param {Array} t - target tokens
 * @param {Array} h - hypothesis tokens
 * @param {number} tOff - offset to add to emitted target indices
 * @param {number} hOff - offset to add to emitted hypothesis indices
 */
function alignTokens(t, h, tOff = 0, hOff = 0) {
  const m = t.length;
  const n = h.length;

  // d[i][j] = cost of aligning t[0..i) with h[0..j)
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const same = t[i - 1].text === h[j - 1].text;
      const diag = d[i - 1][j - 1] + (same ? 0 : 1);
      const del = d[i - 1][j] + 1;
      const ins = d[i][j - 1] + 1;
      d[i][j] = Math.min(diag, del, ins);
    }
  }

  const ops = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const same = t[i - 1].text === h[j - 1].text;
      const diag = d[i - 1][j - 1] + (same ? 0 : 1);
      if (d[i][j] === diag) {
        ops.push({
          op: same ? MATCH : SUB,
          tIdx: tOff + i - 1,
          hIdx: hOff + j - 1,
          tTok: t[i - 1],
          hTok: h[j - 1],
        });
        i -= 1;
        j -= 1;
        continue;
      }
    }
    if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({
        op: DEL,
        tIdx: tOff + i - 1,
        hIdx: null,
        tTok: t[i - 1],
        hTok: null,
      });
      i -= 1;
      continue;
    }
    ops.push({
      op: INS,
      tIdx: null,
      hIdx: hOff + j - 1,
      tTok: null,
      hTok: h[j - 1],
    });
    j -= 1;
  }

  ops.reverse();
  return ops;
}

/** Content tokens, with a map from content position back to full position. */
function contentOnly(tokens) {
  const items = [];
  const idxMap = [];
  tokens.forEach((tok, i) => {
    if (!isFunctionWord(tok)) {
      items.push(tok);
      idxMap.push(i);
    }
  });
  return { items, idxMap };
}

/**
 * Two-pass alignment.
 *
 * Pass 1: align content words only; keep MATCH ops as anchors, mapped back to
 *         full-array indices.
 * Pass 2: align every token in the spans between consecutive anchors.
 *
 * @param {Array} target - normalized target tokens
 * @param {Array} hyp - normalized hypothesis tokens
 * @returns {{ ops: Array, anchors: Array }}
 */
function align(target, hyp) {
  const tc = contentOnly(target);
  const hc = contentOnly(hyp);

  const contentOps = alignTokens(tc.items, hc.items);
  const anchors = contentOps
    .filter((o) => o.op === MATCH)
    .map((o) => ({ ti: tc.idxMap[o.tIdx], hi: hc.idxMap[o.hIdx] }));

  const ops = [];
  let prevT = 0;
  let prevH = 0;

  const stops = [...anchors, { ti: target.length, hi: hyp.length }];

  for (const { ti, hi } of stops) {
    const tSpan = target.slice(prevT, ti);
    const hSpan = hyp.slice(prevH, hi);
    if (tSpan.length > 0 || hSpan.length > 0) {
      ops.push(...alignTokens(tSpan, hSpan, prevT, prevH));
    }
    if (ti < target.length) {
      ops.push({
        op: MATCH,
        tIdx: ti,
        hIdx: hi,
        tTok: target[ti],
        hTok: hyp[hi],
        anchor: true,
      });
    }
    prevT = ti + 1;
    prevH = hi + 1;
  }

  return { ops, anchors };
}

module.exports = { align, alignTokens, contentOnly, isFunctionWord, MATCH, SUB, DEL, INS };
