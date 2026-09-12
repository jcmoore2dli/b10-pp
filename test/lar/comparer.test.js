// test/lar/comparer.test.js
// LAR comparer - Stages 01..06. Synthetic fixtures only.

"use strict";

const assert = require("assert");
const { compareLAR, WITHHELD } = require("../../functions/lib/lar");
const { assertContract, ContractFailure } = require("../../functions/lib/lar/contract");
const { segment } = require("../../functions/lib/lar/segment");
const { normalizeTarget, normalizeHypothesis } = require("../../functions/lib/lar/normalize");
const { align } = require("../../functions/lib/lar/align");
const { collapseTranspositions } = require("../../functions/lib/lar/transpositions");
const { matchBand, applyCaps, applyGate, bandUtterance } = require("../../functions/lib/lar/band");
const { featureVector, isMorphologicalVariant } = require("../../functions/lib/lar/features");
const config = require("../../functions/lib/lar/config");
const fx = require("./fixtures");

const mk = (s) => s.split(" ").map((w) => ({ text: w }));
const texts = (toks) => toks.map((t) => t.text);

function baseInput(over = {}) {
  return {
    targets: fx.TARGETS,
    boundaries: fx.boundaries(),
    wordTimings: fx.perfectWords(),
    intelligibility: fx.intelligibility(),
    ...over,
  };
}

// ── Stage 01 ────────────────────────────────────────────────────────────────
describe("Stage 01 - contract", () => {
  it("accepts a well-formed contract", () => {
    const sorted = assertContract(fx.boundaries(), fx.TARGETS);
    assert.strictEqual(sorted.length, 7);
    assert.deepStrictEqual(sorted.map((b) => b.pos), [0, 1, 2, 3, 4, 5, 6]);
    assert.deepStrictEqual(sorted.map((b) => b.utteranceIndex), [1, 2, 3, 4, 5, 6, 7]);
  });

  it("converts 1-based utteranceIndex to 0-based pos in exactly one place", () => {
    const sorted = assertContract(fx.boundaries(), fx.TARGETS);
    for (const b of sorted) assert.strictEqual(b.pos, b.utteranceIndex - 1);
  });

  it("refuses the wrong number of boundaries", () => {
    const bs = fx.boundaries().slice(0, 6);
    assert.throws(() => assertContract(bs, fx.TARGETS), ContractFailure);
  });

  it("refuses a 0-based utteranceIndex", () => {
    const bs = fx.boundaries().map((b) => ({ ...b, utteranceIndex: b.utteranceIndex - 1 }));
    assert.throws(() => assertContract(bs, fx.TARGETS), /out of range/);
  });

  it("refuses a duplicate utteranceIndex", () => {
    const bs = fx.boundaries();
    bs[3].utteranceIndex = 3;
    assert.throws(() => assertContract(bs, fx.TARGETS), /duplicate/);
  });

  it("refuses float timings - the seconds/milliseconds trap", () => {
    const bs = fx.boundaries();
    bs[0].responseStartMs = 4.0001;
    assert.throws(() => assertContract(bs, fx.TARGETS), /integer milliseconds/);
  });

  it("refuses start >= end", () => {
    const bs = fx.boundaries();
    bs[2].responseEndMs = bs[2].responseStartMs;
    assert.throws(() => assertContract(bs, fx.TARGETS), /responseStartMs < responseEndMs/);
  });

  it("refuses overlapping windows", () => {
    const bs = fx.boundaries();
    bs[1].responseStartMs = bs[0].responseEndMs - 1;
    assert.throws(() => assertContract(bs, fx.TARGETS), /overlap/);
  });

  it("withholds rather than banding on contract failure", () => {
    const r = compareLAR(baseInput({ boundaries: fx.boundaries().slice(0, 5) }));
    assert.strictEqual(r.status, "withheld");
    assert.strictEqual(r.stage, "01");
    assert.ok(r.reason);
    assert.strictEqual(r.utterances, undefined);
    assert.strictEqual(r.responseBand, undefined);
  });

  it("withholds when intelligibility is not injected", () => {
    const r = compareLAR(baseInput({ intelligibility: undefined }));
    assert.strictEqual(r.status, "withheld");
    assert.match(r.reason, /intelligibility is required/);
  });

  it("withholds when a per-utterance verdict is missing", () => {
    const intel = fx.intelligibility();
    intel.perUtterance.pop();
    const r = compareLAR(baseInput({ intelligibility: intel }));
    assert.strictEqual(r.status, "withheld");
    assert.match(r.reason, /missing utterance 7/);
  });
});

// ── Stage 02 ────────────────────────────────────────────────────────────────
describe("Stage 02 - segmentation by maximal overlap", () => {
  const bs = assertContract(fx.boundaries(), fx.TARGETS);

  it("assigns a straddling word by mass, not by midpoint", () => {
    // Window 1 ends at 10000. A word running 9800..10800 has 200ms inside
    // window 1 and its midpoint (10300) outside it. Window 2 starts at 14000,
    // so it overlaps nothing else - it belongs to window 1 on mass.
    const w = [{ w: "late", startMs: 9800, endMs: 10800, conf: 0.9 }];
    const r = segment(w, bs);
    assert.strictEqual(r.byPos[0].length, 1);
    assert.strictEqual(r.orphanCount, 0);
  });

  it("orphans words that fall outside every window", () => {
    // 10000..14000 is the dead zone between windows 1 and 2 - stimulus playback.
    const w = [
      { w: "stimulus", startMs: 11000, endMs: 11500, conf: 0.9 },
      { w: "playback", startMs: 12000, endMs: 12500, conf: 0.9 },
      { w: "response", startMs: 14500, endMs: 15000, conf: 0.9 },
    ];
    const r = segment(w, bs);
    assert.strictEqual(r.orphanCount, 2);
    assert.deepStrictEqual(r.orphans.map((o) => o.w), ["stimulus", "playback"]);
    assert.strictEqual(r.byPos[1].length, 1);
  });

  it("never silently drops a word", () => {
    const words = fx.perfectWords();
    const r = segment(words, bs);
    const assigned = r.byPos.reduce((a, arr) => a + arr.length, 0);
    assert.strictEqual(assigned + r.orphanCount, words.length);
  });

  it("raises a data-quality flag on a high orphan ratio, not a low band", () => {
    const w = Array.from({ length: 10 }, (_, i) => ({
      w: `x${i}`, startMs: 11000 + i * 100, endMs: 11050 + i * 100, conf: 0.9,
    }));
    const r = segment(w, bs);
    assert.strictEqual(r.orphanRatio, 1);
    assert.strictEqual(r.orphanFlag, true);
  });
});

// ── Stage 03 ────────────────────────────────────────────────────────────────
describe("Stage 03 - normalization", () => {
  it("splits on hyphen on BOTH sides (Decision 1)", () => {
    assert.deepStrictEqual(texts(normalizeTarget("a well-known man").tokens),
      ["a", "well", "known", "man"]);
    const h = normalizeHypothesis(fx.speak("a well known man", 1000));
    assert.deepStrictEqual(texts(h.tokens), ["a", "well", "known", "man"]);
  });

  it("treats internal punctuation as a separator, not a deletion", () => {
    assert.deepStrictEqual(texts(normalizeTarget("does not—really—go").tokens),
      ["does", "not", "really", "go"]);
  });

  it("keeps an intra-word apostrophe and expands the contraction", () => {
    assert.deepStrictEqual(texts(normalizeTarget("don't").tokens), ["do", "not"]);
  });

  it("drops a stray quote without splitting the word", () => {
    assert.deepStrictEqual(texts(normalizeTarget("'quoted'").tokens), ["quoted"]);
  });

  describe("Decision 6 - self-correction collapse", () => {
    it("collapses an immediate single-word restart", () => {
      const h = normalizeHypothesis([
        { w: "the", startMs: 1000, endMs: 1100, conf: 0.9 },
        { w: "the", startMs: 1250, endMs: 1400, conf: 0.9 },
        { w: "man", startMs: 1450, endMs: 1700, conf: 0.9 },
      ]);
      assert.deepStrictEqual(texts(h.tokens), ["the", "man"]);
      assert.strictEqual(h.trace.selfCorrections.length, 1);
    });

    it("collapses a truncated false start against its completion", () => {
      const h = normalizeHypothesis([
        { w: "wal", startMs: 1000, endMs: 1150, conf: 0.7 },
        { w: "walked", startMs: 1300, endMs: 1800, conf: 0.95 },
      ]);
      assert.deepStrictEqual(texts(h.tokens), ["walked"]);
    });

    it("collapses a restarted function-word run", () => {
      const h = normalizeHypothesis([
        { w: "to", startMs: 1000, endMs: 1100, conf: 0.9 },
        { w: "the", startMs: 1150, endMs: 1250, conf: 0.9 },
        { w: "to", startMs: 1400, endMs: 1500, conf: 0.9 },
        { w: "the", startMs: 1550, endMs: 1650, conf: 0.9 },
        { w: "store", startMs: 1700, endMs: 2000, conf: 0.9 },
      ]);
      assert.deepStrictEqual(texts(h.tokens), ["to", "the", "store"]);
      assert.strictEqual(h.trace.selfCorrections[0].runLength, 2);
    });

    it("does NOT collapse a repeat separated by more than the gap window", () => {
      const h = normalizeHypothesis([
        { w: "the", startMs: 1000, endMs: 1100, conf: 0.9 },
        { w: "the", startMs: 3000, endMs: 3100, conf: 0.9 },
        { w: "man", startMs: 3200, endMs: 3500, conf: 0.9 },
      ]);
      assert.deepStrictEqual(texts(h.tokens), ["the", "the", "man"]);
      assert.strictEqual(h.trace.selfCorrections.length, 0);
    });

    it("does NOT touch a genuine substitution or an unrelated insertion", () => {
      const h = normalizeHypothesis([
        { w: "the", startMs: 1000, endMs: 1100, conf: 0.9 },
        { w: "big", startMs: 1150, endMs: 1400, conf: 0.9 },
        { w: "man", startMs: 1450, endMs: 1700, conf: 0.9 },
      ]);
      assert.deepStrictEqual(texts(h.tokens), ["the", "big", "man"]);
      assert.strictEqual(h.trace.selfCorrections.length, 0);
    });

    it("does NOT collapse when the TARGET genuinely repeats the same word", () => {
      const target = normalizeTarget("that was very very good");
      const h = normalizeHypothesis([
        { w: "that", startMs: 1000, endMs: 1200, conf: 0.9 },
        { w: "was", startMs: 1250, endMs: 1400, conf: 0.9 },
        { w: "very", startMs: 1450, endMs: 1650, conf: 0.9 },
        { w: "very", startMs: 1700, endMs: 1900, conf: 0.9 },
        { w: "good", startMs: 1950, endMs: 2200, conf: 0.9 },
      ], texts(target.tokens));
      assert.deepStrictEqual(texts(h.tokens), ["that", "was", "very", "very", "good"]);
      assert.strictEqual(h.trace.selfCorrections.length, 0);
      assert.strictEqual(h.trace.suppressedCollapses.length, 1);
    });

    it("STILL collapses a repair when the target repeats the word non-adjacently", () => {
      // "the" occurs twice in the target, but never adjacently - a real
      // "the- the" repair must still collapse.
      const target = normalizeTarget("the man walked to the store");
      const h = normalizeHypothesis([
        { w: "the", startMs: 1000, endMs: 1100, conf: 0.9 },
        { w: "the", startMs: 1250, endMs: 1400, conf: 0.9 },
        { w: "man", startMs: 1450, endMs: 1700, conf: 0.9 },
        { w: "walked", startMs: 1750, endMs: 2100, conf: 0.9 },
        { w: "to", startMs: 2150, endMs: 2300, conf: 0.9 },
        { w: "the", startMs: 2350, endMs: 2450, conf: 0.9 },
        { w: "store", startMs: 2500, endMs: 2800, conf: 0.9 },
      ], texts(target.tokens));
      assert.deepStrictEqual(texts(h.tokens), ["the", "man", "walked", "to", "the", "store"]);
      assert.strictEqual(h.trace.selfCorrections.length, 1);
    });

    it("scores genuine target repetition at band 5, not 4", () => {
      const target = normalizeTarget("that was very very good");
      const hypWords = [
        { w: "that", startMs: 1000, endMs: 1200, conf: 0.9 },
        { w: "was", startMs: 1250, endMs: 1400, conf: 0.9 },
        { w: "very", startMs: 1450, endMs: 1650, conf: 0.9 },
        { w: "very", startMs: 1700, endMs: 1900, conf: 0.9 },
        { w: "good", startMs: 1950, endMs: 2200, conf: 0.9 },
      ];
      const h = normalizeHypothesis(hypWords, texts(target.tokens));
      const c = collapseTranspositions(align(target.tokens, h.tokens).ops);
      const features = featureVector({
        ops: c.ops,
        targetTokens: texts(target.tokens),
        hypTokens: texts(h.tokens),
        selfCorrections: h.trace.selfCorrections,
      });
      assert.strictEqual(bandUtterance({ features, verdict: "clear" }).band, 5);
    });

    it("NEVER runs on the target side", () => {
      const t = normalizeTarget("the the man");
      assert.deepStrictEqual(texts(t.tokens), ["the", "the", "man"]);
      assert.strictEqual(t.trace.selfCorrections.length, 0);
      assert.ok(!t.trace.steps.some((s) => s.step === "selfCorrectionCollapse"));
    });

    it("costs a repaired utterance zero deviations end to end", () => {
      const target = "the man walked home";
      const hyp = [
        { w: "the", startMs: 1000, endMs: 1100, conf: 0.9 },
        { w: "the", startMs: 1250, endMs: 1400, conf: 0.9 },
        { w: "man", startMs: 1450, endMs: 1700, conf: 0.9 },
        { w: "walked", startMs: 1750, endMs: 2100, conf: 0.9 },
        { w: "home", startMs: 2150, endMs: 2400, conf: 0.9 },
      ];
      const t = normalizeTarget(target);
      const h = normalizeHypothesis(hyp);
      const { ops } = collapseTranspositions(align(t.tokens, h.tokens).ops);
      assert.ok(ops.every((o) => o.op === "MATCH"), texts(h.tokens).join(" "));
    });
  });

  it("records every step for audit", () => {
    const t = normalizeTarget("a well-known man");
    const names = t.trace.steps.map((s) => s.step);
    assert.deepStrictEqual(names, [
      "input", "lowercase", "stripPunctuation", "expandContractions",
      "normalizeNumerals", "hyphenation", "dropEmpty",
    ]);
  });
});

// ── Stage 04 ────────────────────────────────────────────────────────────────
describe("Stage 04 - content-word-first alignment", () => {
  it("does not cascade after a dropped article", () => {
    const { ops } = align(mk("the man walked to the store"), mk("the man walked to store"));
    assert.strictEqual(ops.filter((o) => o.op === "DEL").length, 1);
    assert.strictEqual(ops.filter((o) => o.op === "SUB").length, 0);
    assert.strictEqual(ops.filter((o) => o.op === "MATCH").length, 5);
  });

  it("scores an identical pair as all matches", () => {
    const { ops } = align(mk("the committee reviewed the proposal"), mk("the committee reviewed the proposal"));
    assert.ok(ops.every((o) => o.op === "MATCH"));
  });

  it("anchors on content words", () => {
    const { anchors } = align(mk("the man walked to the store"), mk("a man walked to a store"));
    assert.deepStrictEqual(anchors.map((a) => a.ti), [1, 2, 5]);
  });
});

// ── Stage 05 ────────────────────────────────────────────────────────────────
describe("Stage 05 - transposition collapse", () => {
  it("collapses a word moved past other material into ONE deviation", () => {
    const a = align(mk("she gave him the book"), mk("she gave the book him"));
    const c = collapseTranspositions(a.ops);
    assert.strictEqual(c.transpositions.length, 1);
    const dev = c.ops.filter((o) => o.op !== "MATCH").length;
    assert.strictEqual(dev, 1);
  });

  it("is deterministic across repeated runs", () => {
    const run = () => {
      const a = align(mk("she gave him the book"), mk("she gave the book him"));
      return JSON.stringify(collapseTranspositions(a.ops).ops.map((o) => o.op));
    };
    assert.strictEqual(run(), run());
  });

  it("respects the window W - a move beyond W stays two deviations", () => {
    const a = align(mk("alpha bravo charlie delta echo foxtrot golf"),
                    mk("bravo charlie delta echo foxtrot golf alpha"));
    const near = collapseTranspositions(a.ops, 3);
    const far = collapseTranspositions(a.ops, 99);
    assert.strictEqual(near.transpositions.length, 0);
    assert.strictEqual(far.transpositions.length, 1);
  });

  // Documents the gap found during the build. An ADJACENT swap surfaces from
  // minimum-edit alignment as two SUBs, never as the DEL+INS pair Stage 05
  // looks for - so as designed it costs TWO deviations, not one.
  // Band-affecting; pending sign-off. See config.ADJACENT_SWAP_AS_TRANSPOSITION.
  it("KNOWN GAP: an adjacent swap costs two deviations as designed", () => {
    assert.strictEqual(config.ADJACENT_SWAP_AS_TRANSPOSITION, false,
      "flag flipped - this expectation must be revisited under sign-off");
    const a = align(mk("the quick brown fox"), mk("the brown quick fox"));
    const c = collapseTranspositions(a.ops);
    assert.strictEqual(c.transpositions.length, 0);
    assert.strictEqual(c.ops.filter((o) => o.op !== "MATCH").length, 2);
  });
});

// ── Stage 06 ────────────────────────────────────────────────────────────────
// Helper: run Stages 03-06 over a target/hypothesis token pair.
function bandFor(targetText, hypText, { verdict = "clear", selfCorrections = [] } = {}) {
  const t = normalizeTarget(targetText);
  const targetTexts = texts(t.tokens);
  const hypTokens = hypText === "" ? [] : mk(hypText);
  const a = align(t.tokens, hypTokens);
  const c = collapseTranspositions(a.ops);
  const features = featureVector({
    ops: c.ops,
    targetTokens: targetTexts,
    hypTokens: texts(hypTokens),
    selfCorrections,
  });
  return { ...bandUtterance({ features, verdict }), features };
}

describe("Stage 06a - feature vector", () => {
  it("separates content from function deviations", () => {
    const f = bandFor("the committee reviewed the proposal", "a committee reviewed the proposal").features;
    assert.strictEqual(f.functionDeviations, 1);
    assert.strictEqual(f.contentDeviationsEffective, 0);
  });

  it("classifies an inflection as morphological, not substantive", () => {
    assert.ok(isMorphologicalVariant("walked", "walking"));
    assert.ok(isMorphologicalVariant("was", "were"));
    assert.ok(isMorphologicalVariant("child", "children"));
    assert.ok(!isMorphologicalVariant("scientist", "banana"));
  });

  it("does not count a transposition as a content or function deviation", () => {
    const f = bandFor("she gave him the book", "she gave the book him").features;
    assert.strictEqual(f.transpositions, 1);
    assert.strictEqual(f.contentDeviationsEffective, 0);
    assert.strictEqual(f.functionDeviations, 0);
  });

  it("detects a trailing-off attempt as not reaching the end", () => {
    const f = bandFor("the committee reviewed the proposal and rejected it", "the committee reviewed").features;
    assert.strictEqual(f.reachesEnd, false);
    assert.ok(f.tailOmittedRun > 0);
    assert.strictEqual(f.isFullSentence, false);
  });
});

describe("Stage 06b - matchBand takes the LOWEST qualifying band", () => {
  it("bands exact repetition at 5", () => {
    const r = bandFor("the committee reviewed the proposal", "the committee reviewed the proposal");
    assert.strictEqual(r.band, 5);
    assert.deepStrictEqual(r.matchedClauses.map((c) => c.clause), ["exact"]);
  });

  it("bands one or two function-word deviations at 4", () => {
    const r = bandFor("the committee reviewed the proposal", "a committee reviewed the proposal");
    assert.strictEqual(r.band, 4);
  });

  it("bands a transposition at 4, not lower", () => {
    const r = bandFor("she gave him the book", "she gave the book him");
    assert.strictEqual(r.band, 4);
    assert.ok(r.matchedClauses.some((c) => c.clause === "transposition"));
  });

  it("bands tense/aspect/number markers off at 4", () => {
    const r = bandFor("the committee reviewed the proposal", "the committee reviews the proposal");
    assert.strictEqual(r.band, 4);
    assert.ok(r.matchedClauses.some((c) => c.clause === "morphological-marker"));
  });

  it("takes the LOWER band when a worse feature is also present", () => {
    // A transposition (band 4) plus several function words gone (band 3).
    const r = bandFor(
      "she gave him the book before the meeting started",
      "she gave book him before meeting started"
    );
    assert.ok(r.supportedBands.includes(3), JSON.stringify(r.supportedBands));
    assert.strictEqual(r.band, Math.min(...r.supportedBands));
    assert.ok(r.band <= 3, `expected <= 3, got ${r.band}`);
  });

  it("does NOT average upward from an isolated band-4 feature", () => {
    const r = bandFor(
      "the committee reviewed the proposal and rejected it",
      "committee looked proposal rejected"
    );
    assert.ok(r.band < 4, `expected below 4, got ${r.band}`);
  });

  it("bands ONE missing content word at 4 on a longer prompt", () => {
    const r = bandFor(
      "the distinguished committee carefully reviewed the detailed proposal and finally rejected it completely yesterday",
      "the distinguished committee carefully reviewed the detailed and finally rejected it completely yesterday"
    );
    assert.strictEqual(r.band, 4);
    assert.ok(r.matchedClauses.some((c) => c.clause === "content-word-missing-longer-prompt"));
  });

  it("bands ONE missing content word at 3 on a shorter prompt", () => {
    const r = bandFor(
      "the committee reviewed the proposal and rejected it completely",
      "the committee reviewed the and rejected it completely"
    );
    assert.strictEqual(r.band, 3);
    assert.ok(r.matchedClauses.some((c) => c.clause === "one-content-word-missing-short-prompt"));
  });

  // CORPUS RULING item 3: trailing loss lands at 3 OR 2 by severity, never
  // automatically 2.
  it("bands a mild trailing loss at 3 - most content retained", () => {
    const r = bandFor(
      "the committee reviewed the proposal and rejected it completely",
      "the committee reviewed the proposal"
    );
    assert.strictEqual(r.features.isFullSentence, false);
    assert.strictEqual(r.band, 3);
    assert.ok(r.matchedClauses.some((c) => c.clause === "incomplete-most-content-retained"));
  });

  it("bands a severe trailing loss at 2 - significant content gone", () => {
    const r = bandFor(
      "the distinguished committee carefully reviewed the detailed proposal and finally rejected it completely yesterday",
      "the distinguished committee carefully"
    );
    assert.ok(r.features.contentRecallRatio < 0.6);
    assert.strictEqual(r.band, 2);
    assert.ok(r.matchedClauses.some((c) => c.clause === "significant-content-missing"));
  });

  it("bands a few words only at 1", () => {
    const r = bandFor("the committee reviewed the proposal and rejected it", "the committee");
    assert.strictEqual(r.band, 1);
  });

  it("bands nothing at 0", () => {
    const r = bandFor("the committee reviewed the proposal", "");
    assert.strictEqual(r.band, 0);
  });

  it('bands "I don\'t know" at 0', () => {
    const r = bandFor("the committee reviewed the proposal", "i do not know");
    assert.strictEqual(r.band, 0);
    assert.ok(r.matchedClauses.some((c) => c.clause === "no-attempt"));
  });

  it("refuses to guess relatedness - a lone content substitution falls to 3 and flags review", () => {
    const r = bandFor("the committee reviewed the proposal", "the committee reviewed the document");
    assert.strictEqual(r.band, 3);
    assert.strictEqual(r.needsHumanReview, true);
    assert.strictEqual(r.features.contentRelatednessAvailable, false);
  });

  it("bands a related substitution at 4 when relatedness IS supplied", () => {
    const t = normalizeTarget("the committee reviewed the proposal");
    const h = mk("the committee reviewed the document");
    const c = collapseTranspositions(align(t.tokens, h).ops);
    const features = featureVector({
      ops: c.ops,
      targetTokens: texts(t.tokens),
      hypTokens: texts(h),
      relatedness: () => true,
    });
    const r = bandUtterance({ features, verdict: "clear" });
    assert.strictEqual(r.band, 4);
    assert.strictEqual(r.needsHumanReview, false);
  });
});

describe("Stage 06b - self-correction", () => {
  const SC = [{ aborted: ["the"], retry: ["the"], gapMs: 150, runLength: 1 }];

  it("bands a self-correction that completes the sentence at 4", () => {
    const r = bandFor("the committee reviewed the proposal", "the committee reviewed the proposal",
      { selfCorrections: SC });
    assert.strictEqual(r.band, 4);
    assert.ok(r.matchedClauses.some((c) => c.clause === "self-correction-completed"));
  });

  it("holds selfCorrectionCompleted even alongside other deviations (Q2)", () => {
    const r = bandFor("the committee reviewed the proposal", "a committee reviewed the proposal",
      { selfCorrections: SC });
    assert.strictEqual(r.features.selfCorrectionCompleted, true);
    assert.strictEqual(r.band, 4);
  });

  it("lets independent deviations still pull the band below 4 (Q2)", () => {
    const r = bandFor(
      "she gave him the book before the meeting started",
      "she gave book him before meeting started",
      { selfCorrections: SC }
    );
    assert.strictEqual(r.features.selfCorrectionCompleted, true);
    assert.ok(r.band < 4, `expected below 4, got ${r.band}`);
  });

  it("does NOT elevate an abandoned utterance to 4 (Q3)", () => {
    const r = bandFor(
      "the committee reviewed the proposal and rejected it completely",
      "the committee reviewed the proposal",
      { selfCorrections: SC }
    );
    assert.strictEqual(r.features.selfCorrectionCompleted, false);
    assert.ok(r.band < 4, `expected below 4, got ${r.band}`);
  });

  // CORPUS RULING item 3: the abandoned case is graded by severity, not
  // flattened to band 2.
  it("grades an abandoned self-correction by severity, not automatically 2", () => {
    const mild = bandFor(
      "the committee reviewed the proposal and rejected it completely",
      "the committee reviewed the proposal",
      { selfCorrections: SC }
    );
    const severe = bandFor(
      "the distinguished committee carefully reviewed the detailed proposal and finally rejected it completely yesterday",
      "the distinguished committee carefully",
      { selfCorrections: SC }
    );
    assert.strictEqual(mild.band, 3);
    assert.strictEqual(severe.band, 2);
  });
});

// CORPUS RULING item 1 ────────────────────────────────────────────────────
describe("Stage 06c - function-word accumulation cap", () => {
  it("caps at 3 once three function-word slips accumulate", () => {
    const features = { functionDeviations: 3 };
    const r = applyCaps(4, features);
    assert.strictEqual(r.band, 3);
    assert.strictEqual(r.applied[0].cap, "function-word-accumulation");
  });

  it("leaves one or two slips alone", () => {
    assert.strictEqual(applyCaps(4, { functionDeviations: 2 }).band, 4);
    assert.strictEqual(applyCaps(4, { functionDeviations: 1 }).band, 4);
  });

  it("only ever lowers - it never lifts a band below the cap", () => {
    assert.strictEqual(applyCaps(1, { functionDeviations: 9 }).band, 1);
    assert.strictEqual(applyCaps(2, { functionDeviations: 9 }).band, 2);
  });

  it("crosses into 3 on three slips that each alone would read as band 4", () => {
    // the->a, the->a, and->or. Every content word intact, meaning preserved,
    // full sentence - band 4 on the meaning-preservation framing alone.
    const r = bandFor(
      "the committee reviewed the proposal and rejected it completely",
      "a committee reviewed a proposal or rejected it completely"
    );
    assert.strictEqual(r.features.functionDeviations, 3);
    assert.strictEqual(r.features.contentDeviationsEffective, 0);
    assert.strictEqual(r.features.isFullSentence, true);
    assert.strictEqual(r.band, 3);
    assert.ok(r.capsApplied.some((c) => c.cap === "function-word-accumulation"));
  });

  it("stays at 4 on two slips", () => {
    const r = bandFor(
      "the committee reviewed the proposal and rejected it completely",
      "a committee reviewed a proposal and rejected it completely"
    );
    assert.strictEqual(r.features.functionDeviations, 2);
    assert.strictEqual(r.band, 4);
    assert.strictEqual(r.capsApplied.length, 0);
  });

  it("reports the cap it applied so a reviewer can see why", () => {
    const r = bandUtterance({
      features: { ...bandFor("a b c", "a b c").features, functionDeviations: 4 },
      verdict: "clear",
    });
    assert.ok(r.capsApplied.length > 0);
    assert.strictEqual(r.capsApplied[0].functionDeviations, 4);
  });
});

// CORPUS RULING item 2 ────────────────────────────────────────────────────
describe("Stage 03 - phrase restart scores the FINAL corrected form", () => {
  const W = (arr) => arr.map(([w, s, e]) => ({ w, startMs: s, endMs: e, conf: 0.9 }));

  it('scores "the cat... the dog sat" as "the dog sat"', () => {
    const t = normalizeTarget("the dog sat");
    const h = normalizeHypothesis(
      W([["the", 1000, 1100], ["cat", 1150, 1400], ["the", 1600, 1700],
         ["dog", 1750, 2000], ["sat", 2050, 2300]]),
      texts(t.tokens)
    );
    assert.deepStrictEqual(texts(h.tokens), ["the", "dog", "sat"]);
  });

  it("LOGS the correction rather than suppressing it silently", () => {
    const t = normalizeTarget("the dog sat");
    const h = normalizeHypothesis(
      W([["the", 1000, 1100], ["cat", 1150, 1400], ["the", 1600, 1700],
         ["dog", 1750, 2000], ["sat", 2050, 2300]]),
      texts(t.tokens)
    );
    assert.strictEqual(h.trace.selfCorrections.length, 1);
    assert.strictEqual(h.trace.selfCorrections[0].kind, "phrase-restart");
    assert.deepStrictEqual(h.trace.selfCorrections[0].aborted, ["the", "cat"]);
  });

  it("counts it as a band-4 self-correction, never a content-word error", () => {
    const t = normalizeTarget("the dog sat");
    const h = normalizeHypothesis(
      W([["the", 1000, 1100], ["cat", 1150, 1400], ["the", 1600, 1700],
         ["dog", 1750, 2000], ["sat", 2050, 2300]]),
      texts(t.tokens)
    );
    const c = collapseTranspositions(align(t.tokens, h.tokens).ops);
    const features = featureVector({
      ops: c.ops,
      targetTokens: texts(t.tokens),
      hypTokens: texts(h.tokens),
      selfCorrections: h.trace.selfCorrections,
    });
    assert.strictEqual(features.contentSubs, 0, "aborted word must not be a content error");
    assert.strictEqual(features.contentDeviationsEffective, 0);
    assert.strictEqual(features.selfCorrectionCompleted, true);
    const r = bandUtterance({ features, verdict: "clear" });
    assert.strictEqual(r.band, 4);
    assert.ok(r.matchedClauses.some((c2) => c2.clause === "self-correction-completed"));
  });

  it("does NOT drop a run the reference legitimately repeats at that spacing", () => {
    const t = normalizeTarget("in the box the cat sat");
    const h = normalizeHypothesis(
      W([["in", 1000, 1100], ["the", 1150, 1250], ["box", 1300, 1500],
         ["the", 1550, 1650], ["cat", 1700, 1900], ["sat", 1950, 2200]]),
      texts(t.tokens)
    );
    assert.deepStrictEqual(texts(h.tokens), ["in", "the", "box", "the", "cat", "sat"]);
    assert.strictEqual(h.trace.selfCorrections.length, 0);
    assert.strictEqual(h.trace.suppressedCollapses.length, 1);
  });

  it("does NOT reach across a wider legitimate repeat", () => {
    const t = normalizeTarget("the man walked to the store");
    const h = normalizeHypothesis(
      W([["the", 1000, 1100], ["man", 1150, 1400], ["walked", 1450, 1800],
         ["to", 1850, 1950], ["the", 2000, 2100], ["store", 2150, 2400]]),
      texts(t.tokens)
    );
    assert.deepStrictEqual(texts(h.tokens), ["the", "man", "walked", "to", "the", "store"]);
    assert.strictEqual(h.trace.selfCorrections.length, 0);
  });
});

describe("Stage 06c - the intelligibility gate", () => {
  it("lets a clear verdict stand", () => {
    assert.deepStrictEqual(applyGate(5, "clear"), { band: 5, capped: false, verdict: "clear" });
  });

  it("refuses band 5 on an uncertain verdict - band 5 is 'fully intelligible'", () => {
    const g = applyGate(5, "uncertain");
    assert.strictEqual(g.band, 4);
    assert.strictEqual(g.capped, true);
  });

  it("does not lift a low band on an uncertain verdict", () => {
    assert.strictEqual(applyGate(2, "uncertain").band, 2);
  });

  it("WITHHOLDS on unintelligible - it never floors (Decision 3)", () => {
    assert.strictEqual(applyGate(5, "unintelligible").band, WITHHELD);
    assert.strictEqual(applyGate(1, "unintelligible").band, WITHHELD);
  });

  it("withholds on an unknown verdict rather than guessing", () => {
    assert.strictEqual(applyGate(5, "garbled").band, WITHHELD);
  });

  it("withholds when no pattern matches, rather than falling back", () => {
    const r = bandUtterance({ features: { ...bandFor("a b c", "a b c").features, exact: false, hypTokenCount: 99, isFullSentence: true, contentRecallRatio: 1, functionDeviations: 0, contentDeviationsEffective: 0, transpositions: 0, selfCorrectionCompleted: false, morphContentSubs: 0, isNoAttempt: false }, verdict: "clear" });
    assert.strictEqual(r.band, WITHHELD);
    assert.match(r.withheldReason, /no band pattern matched/);
  });
});

// ── End to end ──────────────────────────────────────────────────────────────
describe("compareLAR - end to end", () => {
  it("scores a perfect response at band 5 on every utterance", () => {
    const r = compareLAR(baseInput());
    assert.strictEqual(r.status, "scored");
    assert.strictEqual(r.utterances.length, 7);
    for (const u of r.utterances) {
      assert.strictEqual(u.deviations, 0, `utterance ${u.utteranceIndex}: ${JSON.stringify(u.diffResult)}`);
      assert.strictEqual(u.band, 5);
    }
    assert.strictEqual(r.orphanCount, 0);
  });

  it("emits NO response-level rollup, ever", () => {
    const r = compareLAR(baseInput());
    assert.ok(!("responseBand" in r));
    assert.ok(!("responseScore" in r));
    assert.ok(Array.isArray(r.utterances));
  });

  it("gives a human reviewer the diff alongside every band", () => {
    const r = compareLAR(baseInput());
    for (const u of r.utterances) {
      assert.ok(Array.isArray(u.diffResult), `utterance ${u.utteranceIndex}`);
      assert.strictEqual(u.diffResult.length, u.targetTokens.length);
      for (const d of u.diffResult) {
        assert.ok("op" in d && "target" in d && "hyp" in d);
        assert.ok("targetIndex" in d && "hypIndex" in d);
        assert.ok("hypStartMs" in d, "reviewer must be able to find it in the audio");
      }
    }
  });

  it("reports which rubric clause produced each band", () => {
    const r = compareLAR(baseInput());
    for (const u of r.utterances) {
      assert.ok(u.matchedClauses.length > 0);
      assert.ok(u.bandLabel);
    }
  });

  it("surfaces the interpretation constants that are band-affecting", () => {
    const r = compareLAR(baseInput());
    assert.ok(r.provisionalRules.interpretationConstants.MOST_CONTENT_WORDS);
    assert.strictEqual(r.provisionalRules.contentRelatednessAvailable, false);
  });

  it("withholds the WHOLE response when overall is unintelligible", () => {
    const r = compareLAR(baseInput({ intelligibility: fx.intelligibility("unintelligible", "clear") }));
    assert.strictEqual(r.status, "withheld");
    assert.strictEqual(r.utterances, undefined);
  });

  it("withholds a single unintelligible utterance while the rest score", () => {
    const intel = fx.intelligibility("clear", (i) => (i === 3 ? "unintelligible" : "clear"));
    const r = compareLAR(baseInput({ intelligibility: intel }));
    assert.strictEqual(r.status, "scored");
    assert.strictEqual(r.utterances[2].band, WITHHELD);
    assert.strictEqual(r.utterances[0].band, 5);
  });

  it("caps every utterance when overall is uncertain", () => {
    const r = compareLAR(baseInput({ intelligibility: fx.intelligibility("uncertain", "clear") }));
    assert.ok(r.utterances.every((u) => u.band === 4 && u.capped === true));
  });

  it("counts stimulus bleed as orphans, never as deviations", () => {
    const words = fx.perfectWords();
    const bleed = fx.speak("the well known scientist published her findings", 11000);
    const r = compareLAR(baseInput({ wordTimings: [...words, ...bleed].sort((a, b) => a.startMs - b.startMs) }));
    assert.strictEqual(r.status, "scored");
    assert.strictEqual(r.orphanCount, bleed.length);
    assert.ok(r.utterances.every((u) => u.deviations === 0));
  });

  it("is deterministic", () => {
    const a = JSON.stringify(compareLAR(baseInput()));
    const b = JSON.stringify(compareLAR(baseInput()));
    assert.strictEqual(a, b);
  });

  it("scores a real mixed response - omission, substitution, self-correction", () => {
    const targets = [...fx.TARGETS];
    const bs = fx.boundaries();
    const words = [];
    // 1: perfect
    words.push(...fx.speak("the well known scientist published her findings last year", 4100, { wordMs: 200, gapMs: 40 }));
    // 2: self-corrected "the" - must cost nothing
    words.push(...fx.speak("she gave him", 14100, { wordMs: 200, gapMs: 40 }));
    words.push({ w: "the", startMs: 14900, endMs: 15000, conf: 0.9 });
    words.push({ w: "the", startMs: 15150, endMs: 15300, conf: 0.9 });
    words.push(...fx.speak("book before the meeting started", 15400, { wordMs: 200, gapMs: 40 }));
    // 3: one omission ("and")
    words.push(...fx.speak("the committee reviewed the proposal rejected it", 24100, { wordMs: 200, gapMs: 40 }));
    // 4-7: perfect
    [3, 4, 5, 6].forEach((i) => {
      const clean = targets[i].replace(/[.,]/g, "").replace(/-/g, " ");
      words.push(...fx.speak(clean, bs[i].responseStartMs + 100, { wordMs: 200, gapMs: 40 }));
    });

    const r = compareLAR({ targets, boundaries: bs, wordTimings: words, intelligibility: fx.intelligibility() });
    assert.strictEqual(r.status, "scored");
    assert.strictEqual(r.utterances[0].deviations, 0);
    assert.strictEqual(r.utterances[1].deviations, 0, "self-correction must not be a deviation");
    assert.strictEqual(r.utterances[1].selfCorrections.length, 1);
    assert.strictEqual(r.utterances[2].deviations, 1, "one omission");
    assert.strictEqual(r.utterances[2].opCounts.DEL, 1);
  });
});
