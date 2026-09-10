#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// TEST — INT Layer A/B array validation and alignment (no API calls, no
// emulator, no network).
//
// WHY THIS EXISTS SEPARATELY FROM THE FIXTURE RUN
//
// The fixture exercises the branch against the real model, which is the right
// way to test scoring behaviour. But it cannot reliably exercise the FAILURE
// paths in validateLayerAArray: a well-behaved model does not emit an
// out-of-order array, a duplicated questionIndex, or a 3-entry layerB, so
// those branches would sit unexecuted while the fixture reported success.
//
// This morning's INCOMPLETE_DATA backstop is the cautionary case — it went
// unexercised through six real API calls because the model happened to do the
// right thing every time, and "the test passed" would have implied coverage
// that did not exist. Misalignment between two parallel arrays is exactly the
// structural risk the prompt doc's requirement 2 calls out as real rather than
// theoretical, so it gets a test that provokes it directly.
//
// Usage:
//   node scripts/testToeflIntArrayValidation.js
// ─────────────────────────────────────────────────────────────────────────────

const path = require("path");
const Module = require("module");

// The validators are module-internal (not exported), and exporting them purely
// for a test would widen the module's surface. Instead the module is loaded
// with its two external dependencies stubbed, then the functions are reached
// through a deliberate test hook: toeflScoring.js is read and evaluated in a
// context where the internals are visible. This keeps production exports
// unchanged.
const fs = require("fs");
const SRC = path.join(__dirname, "..", "functions", "toeflScoring.js");
const source = fs.readFileSync(SRC, "utf8");

// Stub the module's requires. None of them are touched by the validators.
const stubs = {
  "firebase-functions/v2/firestore": { onDocumentCreated: () => () => {} },
  "firebase-functions/params": { defineSecret: () => ({ value: () => "STUB" }) },
  "firebase-functions/logger": {
    info: () => {},
    warn: (...a) => warnings.push(a),
    error: () => {},
  },
  "firebase-admin": { firestore: () => ({}) },
  "@anthropic-ai/sdk": function () {},
  "firebase-admin/firestore": { FieldValue: { serverTimestamp: () => null } },
  "./lib/toeflLayerABPrompts": {
    EM_RUBRIC_PROMPT: "",
    DISC_RUBRIC_PROMPT: "",
    INT_RUBRIC_PROMPT: "",
  },
};
const warnings = [];

const wrapper = Module.wrap(source + "\n;module.exports.__test = { validateLayerAArray, buildLayerBArray, buildInterviewInput, INT_FEATURES, INT_FLAGS };");
const fn = eval(wrapper);
const mod = { exports: {} };
fn.call(mod.exports, mod.exports, (id) => {
  if (id in stubs) return stubs[id];
  return require(id);
}, mod, SRC, path.dirname(SRC));

const { validateLayerAArray, buildLayerBArray, buildInterviewInput } = mod.exports.__test;

// ── Harness ──────────────────────────────────────────────────────────────────

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}`);
    if (detail !== undefined) console.log(`        ${detail}`);
  }
}

const ctx = { submissionId: "SUB-INT-UNIT", taskType: "INT", itemId: "INT-UNIT" };

function entryA(i, score = 4) {
  return {
    questionIndex: i,
    score,
    band0Gate: score === 0 ? "no response" : false,
    rationale: score === 0 ? "" : `rationale for q${i}`,
  };
}
function entryB(i) {
  return {
    questionIndex: i,
    items: [],
    flags: [],
    label: "practice focus — project diagnostic, not part of the score",
  };
}
const goodA = [entryA(0), entryA(1), entryA(2), entryA(3)];
const goodB = [entryB(0), entryB(1), entryB(2), entryB(3)];

function throws(fnToRun) {
  try {
    fnToRun();
    return null;
  } catch (err) {
    return err.message;
  }
}

// ── Happy path ───────────────────────────────────────────────────────────────
console.log("\nCase 1 — well-formed aligned arrays");
{
  const out = validateLayerAArray(goodA, goodB, "<raw>", ctx);
  check("returns four entries", out.length === 4, `got ${out.length}`);
  check(
    "questionIndex 0..3 in order",
    out.every((e, i) => e.questionIndex === i),
    JSON.stringify(out.map((e) => e.questionIndex))
  );
  check(
    "only picked fields survive (no model-invented keys)",
    out.every(
      (e) =>
        Object.keys(e).sort().join(",") ===
        "band0Gate,questionIndex,rationale,score"
    ),
    JSON.stringify(Object.keys(out[0]))
  );
}

// ── Alignment failures — the point of this test ──────────────────────────────
console.log("\nCase 2 — layerA out of order");
{
  const bad = [entryA(0), entryA(2), entryA(1), entryA(3)];
  const msg = throws(() => validateLayerAArray(bad, goodB, "<raw>", ctx));
  check("rejected", msg !== null);
  check("names the offending index", /layerA\[1\]/.test(msg || ""), msg);
}

console.log("\nCase 3 — layerB out of order while layerA is fine");
{
  const bad = [entryB(0), entryB(1), entryB(3), entryB(2)];
  const msg = throws(() => validateLayerAArray(goodA, bad, "<raw>", ctx));
  check("rejected", msg !== null);
  check("names layerB, not layerA", /layerB\[2\]/.test(msg || ""), msg);
}

console.log("\nCase 4 — duplicated questionIndex");
{
  const bad = [entryA(0), entryA(1), entryA(1), entryA(3)];
  const msg = throws(() => validateLayerAArray(bad, goodB, "<raw>", ctx));
  check("rejected by the positional check alone", msg !== null);
  check("fails at the first mismatching index", /layerA\[2\]/.test(msg || ""), msg);
}

console.log("\nCase 5 — missing questionIndex");
{
  const bad = [entryA(0), { score: 4, band0Gate: false, rationale: "x" }, entryA(2), entryA(3)];
  const msg = throws(() => validateLayerAArray(bad, goodB, "<raw>", ctx));
  check("rejected", msg !== null);
  check("reports undefined", /undefined/.test(msg || ""), msg);
}

console.log("\nCase 6 — questionIndex as a string \"0\"");
{
  const bad = [{ ...entryA(0), questionIndex: "0" }, entryA(1), entryA(2), entryA(3)];
  const msg = throws(() => validateLayerAArray(bad, goodB, "<raw>", ctx));
  check("string index rejected by strict ===", msg !== null, msg);
}

// ── Cardinality failures ─────────────────────────────────────────────────────
console.log("\nCase 7 — wrong array lengths");
{
  check("3-entry layerA rejected", throws(() => validateLayerAArray(goodA.slice(0, 3), goodB, "<raw>", ctx)) !== null);
  check("5-entry layerA rejected", throws(() => validateLayerAArray([...goodA, entryA(4)], goodB, "<raw>", ctx)) !== null);
  check("3-entry layerB rejected", throws(() => validateLayerAArray(goodA, goodB.slice(0, 3), "<raw>", ctx)) !== null);
  check("layerA as a single object rejected", throws(() => validateLayerAArray(entryA(0), goodB, "<raw>", ctx)) !== null);
  check("layerA null rejected", throws(() => validateLayerAArray(null, goodB, "<raw>", ctx)) !== null);
}

// ── Per-entry validation is genuinely reused ─────────────────────────────────
console.log("\nCase 8 — per-entry rules still enforced through the loop");
{
  const halfPoint = [{ ...entryA(0), score: 4.5 }, entryA(1), entryA(2), entryA(3)];
  check("score 4.5 rejected", throws(() => validateLayerAArray(halfPoint, goodB, "<raw>", ctx)) !== null);

  const stringScore = [{ ...entryA(0), score: "4" }, entryA(1), entryA(2), entryA(3)];
  check('score "4" rejected', throws(() => validateLayerAArray(stringScore, goodB, "<raw>", ctx)) !== null);

  const badGate = [{ questionIndex: 0, score: 0, band0Gate: false, rationale: "" }, entryA(1), entryA(2), entryA(3)];
  check("score 0 with band0Gate false rejected", throws(() => validateLayerAArray(badGate, goodB, "<raw>", ctx)) !== null);

  const gateOnNonZero = [{ questionIndex: 0, score: 4, band0Gate: "reason", rationale: "x" }, entryA(1), entryA(2), entryA(3)];
  check("score 4 with a gate reason rejected", throws(() => validateLayerAArray(gateOnNonZero, goodB, "<raw>", ctx)) !== null);

  const emptyRationale = [{ questionIndex: 0, score: 4, band0Gate: false, rationale: "" }, entryA(1), entryA(2), entryA(3)];
  check("score 4 with empty rationale rejected", throws(() => validateLayerAArray(emptyRationale, goodB, "<raw>", ctx)) !== null);
}

// ── Layer B: per-question bandZero, the one thing that does not port ─────────
console.log("\nCase 9 — Layer B bandZero is per question, not per attempt");
{
  // Q1 scores 0, Q2-Q4 score 4. Every question's model output carries items.
  // Only Q1's should be emptied.
  const mixedA = validateLayerAArray(
    [entryA(0, 0), entryA(1, 4), entryA(2, 4), entryA(3, 4)],
    goodB,
    "<raw>",
    ctx
  );
  const withItems = [0, 1, 2, 3].map((i) => ({
    questionIndex: i,
    items: [{ feature: "Elaboration", observation: `obs${i}`, target: `tgt${i}` }],
    flags: [],
    label: "practice focus — project diagnostic, not part of the score",
  }));
  const outB = buildLayerBArray(withItems, mixedA, ctx);

  check("four Layer B entries", outB.length === 4, `got ${outB.length}`);
  check("Q1 (band 0) items emptied", outB[0].items.length === 0, JSON.stringify(outB[0].items));
  check(
    "Q2-Q4 items retained",
    outB.slice(1).every((e) => e.items.length === 1),
    JSON.stringify(outB.slice(1).map((e) => e.items.length))
  );
  check(
    "questionIndex present on every Layer B entry",
    outB.every((e, i) => e.questionIndex === i),
    JSON.stringify(outB.map((e) => e.questionIndex))
  );
  check(
    "label overwritten to the trigger's constant on every entry",
    outB.every(
      (e) => e.label === "practice focus — project diagnostic, not part of the score"
    )
  );
}

// ── Layer B degrade-not-fail, unchanged for INT ──────────────────────────────
console.log("\nCase 10 — invalid feature/flag dropped, not fatal");
{
  const dirty = [0, 1, 2, 3].map((i) => ({
    questionIndex: i,
    items: [
      { feature: "Elaboration", observation: "ok", target: "ok" },
      { feature: "Social conventions", observation: "wrong list", target: "x" },
    ],
    flags: ["OFF_TOPIC", "ELEMENT_UNADDRESSED"],
    label: "model tried to change this",
  }));
  const outB = buildLayerBArray(dirty, goodA, ctx);
  check(
    "off-list feature dropped, valid one kept",
    outB.every((e) => e.items.length === 1 && e.items[0].feature === "Elaboration"),
    JSON.stringify(outB[0].items)
  );
  check(
    "off-list flag dropped, valid one kept",
    outB.every((e) => e.flags.length === 1 && e.flags[0] === "OFF_TOPIC"),
    JSON.stringify(outB[0].flags)
  );
  check("dropped content was logged", warnings.length > 0, `${warnings.length} warnings`);
}

// ── Index-base conversion — a regression test for a bug this suite missed ────
//
// Items number questions 1..4 (the corpus's own Q1..Q4, as the importer stores
// them, consistent with MCQ storing 1..5). The scoring contract indexes
// layerA/layerB 0..3. A `find` on the raw 0-based loop index matched the item's
// 1-based value, so output index 1 resolved to Q1, 2 to Q2, 3 to Q3: Q1 was
// rendered twice and Q4 never scored, silently. An array-position fallback
// masked it at index 0, which is why nothing above caught it — it surfaced only
// when a verification script crashed on the real imported data.
console.log("\nCase 11 — item 1-based questionIndex maps to 0-based output order");
{
  const item = {
    stimulus: { contextSentence: "CTX" },
    prompt: {
      questions: [1, 2, 3, 4].map((n) => ({
        questionIndex: n,
        stem: `STEM-${n}`,
        questionType: [
          "Descriptive/Observational — B2 accessible",
          "Preference + Reason — B2+",
          "Trend/Policy Evaluation — B2+/C1 border",
          "Prediction/Hypothesis — C1",
        ][n - 1],
      })),
    },
  };
  const attempt = {
    interviewClips: [0, 1, 2, 3].map((i) => ({
      questionIndex: i,
      storagePath: `p${i}`,
      durationSeconds: 40,
      transcriptStatus: "complete",
    })),
  };
  const submission = {
    attemptId: "ATT",
    responseContent: {
      transcripts: [0, 1, 2, 3].map((i) => ({
        questionIndex: i,
        transcript: `TRANSCRIPT-${i}`,
      })),
    },
  };

  const out = buildInterviewInput({ itemId: "INT-X", submission, item, attempt, ctx });

  // Each rendered block must pair item question n with runtime index n-1.
  for (let n = 1; n <= 4; n++) {
    const block = out.split(`QUESTION ${n}:`)[1].split("QUESTION ")[0];
    check(
      `Q${n} pairs STEM-${n} with TRANSCRIPT-${n - 1}`,
      block.includes(`STEM: STEM-${n}`) && block.includes(`TRANSCRIPT: TRANSCRIPT-${n - 1}`),
      block.trim().split("\n").slice(0, 4).join(" | ")
    );
  }
  check("every stem appears exactly once", [1, 2, 3, 4].every((n) => out.split(`STEM: STEM-${n}`).length === 2));
  check("Q4 is present", out.includes("STEM: STEM-4"));
  check(
    "types map to the four contract values in order",
    ["Descriptive", "Preference-Reason", "Trend-Evaluation", "Prediction-Hypothesis"].every(
      (t, i) => out.split(`QUESTION ${i + 1}:`)[1].includes(`TYPE: ${t}`)
    )
  );

  // A missing question is loud, not silently backfilled by array position.
  const gapped = { ...item, prompt: { questions: item.prompt.questions.filter((q) => q.questionIndex !== 3) } };
  const msg = throws(() => buildInterviewInput({ itemId: "INT-X", submission, item: gapped, attempt, ctx }));
  check("missing questionIndex 3 throws rather than falling back", msg !== null, msg);
}

console.log(
  failures === 0
    ? "\nINT ARRAY VALIDATION PASSED — alignment enforced, per-entry rules reused, Layer B degrades per question.\n"
    : `\nINT ARRAY VALIDATION FAILED — ${failures} check(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
