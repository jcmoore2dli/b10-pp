#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// TEST — CTW end-to-end through the real trigger, against REAL imported items.
//
// Unlike the EM/DISC/INT seed scripts this is a genuine test, not a calibration
// harness: CTW makes no model call, so it is deterministic, free, and repeatable.
// It derives every student response from the actual imported answer key rather
// than hardcoding one, so it exercises whatever real corpus content is present.
//
// Requires firestore + functions emulators, and CTW items already imported:
//   firebase emulators:start --only firestore,functions
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/importToeflCorpus.js --type CTW
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/testToeflCtwEndToEnd.js
// ─────────────────────────────────────────────────────────────────────────────

const admin = require("firebase-admin");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("\nREFUSING TO RUN: FIRESTORE_EMULATOR_HOST is not set.\n");
  process.exit(1);
}
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "b10-practice-platform" });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`    PASS  ${label}`);
  else { failures++; console.log(`    FAIL  ${label}`); if (detail !== undefined) console.log(`          ${detail}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitScored(id, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const d = (await db.collection("toeflSubmissions").doc(id).get()).data();
    if (d && d.scoringStatus !== "queued" && d.scoringStatus !== "scoring") return d;
    await sleep(500);
  }
  return null;
}

async function main() {
  // Pick a real imported CTW item and read its true gaps + key.
  const q = await db.collection("toeflItems").where("taskType", "==", "CTW").limit(1).get();
  if (q.empty) {
    console.error("No CTW items in Firestore. Run the importer first (--type CTW).");
    process.exit(1);
  }
  const itemDoc = q.docs[0];
  const item = itemDoc.data();
  const key = (await itemDoc.ref.collection("answerKey").doc("key").get()).data();
  const truth = item.gaps.map((g) => ({
    gapIndex: g.gapIndex,
    given: g.givenLetters,
    comp: key.gaps.find((k) => k.gapIndex === g.gapIndex).correctCompletion,
  }));
  const whole = (t) => t.given + t.comp;

  console.log(`\nusing real item ${itemDoc.id} (week ${item.weekAvailability})`);
  console.log("  gaps: " + truth.map((t) => t.given + "|" + t.comp).join("  "));

  const CASES = [
    { id: "SUB-CTW-E2E-001", label: "C1 all ten correct (whole words)",
      responses: truth.map((t) => ({ gapIndex: t.gapIndex, response: whole(t) })),
      expect: 10 },
    { id: "SUB-CTW-E2E-002", label: "C2 three wrong",
      responses: truth.map((t, i) => ({ gapIndex: t.gapIndex,
        response: i < 3 ? t.given + "zzz" : whole(t) })),
      expect: 7 },
    { id: "SUB-CTW-E2E-003", label: "C3 lowercased whole words (prefix case)",
      responses: truth.map((t) => ({ gapIndex: t.gapIndex, response: whole(t).toLowerCase() })),
      expect: 10 },
    { id: "SUB-CTW-E2E-004", label: "C4 completion-only (renderer mismatch)",
      responses: truth.map((t) => ({ gapIndex: t.gapIndex, response: t.comp })),
      expect: 0 },
    { id: "SUB-CTW-E2E-005", label: "C5 all blank",
      responses: truth.map((t) => ({ gapIndex: t.gapIndex, response: "" })),
      expect: 0 },
  ];

  for (const c of CASES) {
    await db.collection("toeflAttempts").doc(c.id.replace("SUB", "ATT")).set({
      attemptId: c.id.replace("SUB", "ATT"), itemId: itemDoc.id, taskType: "CTW",
      uid: "FIXTURE_UID_NOT_A_REAL_STUDENT",
      startedAt: FV.serverTimestamp(), completedAt: FV.serverTimestamp(),
    });
  }
  for (const c of CASES) {
    await db.collection("toeflSubmissions").doc(c.id).set({
      submissionId: c.id, attemptId: c.id.replace("SUB", "ATT"),
      taskType: "CTW", uid: "FIXTURE_UID_NOT_A_REAL_STUDENT",
      responseContent: { gapResponses: c.responses },
      scoringStatus: "queued", submittedAt: FV.serverTimestamp(),
    });
    console.log(`  seeded ${c.id} — ${c.label}`);
  }

  console.log("\nwaiting for the trigger to score all five...\n");
  for (const c of CASES) {
    const d = await waitScored(c.id);
    console.log(`  ── ${c.id} — ${c.label} ──`);
    if (!d) { check("scored within timeout", false, "timed out"); continue; }
    check("scoringStatus is scored", d.scoringStatus === "scored", d.scoringStatus);
    check("claimed via the idempotency transaction", d.scoringStartedAt !== undefined);
    if (d.scoringStatus !== "scored") continue;
    const r = d.perGapResults || [];
    check("ten perGapResults", r.length === 10, r.length);
    const correct = r.filter((g) => g.isCorrect).length;
    check(`${c.expect} of 10 correct`, correct === c.expect, `got ${correct}`);
    check("every result carries correctCompletion",
      r.every((g) => typeof g.correctCompletion === "string" && g.correctCompletion.length > 0));
    check("isCorrect is strictly boolean (binary, no partial credit)",
      r.every((g) => typeof g.isCorrect === "boolean"));
    check("no aggregate score written",
      !("score" in d) && !("total" in d) && !("layerA" in d), Object.keys(d).join(","));
  }

  // The answer key must not have leaked onto anything student-readable beyond
  // the deliberate correctCompletion copy-back in perGapResults.
  console.log("\n  ── answer-key containment ──");
  const pub = (await itemDoc.ref.get()).data();
  check("public item exposes givenLetters only, never correctCompletion",
    pub.gaps.every((g) => "givenLetters" in g && !("correctCompletion" in g)),
    JSON.stringify(pub.gaps[0]));

  console.log(
    failures === 0
      ? "\nCTW END-TO-END PASSED — real items, real trigger, deterministic, no API call.\n"
      : `\nCTW END-TO-END FAILED — ${failures} check(s) failed.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("\nERRORED:", e); process.exit(1); });
