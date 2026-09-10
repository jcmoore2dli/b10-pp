#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Reads back what the DISC branch actually wrote, for the five submissions
// seedToeflDiscFixture.js creates. Read-only; emulator-only, same guard as the
// seed script.
//
// Also runs the one comparison the acceptance test cares about: S1 (engages a
// peer) against S2 (identical quality, engages nobody). Under the retired rule
// S2 was capped at band 3. Under v1.1 the two should be at essentially the same
// band, so a material gap is flagged here rather than left for a human to
// notice in a wall of JSON.
//
// Usage:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/readToeflDiscResults.js
// ─────────────────────────────────────────────────────────────────────────────

const admin = require("firebase-admin");

const PROJECT_ID = process.env.GCLOUD_PROJECT || "b10-practice-platform";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    "\nREFUSING TO RUN: FIRESTORE_EMULATOR_HOST is not set.\n" +
      "This reader is emulator-only, same guard as the seed script.\n"
  );
  process.exit(1);
}

const CASES = [
  ["SUB-DISC-TEST-001", "S1 strong + substantive peer engagement"],
  ["SUB-DISC-TEST-002", "S2 strong, NO peer mention (counterfactual)"],
  ["SUB-DISC-TEST-003", "S3 bare assertion, no support"],
  ["SUB-DISC-TEST-004", "S4 empty response"],
  ["SUB-DISC-TEST-005", "S5 strong, item has NO peer posts"],
];

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

async function main() {
  const scores = {};

  for (const [id, label] of CASES) {
    const snap = await db.collection("toeflSubmissions").doc(id).get();
    console.log("════════════════════════════════════════════════════════════");
    console.log(`${id}  — ${label}`);
    if (!snap.exists) {
      console.log("  MISSING DOCUMENT");
      continue;
    }
    const d = snap.data();
    console.log(`  scoringStatus : ${d.scoringStatus}`);
    if (d.scoringStartedAt) {
      console.log(`  claimedAt     : ${d.scoringStartedAt.toDate().toISOString()}`);
    }
    if (d.scoringStatus !== "scored") {
      console.log("  (not scored — nothing further written)");
      continue;
    }

    scores[id] = d.layerA?.score;
    console.log(`  layerA.score  : ${d.layerA?.score}`);
    console.log(`  band0Gate     : ${JSON.stringify(d.layerA?.band0Gate)}`);
    console.log(`  rationale     : ${d.layerA?.rationale || "(empty)"}`);
    console.log(`  layerB.flags  : ${JSON.stringify(d.layerB?.flags)}`);
    console.log(`  layerB.label  : ${d.layerB?.label}`);
    console.log(`  layerB.items  : ${(d.layerB?.items || []).length}`);
    for (const it of d.layerB?.items || []) {
      console.log(`     · ${it.feature}`);
      console.log(`         observation: ${it.observation}`);
      console.log(`         target     : ${it.target}`);
    }
    console.log(`  status        : ${JSON.stringify(d.status)}`);
    console.log(`  instructor    : ${JSON.stringify(d.instructor)}`);
  }

  console.log("════════════════════════════════════════════════════════════");
  console.log("\n=== Acceptance check: retired peer-naming cap ===\n");
  const s1 = scores["SUB-DISC-TEST-001"];
  const s2 = scores["SUB-DISC-TEST-002"];
  if (s1 == null || s2 == null) {
    console.log("  inconclusive — one of S1/S2 did not score");
  } else {
    console.log(`  S1 (engages a peer)  : band ${s1}`);
    console.log(`  S2 (engages nobody)  : band ${s2}`);
    if (s2 >= s1 - 1) {
      console.log(
        `\n  PASS — S2 is not penalised for engaging nobody. The retired cap\n` +
          `  (which would have held S2 at 3) is genuinely gone.`
      );
    } else {
      console.log(
        `\n  FAIL — S2 sits ${s1 - s2} bands below S1. The retired peer-naming\n` +
          `  cap appears to have leaked back in; that is a real defect, not a nuance.`
      );
    }
  }

  console.log("\n=== Flag expectations ===\n");
  const check = (id, flag, want) => {
    const has = (scores[id] != null);
    console.log(`  ${id}: ${want ? "expects" : "must NOT have"} ${flag}`);
  };
  console.log("  (compare against layerB.flags printed above)");
  console.log("    S3 → NO_CONTRIBUTION");
  console.log("    S5 → INCOMPLETE_DATA (trigger-authored, not model-authored)");
  console.log("    S1/S2 → no flags\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nREAD FAILED:", err);
    process.exit(1);
  });
