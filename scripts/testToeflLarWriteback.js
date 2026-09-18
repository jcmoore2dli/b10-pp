#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// B10-PP · scripts/testToeflLarWriteback.js
// Checks scoreListenAndRepeat's perUtteranceResults against the shape data
// model v1.17 defines:
//   [{utteranceIndex, referenceText, matchedTranscript, diffResult,
//     layerA: {score, rationale}, layerB: {items, flags, label}}, ...]
// matchedTranscript was missing until 2026-09-17; without it the output had no
// student-side text, so "reference: X, you said: Y" feedback was impossible.
//
// Same loading trick as scripts/testToeflIntArrayValidation.js: the scorer is
// module-internal, so the module is evaluated with its external dependencies
// stubbed and the function reached through a test hook, leaving production
// exports unchanged. No network, no Firestore, no model call.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");
const Module = require("module");
const fx = require("../test/lar/fixtures");

const SRC = path.join(__dirname, "..", "functions", "toeflScoring.js");
const source = fs.readFileSync(SRC, "utf8");
const stubs = {
  "firebase-functions/v2/firestore": { onDocumentCreated: () => () => {} },
  "firebase-functions/params": { defineSecret: () => ({ value: () => "STUB" }) },
  "firebase-functions/logger": { info: () => {}, warn: () => {}, error: () => {} },
  "firebase-admin": { firestore: () => ({}) },
  "@anthropic-ai/sdk": function () {},
  "firebase-admin/firestore": { FieldValue: { serverTimestamp: () => null } },
  "./lib/toeflLayerABPrompts": { EM_RUBRIC_PROMPT: "", DISC_RUBRIC_PROMPT: "", INT_RUBRIC_PROMPT: "" },
  "./lib/lar": require("../functions/lib/lar"),
  "./lib/lar/intelligibility": require("../functions/lib/lar/intelligibility"),
  "./lib/toeflTranscription": require("../functions/lib/toeflTranscription"),
};
const wrapper = Module.wrap(source + "\n;module.exports.__test = { scoreListenAndRepeat };");
const mod = { exports: {} };
eval(wrapper).call(mod.exports, mod.exports, (id) => (id in stubs ? stubs[id] : require(id)), mod, SRC, path.dirname(SRC));
const { scoreListenAndRepeat } = mod.exports.__test;

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    failures += 1;
    if (detail !== undefined) console.log(`        ${detail}`);
  }
};

// One LAR item and one submission whose runtime inputs are a clean read of it.
const PARTS = ["greeting", "facilities", "facilities", "services", "services", "closing", "closing"];
// v1.18: the public item carries index and part only; the sentence text is
// heard-only and lives in toeflItems/{id}/restricted/heard.
const item = {
  taskType: "LAR",
  utterances: fx.TARGETS.map((_, i) => ({ utteranceIndex: i + 1, part: PARTS[i] })),
};
const heard = { utterances: fx.TARGETS.map((text, i) => ({ utteranceIndex: i + 1, text })) };
const db = {
  collection: () => ({
    doc: () => ({
      get: async () => ({ exists: true, data: () => item }),
      collection: (sub) => ({ doc: (id) => ({ get: async () => (sub === "restricted" && id === "heard" ? { exists: true, data: () => heard } : { exists: false, data: () => undefined }) }) }),
    }),
  }),
};
// No intelligibility here: the scorer computes it (lib/lar/intelligibility.js).
const submission = {
  responseContent: {
    wordTimings: fx.perfectWords(),
    responseBoundaries: fx.boundaries(),
  },
};

// Utterance 4 spoken exactly but with broad, sustained low confidence (words
// 2-5 of 7 at 0.45): the case the intelligibility gate exists for. A client-
// written verdict is planted too, and must be ignored.
const bs = fx.boundaries();
let k = 0;
const lowWords = fx.perfectWords().map((w) => {
  if (w.startMs < bs[3].responseStartMs || w.endMs > bs[3].responseEndMs) return w;
  k += 1;
  return k >= 2 && k <= 5 ? { ...w, conf: 0.45 } : w;
});
const flaggedSubmission = {
  responseContent: {
    wordTimings: lowWords,
    responseBoundaries: bs,
    intelligibility: fx.intelligibility("unintelligible", "unintelligible"),
  },
};

(async () => {
  const out = await scoreListenAndRepeat(db, { submissionId: "SUB-LAR-UNIT", submission, itemId: "LAR-UNIT" });
  const rows = out.perUtteranceResults;
  check("perUtteranceResults has one entry per utterance", Array.isArray(rows) && rows.length === fx.UTTERANCE_COUNT, `got ${rows && rows.length}`);

  const SPEC = ["utteranceIndex", "referenceText", "matchedTranscript", "diffResult", "layerA", "layerB"];
  const missing = SPEC.filter((f) => rows.some((r) => !(f in r)));
  check("every field data model v1.17 names is present on every entry", missing.length === 0, `missing: ${missing.join(", ")}`);

  check(
    "referenceText is the utterance text from restricted/heard, matched by utteranceIndex",
    rows.every((r) => r.referenceText === heard.utterances[r.utteranceIndex - 1].text)
  );
  check(
    "matchedTranscript is a non-empty string for a clean reading",
    rows.every((r) => typeof r.matchedTranscript === "string" && r.matchedTranscript.length > 0),
    JSON.stringify(rows.map((r) => r.matchedTranscript))
  );
  // The fixtures speak each target exactly, so the student side should match
  // the reference once the comparer's own normalisation is allowed for: case,
  // punctuation, and hyphens split on both sides (its Decision 1, so
  // "well-known" is two tokens everywhere).
  const strip = (s) => s.toLowerCase().replace(/-/g, " ").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  check(
    "matchedTranscript matches the reference text for a perfect repetition",
    rows.every((r) => strip(r.matchedTranscript) === strip(r.referenceText)),
    JSON.stringify(rows.map((r) => [strip(r.referenceText), strip(r.matchedTranscript)]).filter(([a, b]) => a !== b))
  );
  check("layerA carries a 0-5 score and a rationale string", rows.every((r) => Number.isInteger(r.layerA.score) && r.layerA.score >= 0 && r.layerA.score <= 5 && typeof r.layerA.rationale === "string"));
  check("layerB carries items, flags and the fixed label", rows.every((r) => Array.isArray(r.layerB.items) && Array.isArray(r.layerB.flags) && typeof r.layerB.label === "string"));
  check("diffResult is an array of {op, target, hyp} token entries (names unchanged, per JC 2026-09-17)", rows.every((r) => Array.isArray(r.diffResult) && r.diffResult.every((d) => "op" in d && "target" in d && "hyp" in d)));

  // ── Intelligibility (JC 2026-09-18) ──────────────────────────────────────
  check("clean reading: every utterance's intelligibility verdict is clear, nothing pending",
    rows.every((r) => r.intelligibility && r.intelligibility.verdict === "clear") && out.intelligibilityReviewPending === 0);
  check("clean reading: no intelligibility review recorded yet", rows.every((r) => r.intelligibility.review === null));

  const flagged = await scoreListenAndRepeat(db, { submissionId: "SUB-LAR-LOW", submission: flaggedSubmission, itemId: "LAR-UNIT" });
  const f = flagged.perUtteranceResults;
  const u4 = f[3];
  check("client-written 'unintelligible' is ignored: the submission is scored, not withheld", Array.isArray(f) && f.length === 7);
  check("only utterance 4 is capped, at 4", JSON.stringify(f.map((r) => r.layerA.score)) === "[5,5,5,4,5,5,5]", JSON.stringify(f.map((r) => r.layerA.score)));
  check("capped rationale is the neutral one, with no reason given", u4.layerA.rationale === "Flagged for your instructor to listen to.", u4.layerA.rationale);
  // "Repeated exactly and intelligibly." (band 5) is rubric wording, not
  // feedback, so only negative or coaching language is refused here.
  check("no rationale mentions delivery, pronunciation, accent, or an uncertain/unintelligible verdict",
    f.every((r) => !/deliver|pronunc|clarit|accent|unintelligib|uncertain/i.test(r.layerA.rationale)), JSON.stringify(f.map((r) => r.layerA.rationale)));
  check("no Layer B 'Intelligibility' item, and no Layer B text about how to speak",
    f.every((r) => r.layerB.items.every((it) => it.feature !== "Intelligibility" && !/slow|clarity|pronunc|finish each word/i.test(it.observation + it.target))));
  check("utterance 4 carries the INTELLIGIBILITY_UNCERTAIN flag; the others do not",
    u4.layerB.flags.includes("INTELLIGIBILITY_UNCERTAIN") && f.filter((r) => r.layerB.flags.includes("INTELLIGIBILITY_UNCERTAIN")).length === 1);
  check("intelligibility record: uncertain, provisional, capped, restore values stored",
    u4.intelligibility.verdict === "uncertain" && u4.intelligibility.provisional === true && u4.intelligibility.capped === true &&
    u4.intelligibility.bandBeforeCap === 5 && u4.intelligibility.rationaleBeforeCap === "Repeated exactly and intelligibly." &&
    u4.intelligibility.review === null, JSON.stringify(u4.intelligibility));
  check("evidence is counts only: 4 of 7 low, run of 4", u4.intelligibility.evidence.lowCount === 4 && u4.intelligibility.evidence.longestLowRun === 4 &&
    u4.intelligibility.evidence.wordCount === 7, JSON.stringify(u4.intelligibility.evidence));
  check("one review pending, and the submission asks for a human", flagged.intelligibilityReviewPending === 1 && flagged.needsHumanReview === true);

  console.log(failures === 0 ? "\nLAR WRITEBACK PASSED — perUtteranceResults matches data model v1.17." : `\nLAR WRITEBACK FAILED — ${failures} check(s).`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
