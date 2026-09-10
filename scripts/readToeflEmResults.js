#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Reads back what the EM branch actually wrote, for the four submissions
// seedToeflEmFixture.js creates. Read-only; emulator-only, same guard as the
// seed script.
//
// Usage:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/readToeflEmResults.js
// ─────────────────────────────────────────────────────────────────────────────

const admin = require("firebase-admin");

const PROJECT_ID = process.env.GCLOUD_PROJECT || "b10-practice-platform";
const IDS = [
  "SUB-EM-TEST-001",
  "SUB-EM-TEST-002",
  "SUB-EM-TEST-003",
  "SUB-EM-TEST-004",
];

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("REFUSING TO RUN: FIRESTORE_EMULATOR_HOST is not set.");
  process.exit(1);
}

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

async function main() {
  for (const id of IDS) {
    const snap = await db.collection("toeflSubmissions").doc(id).get();
    console.log("═".repeat(78));
    if (!snap.exists) {
      console.log(`${id}  — DOCUMENT MISSING`);
      continue;
    }
    const d = snap.data();
    console.log(`${id}   scoringStatus: ${d.scoringStatus}`);
    console.log("─".repeat(78));
    console.log(
      JSON.stringify(
        {
          layerA: d.layerA,
          layerB: d.layerB,
          status: d.status,
          instructor: d.instructor,
          scoredAt: d.scoredAt ? d.scoredAt.toDate().toISOString() : null,
        },
        null,
        2
      )
    );
  }
  console.log("═".repeat(78));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("read failed:", err);
    process.exit(1);
  });
