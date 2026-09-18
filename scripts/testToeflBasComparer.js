#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// TEST — BAS deterministic comparer (no emulator, no network, no API cost).
//
// CASE SELECTION, STATED UP FRONT
//
// Cases here were chosen by asking "what would this catch?" rather than "what
// is easy to run" — the principle three separate suites failed today: the INT
// suite passed 28/28 while never touching the input builder that held a silent
// question-misassignment; the CTW suite's shared log buffer made a later case
// leak into an earlier assertion; and checkSpecDrift.js confidently reported
// 3 of 5 known instances because it matched a truncated excerpt.
//
// Three cases exist purely because real data cannot exercise them:
//
//   · Case 2 — a set of MORE THAN ONE accepted ordering, in the shape Firestore
//     actually permits. No real BAS item is multi-valid today, so this branch is
//     unexercised by every real item and by any end-to-end run. Its first
//     version used an array of arrays and passed — against a plain-JS fake
//     database that holds any shape. Firestore rejects directly nested arrays
//     outright, so the very scenario the case existed to de-risk would have
//     failed at write time. It now asserts the shape is STORABLE as well as
//     that the comparison works.
//
//   · Case 11 — a 1-BASED fragmentIndex item. Nothing produces one today. It
//     is asserted because this data model carries three index bases (MCQ and
//     CTW 1-based, BAS and INT scoring 0-based) and an off-by-one between
//     submittedOrder and fragmentIndex is precisely the bug that silently
//     mis-assigned INT's four questions earlier today.
//
//   · Case 9 — malformed input a working renderer cannot produce (a chunk
//     placed twice, a chunk that does not exist). The BAS component does not
//     exist yet, so these can only be reached synthetically — and they must be
//     reported as integration failures rather than absorbed as wrong answers.
//
// Fixture data in Cases 1, 4, 5 and 6 is verbatim real content from imported
// items BAS-001, BAS-002 and BAS-003.
//
// Usage:
//   node scripts/testToeflBasComparer.js
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
  "./lib/toeflTranscription": require("../functions/lib/toeflTranscription"),
};
const src =
  fs.readFileSync(SRC, "utf8") +
  "\n;module.exports.__test = { scoreBuildASentence, basAcceptedOrderings, basSameOrder };";
const fn = eval(Module.wrap(src));
const mod = { exports: {} };
fn.call(mod.exports, mod.exports, (id) => stubs[id] || require(id), mod, SRC, path.dirname(SRC));
const { scoreBuildASentence, basAcceptedOrderings, basSameOrder } = mod.exports.__test;

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`    PASS  ${label}`);
  else {
    failures++;
    console.log(`    FAIL  ${label}`);
    if (detail !== undefined) console.log(`          ${detail}`);
  }
}

// ── Real imported content ───────────────────────────────────────────────────

// BAS-001: 7 chunks, one distractor ("where", index 3)
const BAS001_CHUNKS = ["would", "the beginner kayak class", "to know", "where",
                       "last", "how long", "She wanted"];
const BAS001_ORDER = [6, 2, 5, 1, 0, 4];  // "She wanted to know how long the beginner kayak class would last"

// BAS-002: 6 chunks, NO distractor — every chunk used (45.5% of real items)
const BAS002_CHUNKS = ["did", "little green lamp", "Where", "that", "you", "find"];
const BAS002_ORDER = [2, 0, 4, 5, 3, 1];  // "Where did you find that little green lamp"

// BAS-003: 8 chunks, morphological twin — "dries" (2, distractor) vs "to dry" (6, used)
const BAS003_CHUNKS = ["quickly", "the bedroom paint", "dries", "expect", "so",
                       "She", "to dry", "didn't"];
const BAS003_ORDER = [5, 7, 3, 1, 6, 4, 0];  // "She didn't expect the bedroom paint to dry so quickly"

function fakeDb(chunks, keyData, { itemExists = true, keyExists = true, indexBase = 0 } = {}) {
  const fragments = chunks.map((text, i) => ({ fragmentIndex: i + indexBase, text }));
  return {
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: itemExists, data: () => ({ fragments }) }),
        collection: () => ({
          doc: () => ({ get: async () => ({ exists: keyExists, data: () => keyData }) }),
        }),
      }),
    }),
  };
}

async function run(chunks, keyData, submittedOrder, opts) {
  return scoreBuildASentence(fakeDb(chunks, keyData, opts), {
    submissionId: "SUB-BAS-UNIT",
    itemId: "BAS-UNIT",
    submission: { responseContent: { submittedOrder } },
  });
}
async function throws(fnToRun) {
  try { await fnToRun(); return null; } catch (e) { return e.message; }
}

// Firestore rejects a DIRECTLY nested array ("3 INVALID_ARGUMENT: Nested
// arrays are not allowed"). This unit test deliberately never touches
// Firestore — that is what makes it fast and CI-safe — so the constraint is
// encoded as a structural assertion it CAN check. This is the specific hole
// that let the first Case 2 pass: it exercised an array of arrays against a
// plain-JS fake database, which holds any shape happily, so it validated the
// comparison logic while being structurally incapable of catching the storage
// constraint it was written to de-risk.
function hasDirectlyNestedArray(value) {
  if (Array.isArray(value)) {
    return value.some((v) => Array.isArray(v) || hasDirectlyNestedArray(v));
  }
  if (value && typeof value === "object") {
    return Object.values(value).some(hasDirectlyNestedArray);
  }
  return false;
}

(async () => {

console.log("\nCase 1 — real BAS-001, correct arrangement");
{
  const r = await run(BAS001_CHUNKS, { correctOrder: BAS001_ORDER }, BAS001_ORDER);
  check("orderCorrect true", r.orderCorrect === true);
  check("correctOrder copied back verbatim",
    basSameOrder(r.correctOrder, BAS001_ORDER), JSON.stringify(r.correctOrder));
  check("no aggregate/derived score in the result",
    Object.keys(r).sort().join(",") === "correctOrder,orderCorrect",
    Object.keys(r).join(","));
}

console.log("\nCase 2 — set membership via the Firestore-STORABLE shape");
console.log("           (array-of-maps; a bare array of arrays is rejected by Firestore)");
{
  const KEY = {
    correctOrder: BAS001_ORDER,
    acceptedOrderings: [{ order: [6, 2, 5, 1, 4, 0] }],
  };

  check("the answerKey shape has NO directly nested array (Firestore rejects those)",
    hasDirectlyNestedArray(KEY) === false, JSON.stringify(KEY));
  check("the OLD array-of-arrays shape is correctly identified as unstorable",
    hasDirectlyNestedArray({ acceptedOrderings: [[6, 2], [2, 6]] }) === true);
  check("a flat array of ints is storable",
    hasDirectlyNestedArray({ correctOrder: BAS001_ORDER }) === false);

  const a = await run(BAS001_CHUNKS, KEY, BAS001_ORDER);
  check("the primary correctOrder is accepted", a.orderCorrect === true);
  const b = await run(BAS001_CHUNKS, KEY, [6, 2, 5, 1, 4, 0]);
  check("the reviewer-added alternative is accepted", b.orderCorrect === true);
  const c = await run(BAS001_CHUNKS, KEY, [0, 1, 2, 3, 4, 5]);
  check("an ordering on neither list is still wrong", c.orderCorrect === false);
  check("correctOrder still reports the primary, not the matched alternative",
    basSameOrder(b.correctOrder, BAS001_ORDER), JSON.stringify(b.correctOrder));

  // UNION semantics: the primary survives even when only an alternative is
  // listed. Under the old "complete set" reading, a reviewer who listed one
  // alternative would have silently stopped the authored answer being accepted.
  check("helper returns primary + alternative", basAcceptedOrderings(KEY, "X").length === 2);
  check("primary is first", basSameOrder(basAcceptedOrderings(KEY, "X")[0], BAS001_ORDER));
  check("absent field → primary only",
    basAcceptedOrderings({ correctOrder: BAS001_ORDER }, "X").length === 1);
  check("empty array → primary only",
    basAcceptedOrderings({ correctOrder: BAS001_ORDER, acceptedOrderings: [] }, "X").length === 1);

  // Malformed reviewer entries throw rather than being silently dropped.
  check("a bare array entry throws (the nested-array mistake itself)",
    (await throws(() => run(BAS001_CHUNKS,
      { correctOrder: BAS001_ORDER, acceptedOrderings: [[6, 2, 5]] }, BAS001_ORDER))) !== null);
  check("an entry missing .order throws",
    (await throws(() => run(BAS001_CHUNKS,
      { correctOrder: BAS001_ORDER, acceptedOrderings: [{ ordering: [6, 2] }] }, BAS001_ORDER))) !== null);
  check("an alternative with a duplicate index throws",
    (await throws(() => run(BAS001_CHUNKS,
      { correctOrder: BAS001_ORDER, acceptedOrderings: [{ order: [6, 6, 5] }] }, BAS001_ORDER))) !== null);
  check("an alternative with an out-of-range index throws",
    (await throws(() => run(BAS001_CHUNKS,
      { correctOrder: BAS001_ORDER, acceptedOrderings: [{ order: [6, 99] }] }, BAS001_ORDER))) !== null);
  const msg = await throws(() => run(BAS001_CHUNKS,
    { correctOrder: BAS001_ORDER, acceptedOrderings: [{ order: [6, 99] }] }, BAS001_ORDER));
  check("the error names WHICH ordering failed, not just 'correctOrder'",
    msg && /acceptedOrderings\[0\]\.order/.test(msg), msg);
}

console.log("\nCase 3 — acceptedOrderings absent or empty falls back to [correctOrder]");
{
  check("absent → one entry",
    basAcceptedOrderings({ correctOrder: BAS001_ORDER }).length === 1);
  check("empty array → falls back, not zero accepted orderings",
    basAcceptedOrderings({ correctOrder: BAS001_ORDER, acceptedOrderings: [] }).length === 1);
  const r = await run(BAS001_CHUNKS,
    { correctOrder: BAS001_ORDER, acceptedOrderings: [] }, BAS001_ORDER);
  check("an empty array does not make every answer wrong", r.orderCorrect === true);
}

console.log("\nCase 4 — distractor-free item (45.5% of real items) — BAS-002");
{
  check("correctOrder uses every fragment",
    BAS002_ORDER.length === BAS002_CHUNKS.length);
  const r = await run(BAS002_CHUNKS, { correctOrder: BAS002_ORDER }, BAS002_ORDER);
  check("scores correctly with no distractor present", r.orderCorrect === true);
  const wrong = await run(BAS002_CHUNKS, { correctOrder: BAS002_ORDER }, [2, 0, 4, 5, 1, 3]);
  check("a wrong permutation of all six is still wrong", wrong.orderCorrect === false);
}

console.log("\nCase 5 — including the distractor is a WRONG ANSWER, not malformed");
{
  logs.error.length = 0;
  // BAS-001 index 3 is "where" — the distractor. Student uses it.
  const withDistractor = [6, 2, 3, 1, 0, 4];
  const r = await run(BAS001_CHUNKS, { correctOrder: BAS001_ORDER }, withDistractor);
  check("orderCorrect false", r.orderCorrect === false);
  check("NOT logged as an integration failure — the distractor did its job",
    logs.error.length === 0, `${logs.error.length} error logs`);
}

console.log("\nCase 6 — morphological twin, real BAS-003 (dries vs to dry)");
{
  logs.error.length = 0;
  // Student picks "dries" (2) where "to dry" (6) belongs — same root, wrong form.
  const twin = [5, 7, 3, 1, 2, 4, 0];
  const r = await run(BAS003_CHUNKS, { correctOrder: BAS003_ORDER }, twin);
  check("the twin substitution is wrong", r.orderCorrect === false);
  check("still not an integration failure", logs.error.length === 0);
  const right = await run(BAS003_CHUNKS, { correctOrder: BAS003_ORDER }, BAS003_ORDER);
  check("the correct form scores correct", right.orderCorrect === true);
}

console.log("\nCase 7 — omission, empty, and reordering are wrong answers");
{
  logs.error.length = 0;
  const short = await run(BAS001_CHUNKS, { correctOrder: BAS001_ORDER }, [6, 2, 5]);
  check("a partial arrangement is wrong", short.orderCorrect === false);
  const empty = await run(BAS001_CHUNKS, { correctOrder: BAS001_ORDER }, []);
  check("an empty arrangement is wrong, not an error", empty.orderCorrect === false);
  const reordered = await run(BAS001_CHUNKS, { correctOrder: BAS001_ORDER }, [2, 6, 5, 1, 0, 4]);
  check("right fragments, wrong sequence is wrong", reordered.orderCorrect === false);
  check("none of these logged an integration failure",
    logs.error.length === 0, `${logs.error.length} error logs`);
}

console.log("\nCase 8 — exact match means exact: no partial credit for near-misses");
{
  // Six of seven positions right, one swap. Must be entirely wrong.
  const nearMiss = [6, 2, 5, 1, 4, 0];
  const r = await run(BAS001_CHUNKS, { correctOrder: BAS001_ORDER }, nearMiss);
  check("a one-swap near-miss is fully wrong", r.orderCorrect === false);
  check("result carries a boolean only, no fractional credit",
    typeof r.orderCorrect === "boolean" && !("credit" in r) && !("score" in r),
    Object.keys(r).join(","));
}

console.log("\nCase 9 — malformed input a working renderer cannot produce");
{
  logs.error.length = 0;
  const dup = await run(BAS001_CHUNKS, { correctOrder: BAS001_ORDER }, [6, 2, 2, 1, 0, 4]);
  check("duplicate index scored incorrect", dup.orderCorrect === false);
  check("duplicate index logged as an integration failure", logs.error.length === 1,
    `${logs.error.length} error logs`);
  const payload = logs.error[0] && logs.error[0][1];
  check("log names the duplicate problem",
    payload && payload.problems.some((p) => /placed more than once/.test(p)),
    payload && JSON.stringify(payload.problems));

  logs.error.length = 0;
  const oor = await run(BAS001_CHUNKS, { correctOrder: BAS001_ORDER }, [6, 2, 5, 1, 0, 99]);
  check("out-of-range index scored incorrect", oor.orderCorrect === false);
  check("out-of-range index logged", logs.error.length === 1);

  logs.error.length = 0;
  const nonInt = await run(BAS001_CHUNKS, { correctOrder: BAS001_ORDER }, [6, 2, 5, 1, 0, "4"]);
  check("a string index is treated as out-of-range, not coerced",
    nonInt.orderCorrect === false && logs.error.length === 1,
    `orderCorrect=${nonInt.orderCorrect} logs=${logs.error.length}`);

  logs.error.length = 0;
  const nullIdx = await run(BAS001_CHUNKS, { correctOrder: BAS001_ORDER }, [6, 2, 5, 1, 0, null]);
  check("a null index is rejected", nullIdx.orderCorrect === false && logs.error.length === 1);
}

console.log("\nCase 10 — a correct-looking submission cannot be faked by malformation");
{
  // Duplicating a fragment to pad length up to the correct length must not
  // accidentally pass: the malformed guard short-circuits orderCorrect.
  logs.error.length = 0;
  const padded = await run(BAS001_CHUNKS, { correctOrder: [6, 2, 5, 1, 0, 4] }, [6, 6, 5, 1, 0, 4]);
  check("padded duplicate never scores correct", padded.orderCorrect === false);
  check("and is reported", logs.error.length === 1);
}

console.log("\nCase 11 — 1-based fragmentIndex is rejected (the INT bug class)");
{
  const msg = await throws(() =>
    run(BAS001_CHUNKS, { correctOrder: BAS001_ORDER }, BAS001_ORDER, { indexBase: 1 }));
  check("non-0-based fragmentIndex throws", msg !== null);
  check("error names the expected contiguous 0-based shape",
    msg && /contiguous 0-based/.test(msg), msg);
}

console.log("\nCase 12 — item and answerKey data failures throw");
{
  check("missing item throws",
    (await throws(() => run(BAS001_CHUNKS, { correctOrder: BAS001_ORDER },
      BAS001_ORDER, { itemExists: false }))) !== null);
  check("missing answerKey throws",
    (await throws(() => run(BAS001_CHUNKS, { correctOrder: BAS001_ORDER },
      BAS001_ORDER, { keyExists: false }))) !== null);
  check("fewer than 4 fragments throws (spec §2.1 range)",
    (await throws(() => run(["a", "b", "c"], { correctOrder: [0, 1, 2] }, [0, 1, 2]))) !== null);
  check("missing correctOrder throws",
    (await throws(() => run(BAS001_CHUNKS, {}, BAS001_ORDER))) !== null);
  check("empty correctOrder throws",
    (await throws(() => run(BAS001_CHUNKS, { correctOrder: [] }, []))) !== null);
  check("duplicate in correctOrder throws",
    (await throws(() => run(BAS001_CHUNKS, { correctOrder: [6, 2, 2, 1] }, [6, 2, 1]))) !== null);
  check("out-of-range in correctOrder throws",
    (await throws(() => run(BAS001_CHUNKS, { correctOrder: [6, 2, 99] }, [6, 2]))) !== null);
  check("correctOrder longer than fragments throws",
    (await throws(() => run(["a", "b", "c", "d"],
      { correctOrder: [0, 1, 2, 3, 0] }, [0, 1, 2, 3]))) !== null);
  check("missing submittedOrder throws",
    (await throws(() => scoreBuildASentence(
      fakeDb(BAS001_CHUNKS, { correctOrder: BAS001_ORDER }),
      { submissionId: "S", itemId: "X", submission: { responseContent: {} } }))) !== null);
  check("non-array submittedOrder throws",
    (await throws(() => run(BAS001_CHUNKS, { correctOrder: BAS001_ORDER }, "6,2,5"))) !== null);
}

console.log("\nCase 13 — basSameOrder is order-sensitive, not set-equality");
{
  check("same elements, different order → false", basSameOrder([1, 2, 3], [3, 2, 1]) === false);
  check("identical → true", basSameOrder([1, 2, 3], [1, 2, 3]) === true);
  check("different lengths → false", basSameOrder([1, 2], [1, 2, 3]) === false);
  check("non-array → false", basSameOrder(null, [1]) === false);
}

console.log(
  failures === 0
    ? "\nBAS COMPARER PASSED — exact match via set membership, distractors wrong not malformed, index base asserted.\n"
    : `\nBAS COMPARER FAILED — ${failures} check(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
})();
