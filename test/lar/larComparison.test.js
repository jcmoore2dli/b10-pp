// test/lar/larComparison.test.js
// The word-by-word LAR display: a perfect repetition must show every word
// matched, with no cosmetic difference to explain (JC 2026-09-17).

"use strict";

const assert = require("assert");
const path = require("path");
const fx = require("./fixtures");
const { compareLAR } = require("../../functions/lib/lar");

let L; // the display module is ESM (frontend-toefl), loaded dynamically

before(async () => {
  L = await import(path.join(__dirname, "..", "..", "frontend-toefl", "src", "lib", "larComparison.js"));
});

// What the scorer writes per utterance, from the real comparer.
function scored() {
  const r = compareLAR({
    targets: fx.TARGETS,
    boundaries: fx.boundaries(),
    wordTimings: fx.perfectWords(),
    intelligibility: fx.intelligibility(),
  });
  return r.utterances.map((u, i) => ({
    utteranceIndex: u.utteranceIndex,
    referenceText: fx.TARGETS[i],
    matchedTranscript: (u.hypTokens || []).join(" "),
    diffResult: u.diffResult,
  }));
}

describe("LAR word-by-word comparison", () => {
  it("shows a perfect repetition as every word matched, nothing to explain", () => {
    for (const entry of scored()) {
      const c = L.buildLarComparison(entry);
      assert.ok(c.perfect, `utterance ${entry.utteranceIndex} not perfect: ${JSON.stringify(c.counts)}`);
      assert.deepStrictEqual(
        { substituted: c.counts.substituted, missing: c.counts.missing, extra: c.counts.extra, moved: c.counts.moved },
        { substituted: 0, missing: 0, extra: 0, moved: 0 }
      );
      assert.strictEqual(c.counts.matched, c.rows.length);
      assert.strictEqual(L.summariseLarComparison(c), "Repeated exactly.");
    }
  });

  it("shows no cosmetic difference inside a matched row, including hyphens and final punctuation", () => {
    const entries = scored();
    for (const c of entries.map(L.buildLarComparison)) {
      for (const row of c.rows) {
        assert.strictEqual(row.status, L.MATCHED);
        // The whole point: both sides of a matched row are the same word.
        assert.strictEqual(row.reference, row.spoken, `cosmetic mismatch: ${JSON.stringify(row)}`);
      }
    }
    // The reference sentence that produced them keeps its natural form, and the
    // hyphenated word is two matched rows rather than a visible difference.
    const first = L.buildLarComparison(entries[0]);
    assert.strictEqual(first.referenceText, "The well-known scientist published her findings last year.");
    assert.ok(first.referenceText.includes("well-known") && first.referenceText.endsWith("."));
    assert.deepStrictEqual(first.rows.slice(1, 3).map((r) => [r.reference, r.spoken]), [["well", "well"], ["known", "known"]]);
    assert.ok(!first.rows.some((r) => (r.reference || "").includes(".")));
  });

  it("maps every diff op to a status, and keeps the spoken word's timing", () => {
    const c = L.buildLarComparison({
      referenceText: "Please return the form today.",
      diffResult: [
        { op: "MATCH", target: "please", hyp: "please", targetIndex: 0, hypIndex: 0, hypStartMs: 10, hypEndMs: 40 },
        { op: "SUB", target: "return", hyp: "returned", targetIndex: 1, hypIndex: 1 },
        { op: "DEL", target: "the", hyp: null, targetIndex: 2, hypIndex: null },
        { op: "INS", target: null, hyp: "um", targetIndex: null, hypIndex: 2 },
        { op: "TRANSPOSITION", target: "form", hyp: "form", targetIndex: 3, hypIndex: 4 },
      ],
    });
    assert.deepStrictEqual(c.rows.map((r) => r.status), [L.MATCHED, L.SUBSTITUTED, L.MISSING, L.EXTRA, L.MOVED]);
    assert.deepStrictEqual(c.counts, { matched: 1, substituted: 1, missing: 1, extra: 1, moved: 1 });
    assert.strictEqual(c.perfect, false);
    assert.deepStrictEqual([c.rows[2].spoken, c.rows[3].reference], [null, null]);
    assert.deepStrictEqual([c.rows[0].startMs, c.rows[0].endMs], [10, 40]);
    assert.strictEqual(L.summariseLarComparison(c), "1 word missed, 1 word changed, 1 extra word, words out of order.");
  });

  it("rejects an unknown op rather than rendering it silently", () => {
    assert.throws(() => L.buildLarComparison({ diffResult: [{ op: "WAT" }] }), /unknown diff op: WAT/);
  });
});
