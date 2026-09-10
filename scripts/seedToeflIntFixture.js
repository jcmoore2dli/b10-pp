#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// THROWAWAY TEST FIXTURE — NOT REAL CORPUS CONTENT, NOT IMPORTER OUTPUT
//
// Companion to seedToeflEmFixture.js / seedToeflDiscFixture.js. Hand-writes
// three fake INT items and five attempts/submissions so the INT Layer A/B
// branch of functions/toeflScoring.js can be exercised end-to-end against the
// real Anthropic API.
//
// Nothing here came from the TOEFL corpus. The interview context, all question
// stems and every transcript were written by hand as test data, deliberately
// NOT copied from INT-001 or any other real item.
//
// ── THE SHAPE THIS FILE DEFINES, AND ITS STATUS ─────────────────────────────
//
// `toeflSubmissions.responseContent` for INT is specified in
// TOEFL_Firestore_Data_Model_Spec_v1_17.md only as `{transcripts: [...],
// audioClips: [...]}` — the inner shape is not defined anywhere, and nothing
// in the codebase produces it yet. This fixture therefore DEFINES it:
//
//   transcripts: [{
//     questionIndex: 0..3,              // 0-BASED, see note below
//     transcript: string,               // raw Deepgram text, fillers retained
//     deliveryEvidence: {               // null when unavailable — never faked
//       wordsPerMinute, meanGapSeconds,
//       longPauseCount, longPauseTimestamps,
//       severePauseCount, severePauseTimestamps,
//       filledPauseCount, wordConfidencePattern, durationSeconds
//     } | null
//   }]
//
// FLAGGED FOR RATIFICATION, NOT SETTLED (JC, Sep 10). Two things need a real
// decision, not a fixture's say-so:
//   1. This shape itself, into the data model spec.
//   2. The index base. Corpus items number questions 1..4 (Q1..Q4 as the files
//      write them, and MCQ types store 1..5 the same way), while the Interview
//      scoring prompt's OUTPUT contract indexes layerA/layerB 0..3. This
//      fixture uses 0-based for runtime artifacts (interviewClips,
//      transcripts) to match the scoring contract, and the branch converts at
//      the item lookup only. That split is real, undocumented in v1.17, and
//      already caused one silently-wrong question assignment during this
//      build — it should be written down, whichever base wins.
//
// Also open, tracked to the next Fable calibration session: the delivery-
// evidence threshold divergence. The input contract asks for pauses measured
// at 0.495s and a mean run length; this pipeline computes 1.5s/2.5s tiers and
// no run length. The evidence below uses the real thresholds and the branch
// labels the divergence in the payload it sends.
//
// The five cases each exercise a different path:
//   F1  four recorded answers, varying quality   → four scores, arrays aligned
//   F2  Q3 has NO recording                      → Q3 band 0, Q1/Q2/Q4 normal
//   F3  Q2 recorded but transcription FAILED      → scoringStatus "error",
//                                                   model NEVER called
//   F4  Q4 delivery evidence absent               → INCOMPLETE_DATA on Q4 only
//   F5  all four have NO recording                → four band-0s
//
// F2 and F3 are the pair that matters most. They look identical from inside
// the model and are opposite in outcome: one is a student's zero, the other is
// a system failure that must never be scored as one.
//
// SAFETY: refuses to run unless FIRESTORE_EMULATOR_HOST is set. This writes
// test garbage AND triggers real paid Anthropic calls (4 of them — F3 makes
// none by design). The live project carries an active B10-PP student
// population whose non-interruption is a permanent operating constraint per
// CLAUDE.md, so this script has no path to production at all.
//
// Usage:
//   firebase emulators:start --only firestore,functions
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seedToeflIntFixture.js
// ─────────────────────────────────────────────────────────────────────────────

const admin = require("firebase-admin");

const PROJECT_ID = process.env.GCLOUD_PROJECT || "b10-practice-platform";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    "\nREFUSING TO RUN: FIRESTORE_EMULATOR_HOST is not set.\n\n" +
      "This script writes throwaway test data AND triggers real paid Anthropic\n" +
      "calls. Without that variable the Admin SDK would connect to the live\n" +
      "project, which has active B10-PP students on it. Start the emulator:\n\n" +
      "  firebase emulators:start --only firestore,functions\n" +
      "  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seedToeflIntFixture.js\n"
  );
  process.exit(1);
}

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

// ── Item — four questions, one per contract type, item-side 1-BASED ──────────
// Question types are written as the corpus writes them (rich tags), not as the
// contract's four enum values, so the branch's prefix mapping is exercised for
// real rather than handed pre-mapped input.
const ITEM = {
  itemId: "INT-TEST-001",
  taskType: "INT",
  weekAvailability: "ALL_WEEKS",
  status: "active",
  stimulus: {
    contextSentence:
      "You have volunteered for a research study about how people travel to " +
      "work. You will have a short online interview with a researcher.",
  },
  prompt: {
    questions: [
      {
        questionIndex: 1,
        questionType: "Descriptive/Observational — B2 accessible",
        stem:
          "Can you describe how you usually travel to work or school — for " +
          "example by car, bus, bicycle, or on foot?",
      },
      {
        questionIndex: 2,
        questionType: "Preference + Reason — B2+",
        stem:
          "Would you rather travel to work alone or with other people? Why?",
      },
      {
        questionIndex: 3,
        questionType: "Trend/Policy Evaluation — B2+/C1 border",
        stem:
          "Some cities now charge drivers a fee to enter the city centre in " +
          "order to reduce traffic, but critics say this is unfair to people " +
          "who cannot afford it. Do you think this is a fair concern? Why or " +
          "why not?",
      },
      {
        questionIndex: 4,
        questionType: "Prediction/Hypothesis — C1",
        stem:
          "Remote work has already changed how often many people commute. Do " +
          "you think daily commuting will become more or less common in the " +
          "future? Explain your thinking.",
      },
    ],
  },
  contentSpecVersion: "FIXTURE_NOT_A_REAL_SPEC_VERSION",
  layer3Status: "pending",
  importedAt: FV.serverTimestamp(),
};

// ── Hand-written transcripts, fillers retained as Deepgram would ─────────────

const T_STRONG_Q1 =
  "I usually take the tram, actually. It's about a twenty minute ride from my " +
  "flat to the office, and there's a stop maybe three minutes walk from my " +
  "building, so it's pretty convenient. On days when the weather is good I " +
  "sometimes cycle instead, which takes a bit longer but I arrive feeling a " +
  "lot more awake.";

const T_STRONG_Q2 =
  "I think I prefer travelling alone, mostly because it's the only quiet part " +
  "of my day. I use the time to read or just sort of plan out what I need to " +
  "do, and if I'm with someone I feel like I should be talking to them. That " +
  "said, when I do share a ride with a colleague we often end up solving some " +
  "work problem on the way in, so I can see the value in it.";

const T_MID_Q3 =
  "Um, I think it is a fair concern, yes. If you charge everyone the same fee " +
  "then, uh, for someone on a low income that is a much bigger cost than for " +
  "someone who is wealthy. So the same charge is not really the same burden. " +
  "But I also think, um, the traffic problem is real, so maybe the answer is " +
  "not to remove the fee but to, uh, spend the money on better buses so " +
  "people have a choice.";

const T_WEAK_Q4 =
  "Uh, I think, um, commuting will be less common. Because of remote work. " +
  "Uh, many people work from home now. So, yeah, I think less common. Uh, " +
  "that's what I think.";

const T_SHORT_Q1 = "I take the bus. It is about thirty minutes.";

// Delivery evidence at the thresholds this pipeline actually computes.
const EV_FLUENT = {
  wordsPerMinute: 142,
  meanGapSeconds: 0.18,
  longPauseCount: 1,
  longPauseTimestamps: "12.4s",
  severePauseCount: 0,
  severePauseTimestamps: "none",
  filledPauseCount: 0,
  wordConfidencePattern: "mean 0.96; no low-confidence stretches",
  durationSeconds: 41,
};
const EV_HESITANT = {
  wordsPerMinute: 96,
  meanGapSeconds: 0.44,
  longPauseCount: 6,
  longPauseTimestamps: "3.1s, 8.8s, 15.2s, 22.7s, 29.9s, 36.4s",
  severePauseCount: 2,
  severePauseTimestamps: "15.2s, 29.9s",
  filledPauseCount: 5,
  wordConfidencePattern: "mean 0.88; two low-confidence stretches (16-18s, 31-33s)",
  durationSeconds: 55,
};
const EV_CHOPPY = {
  wordsPerMinute: 71,
  meanGapSeconds: 0.62,
  longPauseCount: 8,
  longPauseTimestamps: "1.9s, 5.2s, 9.0s, 12.6s, 16.1s, 19.4s, 23.0s, 26.8s",
  severePauseCount: 4,
  severePauseTimestamps: "5.2s, 12.6s, 19.4s, 26.8s",
  filledPauseCount: 6,
  wordConfidencePattern: "mean 0.81; frequent short low-confidence runs",
  durationSeconds: 32,
};

function clip(i, { recorded = true, status = "complete", duration = 40 } = {}) {
  if (!recorded) {
    // No recording: no storagePath at all. This is the discriminator the
    // branch keys on — storagePath absence means the student recorded nothing.
    return { questionIndex: i, storagePath: null, durationSeconds: 0, transcriptStatus: "none" };
  }
  return {
    questionIndex: i,
    storagePath: `toefl/int/FIXTURE/${i}.webm`,
    durationSeconds: duration,
    transcriptStatus: status,
  };
}

function tr(i, transcript, deliveryEvidence) {
  return { questionIndex: i, transcript, deliveryEvidence: deliveryEvidence || null };
}

const CASES = [
  {
    id: "F1",
    submissionId: "SUB-INT-TEST-001",
    attemptId: "ATT-INT-TEST-001",
    label: "F1 four recorded answers, varying quality",
    clips: [clip(0), clip(1), clip(2), clip(3)],
    transcripts: [
      tr(0, T_STRONG_Q1, EV_FLUENT),
      tr(1, T_STRONG_Q2, EV_FLUENT),
      tr(2, T_MID_Q3, EV_HESITANT),
      tr(3, T_WEAK_Q4, EV_CHOPPY),
    ],
    expect:
      "four scores, layerA/layerB aligned 0-3, Q4 lowest; delivery read qualitatively",
  },
  {
    id: "F2",
    submissionId: "SUB-INT-TEST-002",
    attemptId: "ATT-INT-TEST-002",
    label: "F2 Q3 has NO recording (student recorded nothing)",
    clips: [clip(0), clip(1), clip(2, { recorded: false }), clip(3)],
    transcripts: [
      tr(0, T_STRONG_Q1, EV_FLUENT),
      tr(1, T_STRONG_Q2, EV_FLUENT),
      // no entry for index 2 at all
      tr(3, T_WEAK_Q4, EV_CHOPPY),
    ],
    expect:
      'Q3 (index 2) score 0 + band0Gate "no response" + empty items; Q1/Q2/Q4 scored normally',
  },
  {
    id: "F3",
    submissionId: "SUB-INT-TEST-003",
    attemptId: "ATT-INT-TEST-003",
    label: "F3 Q2 recorded but transcription FAILED",
    clips: [clip(0), clip(1, { status: "failed" }), clip(2), clip(3)],
    transcripts: [
      tr(0, T_STRONG_Q1, EV_FLUENT),
      // recording exists, transcript never produced
      tr(2, T_MID_Q3, EV_HESITANT),
      tr(3, T_WEAK_Q4, EV_CHOPPY),
    ],
    expect: 'scoringStatus "error", NO layerA/layerB written, model never called',
  },
  {
    id: "F4",
    submissionId: "SUB-INT-TEST-004",
    attemptId: "ATT-INT-TEST-004",
    label: "F4 Q4 delivery evidence absent",
    clips: [clip(0), clip(1), clip(2), clip(3)],
    transcripts: [
      tr(0, T_STRONG_Q1, EV_FLUENT),
      tr(1, T_STRONG_Q2, EV_FLUENT),
      tr(2, T_MID_Q3, EV_HESITANT),
      tr(3, T_WEAK_Q4, null), // present, transcript fine, evidence missing
    ],
    expect:
      "Q4 scored from transcript alone + INCOMPLETE_DATA on Q4 only; Q1-Q3 unflagged",
  },
  {
    id: "F5",
    submissionId: "SUB-INT-TEST-005",
    attemptId: "ATT-INT-TEST-005",
    label: "F5 all four have NO recording",
    clips: [0, 1, 2, 3].map((i) => clip(i, { recorded: false })),
    transcripts: [],
    expect: "four band-0s, all band0Gate \"no response\", all items empty",
  },
];

async function main() {
  await db.collection("toeflItems").doc(ITEM.itemId).set(ITEM);
  console.log(`wrote toeflItems/${ITEM.itemId}`);

  for (const c of CASES) {
    await db.collection("toeflAttempts").doc(c.attemptId).set({
      attemptId: c.attemptId,
      itemId: ITEM.itemId,
      taskType: "INT",
      uid: "FIXTURE_UID_NOT_A_REAL_STUDENT",
      interviewClips: c.clips,
      startedAt: FV.serverTimestamp(),
      completedAt: FV.serverTimestamp(),
    });
    console.log(`wrote toeflAttempts/${c.attemptId}`);
  }

  // Submissions last, one at a time: each create is what fires
  // onToeflSubmissionCreated.
  for (const c of CASES) {
    await db.collection("toeflSubmissions").doc(c.submissionId).set({
      submissionId: c.submissionId,
      attemptId: c.attemptId,
      taskType: "INT",
      uid: "FIXTURE_UID_NOT_A_REAL_STUDENT",
      responseContent: { transcripts: c.transcripts, audioClips: c.clips },
      scoringStatus: "queued",
      submittedAt: FV.serverTimestamp(),
    });
    console.log(`wrote toeflSubmissions/${c.submissionId}  — ${c.label}`);
  }

  console.log(
    `\nFixture seeded (emulator ${process.env.FIRESTORE_EMULATOR_HOST}).\n` +
      CASES.map((c) => `  ${c.label}\n      expect: ${c.expect}`).join("\n") +
      `\n\nThe trigger is now calling the Anthropic API — 4 calls, not 5:\n` +
      `F3 must make none, and that is the assertion.\n` +
      `Read the results back with scripts/readToeflIntResults.js\n`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nSEED FAILED:", err);
    process.exit(1);
  });
