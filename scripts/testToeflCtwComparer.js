#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// TEST — CTW deterministic comparer (no emulator, no network, no API cost).
//
// CTW is the first TOEFL scorer whose tests can be REAL tests rather than
// calibration harnesses: it makes no model call, so every case here is
// deterministic, free, and CI-safe. EM/DISC/INT can only ever be exercised by
// paid non-deterministic seed runs; this one cannot drift.
//
// Covers the three decided seams and the failure paths:
//   · exact match, and binary-no-partial-credit (Data Model v1.12, Sep 4)
//   · case-insensitive PREFIX, case-sensitive COMPLETION (JC, Sep 10)
//   · whole-word responses, comparer strips givenLetters (JC, Sep 10)
//   · US/UK variants strict today, via an empty seam (open with corpus)
//   · renderer mismatch reported, not absorbed as ten wrong answers
//
// Usage:
//   node scripts/testToeflCtwComparer.js
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");
const Module = require("module");

const SRC = path.join(__dirname, "..", "functions", "toeflScoring.js");
const logs = { info: [], warn: [], error: [] };
const stubs = {
  "firebase-functions/v2/firestore": { onDocumentCreated: () => () => {} },
  "firebase-functions/params": { defineSecret: () => ({ value: () => "STUB" }) },
  "firebase-functions/logger": {
    info: (...a) => logs.info.push(a),
    warn: (...a) => logs.warn.push(a),
    error: (...a) => logs.error.push(a),
  },
  "firebase-admin": { firestore: () => ({}) },
  "@anthropic-ai/sdk": function () {},
  "firebase-admin/firestore": { FieldValue: { serverTimestamp: () => null } },
  "./lib/toeflLayerABPrompts": {
    EM_RUBRIC_PROMPT: "",
    DISC_RUBRIC_PROMPT: "",
    INT_RUBRIC_PROMPT: "",
  },
  // toeflScoring.js requires ./lib/lar for the LAR branch. A relative require
  // inside it resolves against THIS file's directory, not functions/, so it
  // must appear here or the eval throws at load time. The real module: pure
  // logic, no network, no Firestore, no model call.
  "./lib/lar": require("../functions/lib/lar"),
  "./lib/lar/intelligibility": require("../functions/lib/lar/intelligibility"),
  "./lib/toeflTranscription": require("../functions/lib/toeflTranscription"),
};
const src =
  fs.readFileSync(SRC, "utf8") +
  "\n;module.exports.__test = { scoreCompleteTheWords, ctwPrefixMatches, CTW_VARIANT_EQUIVALENCE };";
const fn = eval(Module.wrap(src));
const mod = { exports: {} };
fn.call(mod.exports, mod.exports, (id) => stubs[id] || require(id), mod, SRC, path.dirname(SRC));
const { scoreCompleteTheWords, ctwPrefixMatches, CTW_VARIANT_EQUIVALENCE } = mod.exports.__test;

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`    PASS  ${label}`);
  else {
    failures++;
    console.log(`    FAIL  ${label}`);
    if (detail !== undefined) console.log(`          ${detail}`);
  }
}

// ── Fake Firestore, just enough for the comparer ────────────────────────────
function fakeDb(gaps, keyGaps, { itemExists = true, keyExists = true } = {}) {
  return {
    collection: () => ({
      doc: () => ({
        get: async () => ({
          exists: itemExists,
          data: () => ({ gaps, stimulus: { gapCount: 10 } }),
        }),
        collection: () => ({
          doc: () => ({
            get: async () => ({ exists: keyExists, data: () => ({ gaps: keyGaps }) }),
          }),
        }),
      }),
    }),
  };
}

// Real content: CTW-PS-001, verbatim from the imported item.
const PS001 = [
  ["confid", "ent"], ["h", "ow"], ["o", "r"], ["questi", "on"], ["detai", "led"],
  ["confiden", "ce"], ["colla", "pses"], ["Resear", "chers"], ["vol", "unteers"],
  ["neve", "r"],
];
const gaps = PS001.map(([g], i) => ({ gapIndex: i + 1, givenLetters: g }));
const keyGaps = PS001.map(([, c], i) => ({ gapIndex: i + 1, correctCompletion: c }));

function words(overrides = {}) {
  return PS001.map(([g, c], i) => ({
    gapIndex: i + 1,
    response: overrides[i + 1] !== undefined ? overrides[i + 1] : g + c,
  }));
}
async function run(gapResponses, opts) {
  return scoreCompleteTheWords(fakeDb(gaps, keyGaps, opts), {
    submissionId: "SUB-CTW-UNIT",
    itemId: "CTW-PS-001",
    submission: { responseContent: { gapResponses } },
  });
}
async function throws(p) {
  try { await p(); return null; } catch (e) { return e.message; }
}

(async () => {

console.log("\nCase 1 — all ten correct, whole reconstructed words");
{
  const r = await run(words());
  check("ten results", r.perGapResults.length === 10, r.perGapResults.length);
  check("all correct", r.perGapResults.every((g) => g.isCorrect));
  check("gapIndex 1..10 in order", r.perGapResults.every((g, i) => g.gapIndex === i + 1));
  check("correctCompletion echoed per gap (v1.17 shape)",
    r.perGapResults[7].correctCompletion === "chers", r.perGapResults[7].correctCompletion);
  check("response stored as submitted (whole word)",
    r.perGapResults[7].response === "Researchers", r.perGapResults[7].response);
  check("no aggregate score field", !("score" in r) && !("total" in r), Object.keys(r).join(","));
}

console.log("\nCase 2 — case-insensitive PREFIX (the decided seam)");
{
  // Student types lowercase r on an item-authored capital.
  const r = await run(words({ 8: "researchers" }));
  check('"researchers" accepted for "Researchers"', r.perGapResults[7].isCorrect);
  const r2 = await run(words({ 8: "RESEARCHERS" }));
  check('"RESEARCHERS" prefix accepted, completion "CHERS" rejected',
    r2.perGapResults[7].isCorrect === false, "completion is compared case-sensitively");
  check("ctwPrefixMatches is case-insensitive", ctwPrefixMatches("researchers", "Resear"));
  check("ctwPrefixMatches rejects a genuinely different prefix",
    !ctwPrefixMatches("Scientists", "Resear"));
}

console.log("\nCase 3 — binary, no partial credit (Data Model v1.12)");
{
  // "unteer" vs "unteers" — one letter short. Must be fully wrong.
  const r = await run(words({ 9: "volunteer" }));
  check('"volunteer" for "volunteers" is wrong, not partial',
    r.perGapResults[8].isCorrect === false);
  check("result carries only a boolean, no fractional credit",
    typeof r.perGapResults[8].isCorrect === "boolean" &&
      !("credit" in r.perGapResults[8]) && !("score" in r.perGapResults[8]),
    Object.keys(r.perGapResults[8]).join(","));
}

console.log("\nCase 4 — the confident/confidence swap, from real item CTW-PS-001");
{
  // g1 is confid+ent, g6 is confiden+ce. Transposing gives two real English
  // words, both wrong in context. Both must score 0.
  const r = await run(words({ 1: "confidence", 6: "confident" }));
  check("g1 'confidence' wrong", r.perGapResults[0].isCorrect === false);
  check("g6 'confident' wrong", r.perGapResults[5].isCorrect === false);
  check("the other eight unaffected",
    r.perGapResults.filter((g) => g.isCorrect).length === 8,
    r.perGapResults.filter((g) => g.isCorrect).length);
}

console.log("\nCase 5 — single-letter completions (58 of 530 real gaps)");
{
  check("g3 'or' correct", (await run(words())).perGapResults[2].isCorrect);
  const r = await run(words({ 3: "of" }));   // o+f, a real word, wrong here
  check("g3 'of' wrong", r.perGapResults[2].isCorrect === false);
  const r2 = await run(words({ 10: "never" }));
  check("g10 'never' correct", r2.perGapResults[9].isCorrect);
}

console.log("\nCase 6 — US/UK variants accepted both ways (corpus, Sep 10)");
{
  check("CTW_VARIANT_EQUIVALENCE has the 5 verified entries",
    Object.keys(CTW_VARIANT_EQUIVALENCE).length === 5,
    JSON.stringify(Object.keys(CTW_VARIANT_EQUIVALENCE)));

  // Helper: one-gap item built from a real corpus pair.
  const oneGap = async (given, comp, response) =>
    scoreCompleteTheWords(fakeDb(
      Array.from({length:10},(_,i)=>i?{gapIndex:i+1,givenLetters:"x"}:{gapIndex:1,givenLetters:given}),
      Array.from({length:10},(_,i)=>i?{gapIndex:i+1,correctCompletion:"y"}:{gapIndex:1,correctCompletion:comp})),
      { submissionId:"S", itemId:"CTW-UNIT",
        submission:{responseContent:{gapResponses:[{gapIndex:1,response}]}} });

  // All 7 real exposed gaps, both spellings, from actual corpus content.
  const PAIRS = [
    ["organ",   "ization", "organization",   "organisation"],
    ["revital", "ization", "revitalization", "revitalisation"],
    ["privat",  "ization", "privatization",  "privatisation"],
    ["symb",    "olizing", "symbolizing",    "symbolising"],
    ["emph",    "asize",   "emphasize",      "emphasise"],
    ["spec",    "ialized", "specialized",    "specialised"],
    ["pressur", "izes",    "pressurizes",    "pressurises"],
  ];
  for (const [given, comp, us, uk] of PAIRS) {
    const a = await oneGap(given, comp, us);
    const b = await oneGap(given, comp, uk);
    check(`${us} / ${uk} both accepted`,
      a.perGapResults[0].isCorrect === true && b.perGapResults[0].isCorrect === true,
      `US=${a.perGapResults[0].isCorrect} UK=${b.perGapResults[0].isCorrect}`);
  }

  // Equivalence must not become a general spelling amnesty.
  const bad = await oneGap("organ", "ization", "organizashun");
  check("a genuine misspelling is still wrong", bad.perGapResults[0].isCorrect === false);
  const bad2 = await oneGap("organ", "ization", "organizing");
  check("a different real word is still wrong", bad2.perGapResults[0].isCorrect === false);

  // realized needs no entry — the z is in the given prefix.
  const rz = await oneGap("realiz", "ed", "realized");
  check("realized correct (z in given prefix, no entry needed)", rz.perGapResults[0].isCorrect);
  const rz2 = await oneGap("realiz", "ed", "realised");
  check("realised rejected — prefix mismatch, not a variant question",
    rz2.perGapResults[0].isCorrect === false);

  // Unrelated -ise completions from real content must be untouched.
  const ow = await oneGap("other", "wise", "otherwise");
  check("otherwise unaffected by the equivalence table", ow.perGapResults[0].isCorrect);
}

console.log("\nCase 7 — blank and missing responses are wrong, not errors");
{
  // Reset the shared log buffer: earlier cases legitimately log mismatches
  // (Case 6's "realised" is a real prefix mismatch), and this case asserts on
  // the ABSENCE of one. Without the reset it reads a previous case's entry.
  logs.error.length = 0;
  const r = await run(words({ 4: "" }));
  check("empty string is wrong, not a throw", r.perGapResults[3].isCorrect === false);
  const partial = words().filter((g) => g.gapIndex !== 7);
  const r2 = await run(partial);
  check("a gap with no response entry is wrong", r2.perGapResults[6].isCorrect === false);
  check("still ten results even with one response absent", r2.perGapResults.length === 10);
  check("no renderer-mismatch logged for a blank", logs.error.length === 0, logs.error.length);
}

console.log("\nCase 8 — renderer mismatch: completion-only response");
{
  logs.error.length = 0;
  // What the renderer would send if it disagreed with the whole-word decision.
  const completionOnly = PS001.map(([, c], i) => ({ gapIndex: i + 1, response: c }));
  const r = await run(completionOnly);
  check("all ten scored incorrect, not silently reinterpreted",
    r.perGapResults.every((g) => g.isCorrect === false));
  check("logged as an integration mismatch", logs.error.length === 1, logs.error.length);
  const payload = logs.error[0] && logs.error[0][1];
  check("mismatch count reported", payload && payload.mismatchCount === 10, payload && payload.mismatchCount);
  check("log names the whole-word decision",
    payload && /whole\s+reconstructed word/.test(payload.note), payload && payload.note);
}
{
  // A single overwritten given portion is also a mismatch, and is scoped to it.
  logs.error.length = 0;
  const r = await run(words({ 2: "wow" }));  // given "h", response "wow"
  check("one bad response → one mismatch", logs.error.length === 1);
  check("that gap incorrect", r.perGapResults[1].isCorrect === false);
  check("other nine still scored normally",
    r.perGapResults.filter((g) => g.isCorrect).length === 9,
    r.perGapResults.filter((g) => g.isCorrect).length);
}

console.log("\nCase 9 — data failures throw, loudly");
{
  const nine = gaps.slice(0, 9);
  check("9 public gaps rejected",
    (await throws(() => scoreCompleteTheWords(fakeDb(nine, keyGaps), {
      submissionId:"S", itemId:"X", submission:{responseContent:{gapResponses:[]}} }))) !== null);
  check("9 key gaps rejected",
    (await throws(() => scoreCompleteTheWords(fakeDb(gaps, keyGaps.slice(0,9)), {
      submissionId:"S", itemId:"X", submission:{responseContent:{gapResponses:[]}} }))) !== null);
  check("missing answerKey rejected",
    (await throws(() => scoreCompleteTheWords(fakeDb(gaps, keyGaps, {keyExists:false}), {
      submissionId:"S", itemId:"X", submission:{responseContent:{gapResponses:[]}} }))) !== null);
  check("missing item rejected",
    (await throws(() => scoreCompleteTheWords(fakeDb(gaps, keyGaps, {itemExists:false}), {
      submissionId:"S", itemId:"X", submission:{responseContent:{gapResponses:[]}} }))) !== null);
  check("missing gapResponses array rejected",
    (await throws(() => scoreCompleteTheWords(fakeDb(gaps, keyGaps), {
      submissionId:"S", itemId:"X", submission:{responseContent:{}} }))) !== null);
}

console.log("\nCase 10 — whitespace trimmed, letters otherwise untouched");
{
  const r = await run(words({ 5: "  detailed  " }));
  check("surrounding whitespace trimmed", r.perGapResults[4].isCorrect);
  check("raw response preserved verbatim in the result",
    r.perGapResults[4].response === "  detailed  ",
    JSON.stringify(r.perGapResults[4].response));
  const r2 = await run(words({ 5: "detai led" }));
  check("internal whitespace NOT stripped (would change the letters)",
    r2.perGapResults[4].isCorrect === false);
}

console.log(
  failures === 0
    ? "\nCTW COMPARER PASSED — binary per gap, prefix case-insensitive, whole-word responses, mismatch reported.\n"
    : `\nCTW COMPARER FAILED — ${failures} check(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
})();
