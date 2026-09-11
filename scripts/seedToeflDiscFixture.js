#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// THROWAWAY TEST FIXTURE — NOT REAL CORPUS CONTENT, NOT IMPORTER OUTPUT
//
// Companion to seedToeflEmFixture.js. Hand-writes two fake DISC items and five
// submissions so the DISC Layer A/B branch of functions/toeflScoring.js can be
// exercised end-to-end against the real Anthropic API.
//
// Nothing here came from the TOEFL corpus. The professor prompt, both peer
// posts and every student response were written by hand as test data,
// deliberately NOT copied from DISC-001 or any other real item. Do NOT copy
// this file's shape as a reference for the real importer —
// TOEFL_Import_Script_Spec_v1_11.md and scripts/importToeflCorpus.js govern
// that, not this file.
//
// Schema sources:
//   · TOEFL_Firestore_Data_Model_Spec_v1_17.md — Collection 1/2/3, Appendix A
//     (DISC stimulus is {professorPrompt, peerResponses})
//   · TOEFL_Discussion_Scoring_Prompt_LayerAB_v1_1.md — input contract,
//     closed lists, and the acceptance test this fixture's S1/S2 mirror
//
// NO answerKey subcollection is written, and that is correct, not an omission:
// DISC has no fixed answer to hide (data model v1.17). A spurious answerKey on
// a DISC item would itself be a bug — the importer's both-writes check asserts
// its absence.
//
// The five submissions each exercise a different path:
//   S1  strong post, substantive peer engagement  → high band, no flags
//   S2  strong post, NO peer mention at all       → SAME high band as S1
//   S3  bare assertion, no support                → expect NO_CONTRIBUTION
//   S4  empty string                              → band 0 + empty Layer B
//   S5  item with peer posts stripped             → expect INCOMPLETE_DATA
//
// S2 is the acceptance test's own counterfactual (prompt doc line ~241), and
// it is the most important case here. The retired rule capped a post that
// never engaged a peer at band 3. Under v1.1 that cap is gone, so S2 should
// land at essentially S1's band. If S2 comes back materially lower than S1,
// the retired cap has leaked back in — that is a real failure, not a nuance.
//
// SAFETY: refuses to run unless FIRESTORE_EMULATOR_HOST is set. This writes
// test garbage, and the live project carries an active B10-PP student
// population whose non-interruption is a permanent operating constraint per
// CLAUDE.md, so this script has no path to production at all.
//
// Usage:
//   firebase emulators:start --only firestore,functions
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seedToeflDiscFixture.js
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
      "  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seedToeflDiscFixture.js\n"
  );
  process.exit(1);
}

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

// ── Item 1 — complete thread, both peers named ───────────────────────────────
// Named peers deliberately: it exercises the peerName field the importer was
// changed to capture today, and the input contract's "name if the item gives
// one, otherwise unnamed" branch.
const ITEM_FULL = {
  itemId: "DISC-TEST-001",
  taskType: "DISC",
  weekAvailability: "ALL_WEEKS",
  status: "active",

  stimulus: {
    professorPrompt:
      "Professor Lindqvist teaches a course on urban policy. Many cities are " +
      "now converting downtown traffic lanes into dedicated bus and bicycle " +
      "lanes. Supporters say this moves more people through the same space " +
      "and cuts emissions. Critics say it worsens congestion for the drivers " +
      "who remain and hurts businesses that depend on car access. Should " +
      "cities convert existing traffic lanes for buses and bicycles? Why or " +
      "why not?",
    peerResponses: [
      {
        label: "A",
        peerName: "Tomas",
        text:
          "I support converting the lanes. A single bus lane can carry far " +
          "more people per hour than a car lane, so the same street simply " +
          "does more work. My main worry is the businesses along those " +
          "streets, since a shop owner who loses parking out front feels that " +
          "loss immediately even if the street as a whole moves more people.",
      },
      {
        label: "B",
        peerName: "Reina",
        text:
          "I am against it, at least as it is usually done. Cities announce " +
          "the conversion and then take years to make the bus service " +
          "frequent enough to be worth choosing. In the meantime drivers sit " +
          "in worse traffic and get nothing back, which is exactly how you " +
          "turn people against transit for a decade.",
      },
    ],
  },

  prompt: { debateType: "Binary policy choice", peerResponseCount: 2 },

  // Loud non-value: makes the fixture identifiable as fake even if someone
  // finds the document without this script.
  contentSpecVersion: "FIXTURE_NOT_A_REAL_SPEC_VERSION",
  layer3Status: "pending",
  importedAt: admin.firestore.FieldValue.serverTimestamp(),
};

// ── Item 2 — same prompt, peer posts deliberately absent ─────────────────────
// The input contract's documented degrade case: score Layer A normally against
// the professor's question, raise INCOMPLETE_DATA, and explicitly do NOT lower
// the placement for the missing thread.
const ITEM_NO_PEERS = {
  ...ITEM_FULL,
  itemId: "DISC-TEST-002",
  stimulus: {
    professorPrompt: ITEM_FULL.stimulus.professorPrompt,
    peerResponses: [], // the whole point of this item
  },
};

// ── Student responses, all hand-written test data ────────────────────────────

// S1 — clear position, developed THROUGH a peer's specific objection, with a
// concrete mechanism. The acceptance test's model of substantive engagement.
const RESPONSE_STRONG_PEER = `Cities should convert the lanes, and Reina's objection is actually the strongest argument for doing it properly rather than for not doing it. She is right that announcing a conversion and then leaving the bus service thin for years is the worst of both worlds: drivers absorb the cost immediately and the benefit arrives too late to change anyone's habits. But that is a sequencing failure, not a reason to keep the lane. The fix is to raise service frequency on the corridor first, in the same budget cycle as the lane conversion, so the alternative is genuinely usable the week the lane changes. Tomas's worry about shopfront parking points the same direction. Where cities have replaced a handful of parking spaces with wider sidewalks and bike parking, the businesses that were most afraid usually saw more foot traffic, because a parking space serves a few cars a day while the sidewalk in front of it serves hundreds of people. The honest caveat is that this depends on the street already having enough passing traffic to convert into customers, which is not true everywhere.`;

// S2 — THE COUNTERFACTUAL. Same quality of position and development as S1,
// same concrete mechanism, but engages nobody. Under the retired rule this was
// capped at band 3; under v1.1 it should sit at essentially S1's band.
const RESPONSE_STRONG_NO_PEER = `Cities should convert the lanes, provided they do it in the right order. The case for conversion is a capacity argument: a lane of moving buses can carry several times the people that a lane of cars can, so reallocating the space lets the same street move more people without widening anything. The objection worth taking seriously is timing. If the lane changes before the bus service is frequent enough to be worth choosing, drivers absorb the cost right away and the benefit shows up years later, which is how a city turns its own residents against transit. So the conversion should be funded in the same budget cycle as a service increase on that corridor, not before it. The weaker objection is the one about shopfront access. A curbside parking space serves a handful of cars in a day, while the sidewalk beside it serves hundreds of people on foot, so trading a few spaces for width usually increases the number of potential customers passing a door rather than reducing it.`;

// S3 — a position asserted with no support and no engagement. NO_CONTRIBUTION
// is about substance, not about whether a name was mentioned.
const RESPONSE_BARE = `I think cities should convert the lanes. It is better for everyone and it is the right thing to do. Traffic is bad and this would help. I agree with what has been said above.`;

// S4 — empty. A0 owns the band-0 call; the branch deliberately does not
// short-circuit this, so it costs one model call.
const RESPONSE_EMPTY = ``;

const CASES = [
  {
    submissionId: "SUB-DISC-TEST-001",
    attemptId: "ATT-DISC-TEST-001",
    itemId: "DISC-TEST-001",
    label: "S1 strong post, substantive peer engagement",
    text: RESPONSE_STRONG_PEER,
    expect: "high band (acceptance test suggests 5), no flags, Layer B near-empty",
  },
  {
    submissionId: "SUB-DISC-TEST-002",
    attemptId: "ATT-DISC-TEST-002",
    itemId: "DISC-TEST-001",
    label: "S2 strong post, NO peer mention (retired-cap counterfactual)",
    text: RESPONSE_STRONG_NO_PEER,
    expect: "SAME band as S1 — materially lower means the retired cap leaked back",
  },
  {
    submissionId: "SUB-DISC-TEST-003",
    attemptId: "ATT-DISC-TEST-003",
    itemId: "DISC-TEST-001",
    label: "S3 bare assertion, no support",
    text: RESPONSE_BARE,
    expect: "low band + NO_CONTRIBUTION flag",
  },
  {
    submissionId: "SUB-DISC-TEST-004",
    attemptId: "ATT-DISC-TEST-004",
    itemId: "DISC-TEST-001",
    label: "S4 empty response",
    text: RESPONSE_EMPTY,
    expect: 'score 0, band0Gate "no response", layerB.items empty',
  },
  {
    submissionId: "SUB-DISC-TEST-005",
    attemptId: "ATT-DISC-TEST-005",
    itemId: "DISC-TEST-002",
    label: "S5 strong post, item has NO peer posts",
    text: RESPONSE_STRONG_NO_PEER,
    expect: "INCOMPLETE_DATA (trigger-authored), Layer A NOT lowered for it",
  },
];

function wordCount(t) {
  return String(t).split(/\s+/).filter(Boolean).length;
}

async function main() {
  for (const item of [ITEM_FULL, ITEM_NO_PEERS]) {
    await db.collection("toeflItems").doc(item.itemId).set(item);
    console.log(`wrote toeflItems/${item.itemId}`);
  }

  for (const c of CASES) {
    await db.collection("toeflAttempts").doc(c.attemptId).set({
      attemptId: c.attemptId,
      itemId: c.itemId,
      taskType: "DISC",
      studentId: "TEST-STUDENT-01",
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
      taskType: "DISC",
      studentId: "TEST-STUDENT-01",
      responseContent: { text: c.text, wordCount: wordCount(c.text) },
      scoringStatus: "queued",
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`wrote toeflSubmissions/${c.submissionId}  — ${c.label}`);
  }

  console.log(
    `\nFixture seeded (emulator ${process.env.FIRESTORE_EMULATOR_HOST}).\n` +
      CASES.map((c) => `  ${c.label}\n      expect: ${c.expect}`).join("\n") +
      `\n\nThe trigger is now calling the Anthropic API once per submission (5 calls).\n` +
      `Read the results back with scripts/readToeflDiscResults.js\n`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nSEED FAILED:", err);
    process.exit(1);
  });
