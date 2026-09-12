// test/lar/ingest.test.js
// Stage 00 - the seconds -> integer milliseconds boundary.

"use strict";

const assert = require("assert");
const { toWordTimings, buildSttMeta } = require("../../functions/lib/lar/ingest");
const { assertWordTimings, ContractFailure } = require("../../functions/lib/lar/contract");

const DG = [
  { word: "the", start: 1.24, end: 1.31, confidence: 0.98 },
  { word: "man", start: 1.355, end: 1.7, confidence: 0.41 },
];

describe("Stage 00 - ingest", () => {
  it("converts seconds to integer milliseconds", () => {
    assert.deepStrictEqual(toWordTimings(DG), [
      { w: "the", startMs: 1240, endMs: 1310, conf: 0.98 },
      { w: "man", startMs: 1355, endMs: 1700, conf: 0.41 },
    ]);
  });

  it("emits only integers, so no float second can reach the comparer", () => {
    for (const t of toWordTimings(DG)) {
      assert.ok(Number.isInteger(t.startMs), `${t.w} startMs`);
      assert.ok(Number.isInteger(t.endMs), `${t.w} endMs`);
    }
  });

  it("produces output the comparer contract accepts", () => {
    assert.doesNotThrow(() => assertWordTimings(toWordTimings(DG)));
  });

  it("catches raw seconds handed straight to the comparer", () => {
    const raw = DG.map((w) => ({ w: w.word, startMs: w.start, endMs: w.end, conf: w.confidence }));
    assert.throws(() => assertWordTimings(raw), ContractFailure);
    assert.throws(() => assertWordTimings(raw), /seconds leaked past ingest/);
  });

  it("summarises the per-word confidence that is otherwise never read", () => {
    const m = buildSttMeta(DG);
    assert.strictEqual(m.provider, "deepgram");
    assert.strictEqual(m.model, "nova-2");
    assert.strictEqual(m.minConf, 0.41);
    assert.strictEqual(m.meanConf, 0.695);
    assert.strictEqual(m.wordCount, 2);
  });

  it("handles an empty word stream without throwing", () => {
    assert.deepStrictEqual(toWordTimings([]), []);
    const m = buildSttMeta([]);
    assert.strictEqual(m.meanConf, null);
    assert.strictEqual(m.minConf, null);
  });
});
