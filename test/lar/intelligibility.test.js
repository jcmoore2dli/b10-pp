// test/lar/intelligibility.test.js
// The intelligibility producer (functions/lib/lar/intelligibility.js), against
// JC's 2026-09-18 ruling. Synthetic fixtures only.

"use strict";

const assert = require("assert");
const { compareLAR } = require("../../functions/lib/lar");
const { assessIntelligibility, assessWords } = require("../../functions/lib/lar/intelligibility");
const config = require("../../functions/lib/lar/config");
const fx = require("./fixtures");

// Words at a given confidence pattern: "H" = 0.95, "L" = 0.45, "N" = no conf.
function wordsFrom(pattern, { startMs = 0, texts = null } = {}) {
  return [...pattern].map((c, i) => ({
    w: texts ? texts[i] : `w${i}`,
    startMs: startMs + i * 300,
    endMs: startMs + i * 300 + 250,
    conf: c === "H" ? 0.95 : c === "L" ? 0.45 : null,
  }));
}

// Perfect words for every utterance, with utterance `n` (1-based) given a
// confidence pattern over its own words.
function perfectWithPattern(n, pattern) {
  const bs = fx.boundaries();
  const words = fx.perfectWords();
  const inWin = (w) => w.startMs >= bs[n - 1].responseStartMs && w.endMs <= bs[n - 1].responseEndMs;
  let k = 0;
  return words.map((w) => {
    if (!inWin(w)) return w;
    const c = pattern[k++];
    return { ...w, conf: c === "L" ? 0.45 : 0.95 };
  });
}

describe("Intelligibility producer - thresholds are the approved provisional values", () => {
  it("is marked provisional, 0.70 / 50% / 3-in-a-row", () => {
    const c = config.INTELLIGIBILITY;
    assert.strictEqual(c.provisional, true);
    assert.strictEqual(c.lowWordConf, 0.7);
    assert.strictEqual(c.minLowShare, 0.5);
    assert.strictEqual(c.minLowRun, 3);
  });

  it("no longer carries the old unintelligible threshold", () => {
    assert.ok(!("uncertainMinConf" in config.INTELLIGIBILITY));
    assert.ok(!("clearMinConf" in config.INTELLIGIBILITY));
  });
});

describe("Intelligibility producer - the proposal's worked examples", () => {
  it("11 words, one low word: clear (isolated dip)", () => {
    const r = assessWords(wordsFrom("HHHHHLHHHHH"));
    assert.strictEqual(r.verdict, "clear");
    assert.strictEqual(r.evidence.lowCount, 1);
    assert.strictEqual(r.evidence.longestLowRun, 1);
  });

  it("11 words, words 3-9 low: uncertain (broad and sustained)", () => {
    const r = assessWords(wordsFrom("HHLLLLLLLHH"));
    assert.strictEqual(r.verdict, "uncertain");
    assert.strictEqual(r.evidence.longestLowRun, 7);
    assert.strictEqual(r.evidence.lowShare, Number((7 / 11).toFixed(4)));
  });

  it("11 words, 6 low but alternating: clear (scattered, not sustained)", () => {
    const r = assessWords(wordsFrom("LHLHLHLHLHL"));
    assert.strictEqual(r.evidence.lowCount, 6);
    assert.ok(r.evidence.lowShare >= 0.5);
    assert.strictEqual(r.evidence.longestLowRun, 1);
    assert.strictEqual(r.verdict, "clear");
  });

  it("5-word opener, 3 low in a row: uncertain", () => {
    assert.strictEqual(assessWords(wordsFrom("HLLLH")).verdict, "uncertain");
  });

  it("2-word response: clear (cannot be sustained)", () => {
    assert.strictEqual(assessWords(wordsFrom("LL")).verdict, "clear");
  });
});

describe("Intelligibility producer - both conditions are required", () => {
  it("sustained but not broad: 3 low in a row out of 10 is clear", () => {
    assert.strictEqual(assessWords(wordsFrom("HHHLLLHHHH")).verdict, "clear");
  });

  it("exactly at both thresholds is uncertain (>=, not >)", () => {
    // 3 of 6 = 50%, run of 3
    assert.strictEqual(assessWords(wordsFrom("HHHLLL")).verdict, "uncertain");
  });

  it("a word at exactly 0.70 is not low", () => {
    const ws = wordsFrom("LLLL").map((w) => ({ ...w, conf: 0.7 }));
    assert.strictEqual(assessWords(ws).evidence.lowCount, 0);
  });
});

describe("Intelligibility producer - what does not count", () => {
  it("fillers are excluded before counting", () => {
    // um/uh are low but carry no content; the four real words are confident.
    const ws = wordsFrom("LLLHHHH", { texts: ["um", "uh,", "Um", "the", "book", "is", "here"] });
    const r = assessWords(ws);
    assert.strictEqual(r.evidence.wordCount, 4);
    assert.strictEqual(r.evidence.lowCount, 0);
    assert.strictEqual(r.verdict, "clear");
  });

  it("a word with no confidence value is never low, and breaks a run", () => {
    const r = assessWords(wordsFrom("LLNLL"));
    assert.strictEqual(r.evidence.lowCount, 4);
    assert.strictEqual(r.evidence.longestLowRun, 2);
    assert.strictEqual(r.verdict, "clear");
  });

  it("runs are measured in time order, whatever order the words arrive in", () => {
    const ws = wordsFrom("HHLLLL").reverse();
    assert.strictEqual(assessWords(ws).evidence.longestLowRun, 4);
  });

  it("evidence is counts only: no word identities", () => {
    const r = assessWords(wordsFrom("HLLLH", { texts: ["a", "secret", "word", "list", "b"] }));
    assert.ok(!JSON.stringify(r).includes("secret"));
  });
});

describe("Intelligibility producer - output contract", () => {
  it("one verdict per utterance, overall always clear, never unintelligible", () => {
    const all = fx.perfectWords().map((w) => ({ ...w, conf: 0.1 }));
    const out = assessIntelligibility({ wordTimings: all, boundaries: fx.boundaries(), targets: fx.TARGETS });
    assert.strictEqual(out.perUtterance.length, 7);
    assert.ok(out.perUtterance.every((p) => p.verdict === "uncertain"));
    assert.strictEqual(out.overall, "clear");
    assert.ok(!JSON.stringify(out).includes("unintelligible"));
    assert.strictEqual(out.provisional, true);
  });

  it("returns null on a contract failure, so compareLAR withholds on the real cause", () => {
    const out = assessIntelligibility({ wordTimings: [], boundaries: fx.boundaries(6), targets: fx.TARGETS });
    assert.strictEqual(out, null);
    const r = compareLAR({ targets: fx.TARGETS, boundaries: fx.boundaries(6), wordTimings: [], intelligibility: out });
    assert.strictEqual(r.status, "withheld");
    assert.match(r.reason, /boundaries\.length/);
  });

  it("words outside every window (the stimulus playback) are not assessed", () => {
    const stimulus = wordsFrom("LLLLLLLL", { startMs: 0 }); // before window 1 opens at 4000
    const out = assessIntelligibility({
      wordTimings: [...stimulus, ...fx.perfectWords()],
      boundaries: fx.boundaries(),
      targets: fx.TARGETS,
    });
    assert.ok(out.perUtterance.every((p) => p.verdict === "clear"));
  });
});

describe("Intelligibility producer - through compareLAR", () => {
  const run = (wordTimings) =>
    compareLAR({
      targets: fx.TARGETS,
      boundaries: fx.boundaries(),
      wordTimings,
      intelligibility: assessIntelligibility({ wordTimings, boundaries: fx.boundaries(), targets: fx.TARGETS }),
    });

  it("a perfect, confident response scores 5 everywhere", () => {
    const r = run(fx.perfectWords());
    assert.deepStrictEqual(r.utterances.map((u) => u.band), [5, 5, 5, 5, 5, 5, 5]);
  });

  it("an isolated low-confidence MATCHED word leaves the 5 alone", () => {
    const r = run(perfectWithPattern(4, "HHLHHHH"));
    assert.strictEqual(r.utterances[3].band, 5);
    assert.strictEqual(r.utterances[3].verdict, "clear");
  });

  it("broad sustained low confidence caps THAT utterance at 4, and only that one", () => {
    const r = run(perfectWithPattern(4, "HLLLLHH"));
    assert.deepStrictEqual(r.utterances.map((u) => u.band), [5, 5, 5, 4, 5, 5, 5]);
    assert.strictEqual(r.utterances[3].verdict, "uncertain");
    assert.strictEqual(r.utterances[3].cappedBand, 5);
    assert.strictEqual(r.status, "scored");
  });

  it("never lowers below 4 on intelligibility grounds", () => {
    const all = fx.perfectWords().map((w) => ({ ...w, conf: 0.05 }));
    const r = run(all);
    assert.strictEqual(r.status, "scored");
    assert.ok(r.utterances.every((u) => u.band === 4));
  });
});
