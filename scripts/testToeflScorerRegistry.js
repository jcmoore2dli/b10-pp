#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// TEST — SCORERS dispatch-table completeness (no emulator, no network, no cost).
//
// WHY THIS IS ITS OWN FILE
//
// Every other suite in this project asserts about one task type's own branch.
// None of them can catch a type that is missing from the dispatch table
// entirely, because a missing type has no branch to write a test for — which is
// exactly how LTC went unwired while 34 of its items sat imported and
// answer-keyed. A real all-correct LTC submission returned scoringStatus
// "error" with no perQuestionResults, and no existing test could have noticed.
//
// This checks the property no per-branch suite owns: that the dispatch table
// covers the data model's full taskType enum, and that nothing in it is
// registered as the wrong kind of thing. It cost nothing to write and would
// have caught the bug the moment LTC was first imported.
//
// It is deliberately blunt about the notBuiltYet types too: those are allowed
// to be unbuilt, but they must be present and callable, because presence is
// what distinguishes "queued, waiting for a scorer" from the trigger's
// unknown-taskType path that writes "error".
//
// Usage:
//   node scripts/testToeflScorerRegistry.js
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");
const Module = require("module");

const SRC = path.join(__dirname, "..", "functions", "toeflScoring.js");
const warnings = [];
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
const src =
  fs.readFileSync(SRC, "utf8") +
  "\n;module.exports.__test = { SCORERS, scoreMcq, scoreEmail, scoreDiscussion," +
  " scoreInterview, scoreCompleteTheWords };";
const fn = eval(Module.wrap(src));
const mod = { exports: {} };
fn.call(mod.exports, mod.exports, (id) => stubs[id] || require(id), mod, SRC, path.dirname(SRC));
const T = mod.exports.__test;
const { SCORERS } = T;

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`    PASS  ${label}`);
  else {
    failures++;
    console.log(`    FAIL  ${label}`);
    if (detail !== undefined) console.log(`          ${detail}`);
  }
}

// The full enum, verbatim from TOEFL_Firestore_Data_Model_Spec_v1_17.md
// Collection 1: "One of: AP, AT, INT, EM, DISC, CTW, RDL, LCR, LTA, LTC, LAR,
// BAS." Twelve types, and the corpus has a folder for each.
const ALL_TYPES = [
  "AP", "AT", "INT", "EM", "DISC", "CTW",
  "RDL", "LCR", "LTA", "LTC", "LAR", "BAS",
];

// Which scorer each type is EXPECTED to resolve to. null = legitimately
// unbuilt, must still be present and callable.
const EXPECTED = {
  AP: "scoreMcq",
  AT: "scoreMcq",
  RDL: "scoreMcq",
  LCR: "scoreMcq",
  LTA: "scoreMcq",
  LTC: "scoreMcq",
  INT: "scoreInterview",
  EM: "scoreEmail",
  DISC: "scoreDiscussion",
  CTW: "scoreCompleteTheWords",
  LAR: null,
  BAS: null,
};

console.log("\nCase 1 — every taskType in the enum resolves to a callable scorer");
{
  for (const t of ALL_TYPES) {
    check(`${t} resolves to a function`, typeof SCORERS[t] === "function",
      `SCORERS.${t} is ${typeof SCORERS[t]}` +
        (SCORERS[t] === undefined
          ? " — absent from the table means the trigger writes \"error\", not \"queued\""
          : ""));
  }
}

console.log("\nCase 2 — the table has no types the enum does not");
{
  const extra = Object.keys(SCORERS).filter((k) => !ALL_TYPES.includes(k));
  check("no unknown keys in SCORERS", extra.length === 0, JSON.stringify(extra));
  check(`exactly ${ALL_TYPES.length} entries`,
    Object.keys(SCORERS).length === ALL_TYPES.length,
    `${Object.keys(SCORERS).length} entries: ${Object.keys(SCORERS).join(",")}`);
}

console.log("\nCase 3 — each type resolves to the RIGHT scorer, not merely some scorer");
{
  for (const t of ALL_TYPES) {
    const want = EXPECTED[t];
    if (want === null) continue;
    check(`${t} → ${want}`, SCORERS[t] === T[want],
      `got ${SCORERS[t] && SCORERS[t].name ? SCORERS[t].name : "<anonymous>"}`);
  }
}

console.log("\nCase 4 — the six MCQ types share one scorer instance");
{
  const mcq = ["AP", "AT", "RDL", "LCR", "LTA", "LTC"];
  check("all six are the identical function reference",
    mcq.every((t) => SCORERS[t] === SCORERS.AP),
    JSON.stringify(mcq.map((t) => t + ":" + (SCORERS[t] === SCORERS.AP))));
  check("that reference is scoreMcq", SCORERS.AP === T.scoreMcq);
}

console.log("\nCase 5 — unbuilt types are present and return null, not absent");
{
  // notBuiltYet returns null so the trigger puts the status back to "queued".
  // A type ABSENT from the table instead reaches the unknown-taskType branch
  // and is written "error" — the distinction this whole file exists for.
  for (const t of ALL_TYPES.filter((x) => EXPECTED[x] === null)) {
    check(`${t} is present (unbuilt, but wired)`, typeof SCORERS[t] === "function");
  }
}

(async () => {
  for (const t of ALL_TYPES.filter((x) => EXPECTED[x] === null)) {
    const result = await SCORERS[t]({}, {});
    check(`${t} returns null so the trigger restores "queued"`, result === null,
      JSON.stringify(result));
  }
  check("unbuilt scorers log a warning naming the type",
    warnings.length >= ALL_TYPES.filter((x) => EXPECTED[x] === null).length,
    `${warnings.length} warnings`);

  console.log(
    failures === 0
      ? "\nSCORER REGISTRY PASSED — all 12 types wired, each to the right scorer.\n"
      : `\nSCORER REGISTRY FAILED — ${failures} check(s) failed.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
})();
