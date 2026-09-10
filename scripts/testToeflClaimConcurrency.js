#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// TEST A — claim-level concurrency check for the idempotency guard in
// functions/toeflScoring.js (onToeflSubmissionCreated).
//
// WHAT THIS PROVES, AND WHAT IT DOES NOT
//
// This exercises the transactional claim *pattern* — that two concurrent
// runTransaction claims against one submission document produce exactly one
// winner, and that the loser observes "scoring" rather than a non-terminal
// status it would proceed on. That is the property the fix rests on.
//
// It does NOT run the real trigger. The claim body below is a DUPLICATE of the
// one in toeflScoring.js, because SCORERS and the handler's claim are module-
// internal and not exported. So this test can confirm the semantics are sound;
// it cannot confirm the deployed handler still uses them. Test B does that, by
// invoking the real exported trigger twice and asserting the model was called
// exactly once. Both are needed; neither replaces the other.
//
// If the claim in toeflScoring.js is edited, this file's copy must be edited to
// match or it silently stops testing the real thing.
//
// SAFETY: refuses to run unless FIRESTORE_EMULATOR_HOST is set. Per CLAUDE.md
// the live project carries an active B10-PP student population whose
// non-interruption is a permanent constraint, so this script has no path to
// production at all.
//
// Usage:
//   firebase emulators:start --only firestore
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/testToeflClaimConcurrency.js
// ─────────────────────────────────────────────────────────────────────────────

const admin = require("firebase-admin");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");

const PROJECT_ID = process.env.GCLOUD_PROJECT || "b10-practice-platform";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    "\nREFUSING TO RUN: FIRESTORE_EMULATOR_HOST is not set.\n\n" +
      "This script writes throwaway test data. Without that variable the Admin\n" +
      "SDK would connect to the live project, which has active B10-PP students\n" +
      "on it. Start the emulator and re-run:\n\n" +
      "  firebase emulators:start --only firestore\n" +
      "  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/testToeflClaimConcurrency.js\n"
  );
  process.exit(1);
}

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const DOC_ID = "SUB-CLAIM-TEST-001";
const submissionRef = db.collection("toeflSubmissions").doc(DOC_ID);

// ── The claim under test — kept character-for-character in step with the block
// at functions/toeflScoring.js, "Retry-safe claim". ───────────────────────────
function claim(ref) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return "document gone";

    const status = snap.data().scoringStatus;
    if (status === "scoring" || status === "scored") return status;

    tx.update(ref, {
      scoringStatus: "scoring",
      scoringStartedAt: FieldValue.serverTimestamp(),
    });
    return null; // null = this delivery owns the scoring
  });
}

// ── Harness ──────────────────────────────────────────────────────────────────

let failures = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}`);
    if (detail !== undefined) console.log(`        got: ${detail}`);
  }
}

async function seedQueued() {
  await submissionRef.set({
    submissionId: DOC_ID,
    attemptId: "ATT-CLAIM-TEST-001",
    taskType: "EM",
    uid: "FIXTURE_UID_NOT_A_REAL_STUDENT",
    responseContent: { text: "throwaway", wordCount: 1 },
    scoringStatus: "queued",
    submittedAt: FieldValue.serverTimestamp(),
  });
}

// ── Case 1 — two concurrent claims, the mid-flight race the fix targets ──────
async function caseTwoConcurrent() {
  console.log("\nCase 1 — two concurrent claims on a queued submission");
  await seedQueued();

  const results = await Promise.all([claim(submissionRef), claim(submissionRef)]);

  const winners = results.filter((r) => r === null);
  const losers = results.filter((r) => r !== null);

  check("exactly one claim wins", winners.length === 1, JSON.stringify(results));
  check(
    'the loser sees "scoring", not a status it would proceed on',
    losers.length === 1 && losers[0] === "scoring",
    JSON.stringify(losers)
  );

  const after = (await submissionRef.get()).data();
  check('document left at "scoring"', after.scoringStatus === "scoring", after.scoringStatus);
  check(
    "scoringStartedAt written as a server Timestamp",
    after.scoringStartedAt instanceof Timestamp,
    String(after.scoringStartedAt)
  );
}

// ── Case 2 — five concurrent claims, same property under more contention ─────
async function caseFiveConcurrent() {
  console.log("\nCase 2 — five concurrent claims on a queued submission");
  await seedQueued();

  const results = await Promise.all(
    Array.from({ length: 5 }, () => claim(submissionRef))
  );

  const winners = results.filter((r) => r === null);
  check("exactly one claim wins", winners.length === 1, JSON.stringify(results));
  check(
    'all four losers see "scoring"',
    results.filter((r) => r === "scoring").length === 4,
    JSON.stringify(results)
  );
}

// ── Case 3 — terminal state, the redelivery-after-completion path ────────────
async function caseAlreadyScored() {
  console.log("\nCase 3 — claim against an already-scored submission");
  await seedQueued();
  await submissionRef.update({ scoringStatus: "scored" });

  const result = await claim(submissionRef);
  check('claim declines with "scored"', result === "scored", JSON.stringify(result));

  const after = (await submissionRef.get()).data();
  check(
    'status not moved back to "scoring"',
    after.scoringStatus === "scored",
    after.scoringStatus
  );
  check(
    "no scoringStartedAt stamped on a declined claim",
    after.scoringStartedAt === undefined,
    String(after.scoringStartedAt)
  );
}

// ── Case 4 — document deleted between create and claim ──────────────────────
async function caseMissingDoc() {
  console.log("\nCase 4 — claim against a deleted submission");
  await submissionRef.delete();

  const result = await claim(submissionRef);
  check(
    'claim declines with "document gone"',
    result === "document gone",
    JSON.stringify(result)
  );

  const after = await submissionRef.get();
  check("no document resurrected by the claim", !after.exists, String(after.exists));
}

async function main() {
  console.log(
    `TEST A — transactional claim semantics (emulator ${process.env.FIRESTORE_EMULATOR_HOST})`
  );

  await caseTwoConcurrent();
  await caseFiveConcurrent();
  await caseAlreadyScored();
  await caseMissingDoc();

  await submissionRef.delete(); // leave no fixture garbage behind

  console.log(
    failures === 0
      ? "\nTEST A PASSED — exactly one claim wins, losers decline, terminal states hold.\n"
      : `\nTEST A FAILED — ${failures} check(s) failed.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nTEST A ERRORED:", err);
  process.exit(1);
});
