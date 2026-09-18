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
const item = {
  taskType: "LAR",
  utterances: fx.TARGETS.map((text, i) => ({ utteranceIndex: i + 1, text, part: PARTS[i] })),
};
const db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => item }) }) }) };
const submission = {
  responseContent: {
    wordTimings: fx.perfectWords(),
    responseBoundaries: fx.boundaries(),
    intelligibility: fx.intelligibility(),
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
    "referenceText is the item's utterance text, matched by utteranceIndex",
    rows.every((r) => r.referenceText === item.utterances[r.utteranceIndex - 1].text)
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

  console.log(failures === 0 ? "\nLAR WRITEBACK PASSED — perUtteranceResults matches data model v1.17." : `\nLAR WRITEBACK FAILED — ${failures} check(s).`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
