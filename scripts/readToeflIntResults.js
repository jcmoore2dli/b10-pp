#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Reads back what the INT branch actually wrote, for the five submissions
// seedToeflIntFixture.js creates. Read-only; emulator-only.
//
// Also asserts the structural properties that matter and cannot be eyeballed
// from a wall of JSON:
//   · layerA and layerB are four entries each, questionIndex 0-3, ALIGNED
//   · no aggregate/average score field was written anywhere
//   · F2's no-recording is scoped to ONE question, not the attempt
//   · F3 wrote NO layerA/layerB at all — a system failure is not a zero
//   · F4's INCOMPLETE_DATA is on Q4 only
//
// Usage:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/readToeflIntResults.js
// ─────────────────────────────────────────────────────────────────────────────

const admin = require("firebase-admin");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("\nREFUSING TO RUN: FIRESTORE_EMULATOR_HOST is not set.\n");
  process.exit(1);
}

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "b10-practice-platform" });
const db = admin.firestore();

const CASES = [
  ["SUB-INT-TEST-001", "F1 four recorded answers, varying quality"],
  ["SUB-INT-TEST-002", "F2 Q3 no recording"],
  ["SUB-INT-TEST-003", "F3 Q2 transcription failed"],
  ["SUB-INT-TEST-004", "F4 Q4 delivery evidence absent"],
  ["SUB-INT-TEST-005", "F5 all four no recording"],
];

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`    PASS  ${label}`);
  else {
    failures++;
    console.log(`    FAIL  ${label}`);
    if (detail !== undefined) console.log(`          ${detail}`);
  }
}

const AGGREGATE_KEYS = ["score", "taskScore", "average", "overall", "band", "总"];

async function main() {
  const docs = {};

  for (const [id, label] of CASES) {
    const snap = await db.collection("toeflSubmissions").doc(id).get();
    console.log("════════════════════════════════════════════════════════════");
    console.log(`${id}  — ${label}`);
    if (!snap.exists) {
      console.log("  MISSING DOCUMENT");
      failures++;
      continue;
    }
    const d = snap.data();
    docs[id] = d;
    console.log(`  scoringStatus : ${d.scoringStatus}`);
    if (d.scoringStartedAt) {
      console.log(`  claimedAt     : ${d.scoringStartedAt.toDate().toISOString()}`);
    }

    if (d.scoringStatus !== "scored") {
      console.log(`  layerA present: ${d.layerA !== undefined}`);
      console.log(`  layerB present: ${d.layerB !== undefined}`);
      continue;
    }

    console.log(`  scores        : [${(d.layerA || []).map((a) => a.score).join(", ")}]`);
    for (const a of d.layerA || []) {
      const b = (d.layerB || []).find((x) => x.questionIndex === a.questionIndex);
      console.log(`  ── Q${a.questionIndex + 1} (index ${a.questionIndex}) ──`);
      console.log(`     score     : ${a.score}`);
      console.log(`     band0Gate : ${JSON.stringify(a.band0Gate)}`);
      console.log(`     rationale : ${a.rationale ? a.rationale.slice(0, 150) : "(empty)"}`);
      console.log(`     flags     : ${JSON.stringify((b || {}).flags)}`);
      console.log(`     items     : ${((b || {}).items || []).length}`);
      for (const it of ((b || {}).items || [])) {
        console.log(`        · ${it.feature}: ${it.observation.slice(0, 90)}`);
      }
    }
    console.log(`  status        : ${JSON.stringify(d.status)}`);
    console.log(`  instructor    : ${JSON.stringify(d.instructor)}`);
  }

  console.log("════════════════════════════════════════════════════════════");
  console.log("\n=== Structural assertions ===\n");

  for (const [id, label] of CASES) {
    const d = docs[id];
    if (!d || d.scoringStatus !== "scored") continue;
    console.log(`  ${id} (${label.split(" ")[0]}):`);
    check("layerA has 4 entries", (d.layerA || []).length === 4, `${(d.layerA || []).length}`);
    check("layerB has 4 entries", (d.layerB || []).length === 4, `${(d.layerB || []).length}`);
    check(
      "layerA questionIndex 0,1,2,3 in order",
      (d.layerA || []).every((a, i) => a.questionIndex === i),
      JSON.stringify((d.layerA || []).map((a) => a.questionIndex))
    );
    check(
      "layerB questionIndex 0,1,2,3 in order",
      (d.layerB || []).every((b, i) => b.questionIndex === i),
      JSON.stringify((d.layerB || []).map((b) => b.questionIndex))
    );
    check(
      "no aggregate/average score written at top level",
      !AGGREGATE_KEYS.some((k) => Object.prototype.hasOwnProperty.call(d, k)),
      JSON.stringify(Object.keys(d))
    );
    check(
      "every band-0 question has empty items",
      (d.layerA || []).every((a) => {
        if (a.score !== 0) return true;
        const b = (d.layerB || []).find((x) => x.questionIndex === a.questionIndex);
        return ((b || {}).items || []).length === 0;
      })
    );
  }

  console.log("\n=== Case-specific expectations ===\n");

  // F2 — no recording is per QUESTION
  const f2 = docs["SUB-INT-TEST-002"];
  if (f2 && f2.scoringStatus === "scored") {
    const q3 = (f2.layerA || []).find((a) => a.questionIndex === 2);
    const others = (f2.layerA || []).filter((a) => a.questionIndex !== 2);
    console.log("  F2 no-recording scope:");
    check("Q3 scored 0", q3 && q3.score === 0, JSON.stringify(q3));
    check('Q3 band0Gate is a "no response" reason string', q3 && typeof q3.band0Gate === "string" && q3.band0Gate.length > 0, JSON.stringify(q3 && q3.band0Gate));
    check(
      "the OTHER three questions were scored normally (not zeroed)",
      others.every((a) => a.score > 0),
      JSON.stringify(others.map((a) => a.score))
    );
  }

  // F3 — transcription failure is per ATTEMPT and is never a zero
  const f3 = docs["SUB-INT-TEST-003"];
  console.log("\n  F3 transcription failure:");
  check('scoringStatus is "error"', f3 && f3.scoringStatus === "error", f3 && f3.scoringStatus);
  check("NO layerA written", f3 && f3.layerA === undefined);
  check("NO layerB written", f3 && f3.layerB === undefined);
  check("no partial score of any kind", f3 && f3.status === undefined);

  // F4 — INCOMPLETE_DATA scoped to the question missing evidence
  const f4 = docs["SUB-INT-TEST-004"];
  if (f4 && f4.scoringStatus === "scored") {
    const flagged = (f4.layerB || []).filter((b) => (b.flags || []).includes("INCOMPLETE_DATA"));
    console.log("\n  F4 missing delivery evidence:");
    check(
      "INCOMPLETE_DATA on exactly one question",
      flagged.length === 1,
      JSON.stringify(flagged.map((b) => b.questionIndex))
    );
    check("and that question is Q4 (index 3)", flagged.length === 1 && flagged[0].questionIndex === 3, JSON.stringify(flagged.map((b) => b.questionIndex)));
    const q4 = (f4.layerA || []).find((a) => a.questionIndex === 3);
    check("Q4 still received a score (not zeroed for missing evidence)", q4 && q4.score > 0, JSON.stringify(q4 && q4.score));
  }

  // F5 — all four band 0
  const f5 = docs["SUB-INT-TEST-005"];
  if (f5 && f5.scoringStatus === "scored") {
    console.log("\n  F5 all four no recording:");
    check("all four scored 0", (f5.layerA || []).every((a) => a.score === 0), JSON.stringify((f5.layerA || []).map((a) => a.score)));
    check("all four have a band0Gate reason", (f5.layerA || []).every((a) => typeof a.band0Gate === "string" && a.band0Gate.length > 0));
    check("all four have empty items", (f5.layerB || []).every((b) => (b.items || []).length === 0));
  }

  console.log(
    failures === 0
      ? "\nINT FIXTURE PASSED — arrays aligned, no-recording scoped per question, system failure not scored as a zero.\n"
      : `\nINT FIXTURE FAILED — ${failures} check(s) failed.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nREAD FAILED:", err);
  process.exit(1);
});
