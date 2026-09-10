#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// THROWAWAY TEST FIXTURE — NOT REAL CORPUS CONTENT, NOT IMPORT-SCRIPT OUTPUT
//
// Companion to seedToeflFixture.js (which covers AP/MCQ). This one hand-writes
// two fake EM items and four submissions so the EM Layer A/B branch of
// functions/toeflScoring.js can be exercised end-to-end.
//
// Nothing here came from the TOEFL corpus. The scenarios, the bullets and every
// student response were written by hand as test data, deliberately NOT copied
// from EM-001 or any other real item. Do NOT copy this file's shape as a
// reference for the real importer — TOEFL_Import_Script_Spec_v1_11.md governs
// that, not this file.
//
// Schema sources:
//   · TOEFL_Firestore_Data_Model_Spec_v1_17.md — Collection 1 (toeflItems),
//     Collection 2 (toeflAttempts), Collection 3 (toeflSubmissions)
//   · TOEFL_Email_Scoring_Prompt_LayerAB_v1_2.md — input contract
//   · Email_Content_Spec_v1_5.md §3.1 — relationship type values
//
// NO answerKey subcollection is written, and that is correct, not an omission:
// EM has no fixed answer to hide (data model v1.17; import spec's INT/EM/DISC
// section). A spurious answerKey on an EM item would itself be a bug.
//
// The four submissions each exercise a different path:
//   S1  strong response, all three elements      → expect a high band, no flags
//   S2  element 3 never addressed                → expect ELEMENT_UNADDRESSED
//   S3  empty string                             → expect band 0 + empty Layer B
//   S4  item with no relationshipType            → expect INCOMPLETE_DATA
//
// SAFETY: refuses to run unless FIRESTORE_EMULATOR_HOST is set. This writes
// test garbage, and the live project carries an active B10-PP student
// population — per CLAUDE.md that population's non-interruption is a permanent
// constraint, so this script has no path to production at all.
//
// Usage:
//   firebase emulators:start --only firestore,functions
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seedToeflEmFixture.js
// ─────────────────────────────────────────────────────────────────────────────

const admin = require("firebase-admin");

const PROJECT_ID = process.env.GCLOUD_PROJECT || "b10-practice-platform";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    "\nREFUSING TO RUN: FIRESTORE_EMULATOR_HOST is not set.\n\n" +
      "This script writes throwaway test data. Without that variable the Admin\n" +
      "SDK would connect to the live project, which has active B10-PP students\n" +
      "on it. Start the emulator and re-run:\n\n" +
      "  firebase emulators:start --only firestore,functions\n" +
      "  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seedToeflEmFixture.js\n"
  );
  process.exit(1);
}

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

// ── Item 1 — complete scenario package ───────────────────────────────────────
// Relationship type spelled exactly as Email_Content_Spec_v1_5.md §3.1 has it,
// which is what v1.2 of the scoring prompt was corrected to match.
const ITEM_FULL = {
  itemId: "EM-TEST-001",
  taskType: "EM",
  weekAvailability: "ALL_WEEKS", // EM, per ISD §8.1
  status: "active",

  // Appendix A: EM stimulus is {scenarioText, recipientContext}
  stimulus: {
    scenarioText:
      "The bicycle you ordered from a local shop arrived last week with a bent " +
      "rear wheel. You have already spoken to the shop by phone and were told " +
      "to put your complaint in writing. You decide to email the shop's owner, " +
      "Ms. Danforth, whom you have not met.",
    recipientContext: null, // see note in the branch review — no corpus source
  },

  prompt: {
    relationshipType: "Reader/contributor to institution",
    requiredElements: [
      "Describe the damage you found when the bicycle arrived.",
      "Explain what the phone call with the shop resolved and what it did not.",
      "Ask what the shop will do to repair or replace the wheel, and by when.",
    ],
    header: {
      to: "Ms. Danforth",
      subject: "Damaged Wheel on Recent Bicycle Order",
    },
  },

  // Loud non-value: makes the fixture identifiable as fake even if someone
  // finds the document without this script.
  contentSpecVersion: "FIXTURE_NOT_A_REAL_SPEC_VERSION",
  layer3Status: "pending",
  importedAt: admin.firestore.FieldValue.serverTimestamp(),
};

// ── Item 2 — same package, relationshipType deliberately absent ──────────────
// The input contract's documented degrade case: score Layer A normally, judge
// register against the scenario's evident recipient, raise INCOMPLETE_DATA,
// and never guess one of the four types.
const ITEM_NO_RELATIONSHIP = {
  ...ITEM_FULL,
  itemId: "EM-TEST-002",
  prompt: {
    // relationshipType omitted on purpose — this is the whole point of the item
    requiredElements: ITEM_FULL.prompt.requiredElements,
    header: ITEM_FULL.prompt.header,
  },
};

// ── Student responses, all hand-written test data ────────────────────────────

// S1 — all three elements, register pitched for a business owner, a couple of
// one-off typos ("recieved", "seperate") and no systematic error. Under A2.4's
// pattern-not-count rule those slips should not pull the band down.
const RESPONSE_STRONG = `Dear Ms. Danforth,

I am writing about an order I recieved from your shop last Tuesday. I want to say first that the frame and components are beautifully put together, and the assembly work is clearly careful.

Unfortunately, the rear wheel arrived bent. The rim is visibly out of true — it rubs the brake pad on every rotation — and one spoke on the drive side is loose enough to turn by hand. The box itself showed no damage, so I don't believe this happened in transit.

I called the shop on Wednesday and spoke with someone who confirmed the wheel should not have shipped in that condition, and asked me to put the complaint in writing. That call did not settle what happens next, which is why I am writing.

Could you let me know whether the shop will true the existing wheel or replace it, and roughly when I might expect that to happen? I commute on this bicycle, so a seperate loaner would help if the repair takes more than a few days.

Thank you for your time.

Sincerely,
Tomas Ruiz`;

// S2 — elements 1 and 2 handled; element 3 (what will be done, and by when) is
// never asked. Expect ELEMENT_UNADDRESSED plus a Required elements item naming
// the third bullet.
const RESPONSE_MISSING_ELEMENT = `Dear Ms. Danforth,

I bought a bicycle from your shop and when it came the back wheel was bent. The rim is not straight and it touches the brake when it turns. Also one spoke is loose.

I called the shop already on Wednesday. The person I talked to said the wheel should not have been sent like that and told me to write an email about it. So that is what the phone call did, but nothing was decided.

I am disappointed because this is an expensive bicycle and I expected better quality control from a shop with your reputation.

Sincerely,
Tomas Ruiz`;

// S3 — empty. A0's first band-0 condition. Deliberately NOT short-circuited in
// the branch: A0 owns that call, not the trigger.
const RESPONSE_EMPTY = "";

// S4 — a competent response, run against the item that has no relationshipType.
// Layer A should score normally; INCOMPLETE_DATA should appear in Layer B.
const RESPONSE_FOR_MISSING_TYPE = `Dear Ms. Danforth,

I am writing about a bicycle I ordered from your shop last week. When I unpacked it, the rear wheel was bent — the rim rubs against the brake pad and one spoke is loose.

I phoned the shop on Wednesday. The person I spoke with agreed the wheel should not have left the shop in that state and asked me to send my complaint in writing, but we did not settle what happens now.

Would you be able to tell me whether the wheel will be trued or replaced, and when the work could be done? I use the bicycle to get to work each day.

Thank you very much.

Sincerely,
Tomas Ruiz`;

function wordCount(text) {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}

// attemptId → the route from submission to item (data model Collection 3: the
// submission carries no itemId of its own).
const CASES = [
  {
    label: "S1  strong, all three elements",
    itemId: "EM-TEST-001",
    attemptId: "ATT-EM-TEST-001",
    submissionId: "SUB-EM-TEST-001",
    text: RESPONSE_STRONG,
    expect: "band 4–5, no flags, Layer B items from the closed list",
  },
  {
    label: "S2  element 3 unaddressed",
    itemId: "EM-TEST-001",
    attemptId: "ATT-EM-TEST-002",
    submissionId: "SUB-EM-TEST-002",
    text: RESPONSE_MISSING_ELEMENT,
    expect: "ELEMENT_UNADDRESSED flag, Required elements item naming bullet 3",
  },
  {
    label: "S3  empty response",
    itemId: "EM-TEST-001",
    attemptId: "ATT-EM-TEST-003",
    submissionId: "SUB-EM-TEST-003",
    text: RESPONSE_EMPTY,
    expect: 'score 0, band0Gate a reason string, layerB.items empty',
  },
  {
    label: "S4  item has no relationshipType",
    itemId: "EM-TEST-002",
    attemptId: "ATT-EM-TEST-004",
    submissionId: "SUB-EM-TEST-004",
    text: RESPONSE_FOR_MISSING_TYPE,
    expect: "scored normally + INCOMPLETE_DATA flag",
  },
];

async function main() {
  for (const item of [ITEM_FULL, ITEM_NO_RELATIONSHIP]) {
    await db.collection("toeflItems").doc(item.itemId).set(item);
    console.log(`wrote toeflItems/${item.itemId}`);
  }

  for (const c of CASES) {
    await db.collection("toeflAttempts").doc(c.attemptId).set({
      attemptId: c.attemptId,
      itemId: c.itemId,
      taskType: "EM",
      uid: "FIXTURE_UID_NOT_A_REAL_STUDENT",
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`wrote toeflAttempts/${c.attemptId}`);
  }

  // Submissions last, and one at a time: each create is what fires
  // onToeflSubmissionCreated.
  for (const c of CASES) {
    await db.collection("toeflSubmissions").doc(c.submissionId).set({
      submissionId: c.submissionId,
      attemptId: c.attemptId,
      taskType: "EM",
      uid: "FIXTURE_UID_NOT_A_REAL_STUDENT",
      responseContent: { text: c.text, wordCount: wordCount(c.text) },
      scoringStatus: "queued",
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`wrote toeflSubmissions/${c.submissionId}  — ${c.label}`);
  }

  console.log(
    `\nFixture seeded (emulator ${process.env.FIRESTORE_EMULATOR_HOST}).\n` +
      CASES.map((c) => `  ${c.label}\n      expect: ${c.expect}`).join("\n") +
      `\n\nThe trigger is now calling the Anthropic API once per submission.\n` +
      `Read the results back with scripts/readToeflEmResults.js\n`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("seed failed:", err);
    process.exit(1);
  });
