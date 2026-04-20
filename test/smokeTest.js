// smokeTest.js
// Triggers a real end-to-end pipeline run against production.
// Audio → Firebase Storage → Firestore submission → Cloud Function → scored result.
//
// Usage: node test/smokeTest.js

"use strict";

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

// Initialize Firebase Admin with application default credentials
admin.initializeApp({
  projectId: "b10-practice-platform",
  storageBucket: "b10-practice-platform.firebasestorage.app",
});

const db = admin.firestore();
const storage = admin.storage();

const AUDIO_PATH = path.join(__dirname, "audio", "R001__EXT-1A-01.mp3");
const STORAGE_PATH = "test/R001__EXT-1A-01.mp3";

// Test submission data — ESO task, holistic mode
const TEST_SUBMISSION = {
  studentId: "STU001",
  audioPath: STORAGE_PATH,
  taskType: "ESO",
  promptDescription: "Do you think governments should regulate social media platforms? State and defend your position.",
  scaffoldConfig: {
    focusArea: "Holistic",
    primaryFrame: "none",
    secondaryFrame: "none",
  },
  status: "queued",
  submissionNumber: 0,
  createdAt: admin.firestore.FieldValue.serverTimestamp(),
};

async function run() {
  console.log("── B10-PP Pipeline Smoke Test ──────────────────────────");

  // Step 1: Upload audio to Firebase Storage
  console.log("Step 1: Uploading audio to Firebase Storage...");
  const bucket = storage.bucket();
  await bucket.upload(AUDIO_PATH, {
    destination: STORAGE_PATH,
    metadata: { contentType: "audio/mpeg" },
  });
  console.log(`✔ Audio uploaded to gs://${bucket.name}/${STORAGE_PATH}`);

  // Step 2: Create submission document in Firestore
  console.log("Step 2: Creating submission document...");
  const submissionRef = await db.collection("submissions").add(TEST_SUBMISSION);
  const submissionId = submissionRef.id;
  console.log(`✔ Submission created: ${submissionId}`);
  console.log("  Waiting for Cloud Function to process...");

  // Step 3: Poll for result (max 90 seconds)
  const start = Date.now();
  const TIMEOUT = 90000;
  const POLL_INTERVAL = 3000;

  while (Date.now() - start < TIMEOUT) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));

    const snap = await db.collection("submissions").doc(submissionId).get();
    const data = snap.data();

    if (!data) {
      console.log("  Document not found — retrying...");
      continue;
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  [${elapsed}s] status: ${data.status}`);

    if (data.status === "complete") {
      console.log("\n── SCORED RESULT ───────────────────────────────────────");
      console.log(`  submissionId:  ${submissionId}`);
      console.log(`  taskType:      ${TEST_SUBMISSION.taskType}`);
      console.log(`  taskFamily:    ${data.taskFamily}`);
      console.log(`  score:         ${data.score}`);
      console.log(`  score_label:   ${data.score_label}`);
      console.log(`  strengths:     ${data.strengths}`);
      console.log(`  gaps:          ${data.gaps}`);
      console.log(`  language_feedback: ${data.language_feedback}`);
      console.log(`  transcript_note:   ${data.transcript_note}`);
      console.log(`  pass2Available:    ${data.pass2Available}`);
      console.log(`  rawTranscript: ${data.rawTranscript?.slice(0, 200)}...`);
      console.log("────────────────────────────────────────────────────────");
      console.log("✔ Tuesday hard gate: REAL SCORED RESULT IN LOGS");
      process.exit(0);
    }

    if (data.status === "error") {
      console.error("\n── PIPELINE ERROR ──────────────────────────────────────");
      console.error(`  errorMessage: ${data.errorMessage}`);
      console.error("────────────────────────────────────────────────────────");
      process.exit(1);
    }
  }

  console.error("✘ Timeout — no result after 90 seconds.");
  process.exit(1);
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
