#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// THROWAWAY TEST FIXTURE — NOT REAL CORPUS CONTENT, NOT IMPORT-SCRIPT OUTPUT
//
// This script hand-writes one fake AP item so the MCQ renderer and the scoring
// trigger can be exercised end-to-end before the real import script exists
// (blocked on the corpus re-push as of Sep 8, 2026).
//
// Nothing here came from the TOEFL corpus. The passage, the questions, the
// rationales and the answer key were all written by hand as test data. Do NOT
// treat this document as an example of importer output, and do NOT copy its
// shape as a reference for the real importer — TOEFL_Import_Script_Spec_v1_8.md
// governs that, not this file.
//
// Deliberately off-spec in one respect: a real AP item is 5 questions per
// passage (AP_Content_Spec.md §6.1). This fixture has 2, because it only needs
// to cover one shuffled question and one locked one.
//
// Schema source: TOEFL_Firestore_Data_Model_Spec_v1_14.md
//   · Collection 1 (toeflItems), incl. the answerKey subcollection
//   · "Answer-key and permutation" (optionId, locked, Fisher–Yates)
//
// SAFETY: refuses to run unless FIRESTORE_EMULATOR_HOST is set. This writes
// test garbage, and the live project carries an active B10-PP student
// population — per CLAUDE.md that population's non-interruption is a permanent
// constraint, so this script has no path to production at all.
//
// Usage:
//   firebase emulators:start --only firestore,functions
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seedToeflFixture.js
// ─────────────────────────────────────────────────────────────────────────────

const admin = require("firebase-admin");

const PROJECT_ID = process.env.GCLOUD_PROJECT || "b10-practice-platform";
const ITEM_ID = "AP-TEST-001";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    "\nREFUSING TO RUN: FIRESTORE_EMULATOR_HOST is not set.\n\n" +
      "This script writes throwaway test data. Without that variable the Admin\n" +
      "SDK would connect to the live project, which has active B10-PP students\n" +
      "on it. Start the emulator and re-run:\n\n" +
      "  firebase emulators:start --only firestore,functions\n" +
      "  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seedToeflFixture.js\n"
  );
  process.exit(1);
}

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

// ── The public item document — display content only ──────────────────────────
// Per Decision 1 (data model v1.7+): nothing on this document reveals which
// option is correct. No correctOptionId, no rationales. Those live in the
// answerKey subcollection below, which students cannot read.
const item = {
  itemId: ITEM_ID,
  taskType: "AP",
  weekAvailability: "ALL_WEEKS", // AP, per ISD §8.1
  status: "active",

  // Appendix A: AP stimulus is {passageText, wordCount}
  stimulus: {
    passageText:
      "Desert varnish is a thin, dark coating found on exposed rock surfaces " +
      "in arid regions. [A] For decades, geologists assumed it formed from " +
      "minerals leaching out of the rock itself. [B] Chemical analysis has " +
      "since undermined that view: the manganese and iron that give the " +
      "varnish its color occur in concentrations far higher than the " +
      "underlying rock could supply. [C] The prevailing explanation now " +
      "credits airborne dust, which settles on the rock and is slowly " +
      "cemented in place by colonies of microorganisms. [D] Supporting this " +
      "account, varnish accumulates at roughly one micrometer per thousand " +
      "years — a rate consistent with atmospheric deposition rather than " +
      "with any process internal to the rock.",
    wordCount: 112,
  },

  audioPath: null, // text-only type

  questions: [
    {
      questionIndex: 0,
      stem:
        "According to the passage, what is the main evidence against the " +
        "older theory of how desert varnish forms?",
      // SHUFFLE PATH — options have no semantic order, so Fisher–Yates applies.
      locked: false,
      options: [
        {
          optionId: "opt_a",
          text: "Desert varnish accumulates at a rate of one micrometer per thousand years.",
        },
        {
          optionId: "opt_b",
          text: "Desert varnish is found only in arid regions.",
        },
        {
          optionId: "opt_c",
          text: "The varnish contains more manganese and iron than the rock beneath it could provide.",
        },
        {
          optionId: "opt_d",
          text: "Microorganisms have been observed cementing dust to rock surfaces.",
        },
      ],
    },
    {
      questionIndex: 1,
      stem:
        "Look at the four positions marked [A], [B], [C], and [D] in the " +
        "passage. Where would the following sentence best fit?\n\n" +
        '"That assumption seemed reasonable, since the coating and the rock ' +
        'share several elements."',
      // NO-SHUFFLE PATH — R6 sentence insertion. The options name passage
      // positions in reading order, so shuffling them produces nonsense
      // (option C reading "Position [A]"). This is the exact case the
      // `locked` flag exists for, per data model "Answer-key and permutation".
      locked: true,
      options: [
        { optionId: "opt_a", text: "Position [A]" },
        { optionId: "opt_b", text: "Position [B]" },
        { optionId: "opt_c", text: "Position [C]" },
        { optionId: "opt_d", text: "Position [D]" },
      ],
    },
  ],

  // Loud non-value: makes the fixture identifiable as fake even if someone
  // finds the document without this script.
  contentSpecVersion: "FIXTURE_NOT_A_REAL_SPEC_VERSION",
  layer3Status: "pending",
  importedAt: admin.firestore.FieldValue.serverTimestamp(),
};

// ── The private answer key ───────────────────────────────────────────────────
// toeflItems/{itemId}/answerKey/{key} — read by the scoring Cloud Function via
// the Admin SDK only. Students have no read access under any rule.
//
// Note the two correct answers are opt_c and opt_b — neither is opt_a, and they
// differ between questions, so a renderer that keys off source order or always
// picks the first option fails loudly instead of coincidentally passing.
const answerKey = {
  questions: [
    {
      questionIndex: 0,
      correctOptionId: "opt_c",
      rationales: [
        {
          optionId: "opt_a",
          rationale:
            "INCORRECT — the accumulation rate supports the dust hypothesis, but it isn't what refuted the leaching account.",
        },
        {
          optionId: "opt_b",
          rationale:
            "INCORRECT — this is background from the first sentence, not evidence bearing on either theory.",
        },
        {
          optionId: "opt_c",
          rationale:
            "CORRECT — the passage states the concentrations are 'far higher than the underlying rock could supply,' which is what undermined the leaching view.",
        },
        {
          optionId: "opt_d",
          rationale:
            "INCORRECT — microbial cementing is part of the replacement explanation, not the evidence that displaced the old one.",
        },
      ],
    },
    {
      questionIndex: 1,
      correctOptionId: "opt_b",
      rationales: [
        {
          optionId: "opt_a",
          rationale:
            "INCORRECT — [A] comes before the older theory is stated, so 'that assumption' would have no antecedent.",
        },
        {
          optionId: "opt_b",
          rationale:
            "CORRECT — the sentence elaborates on the leaching assumption just stated, and its concessive tone sets up the contrast that follows.",
        },
        {
          optionId: "opt_c",
          rationale:
            "INCORRECT — by [C] the passage has already rejected the older view; calling it reasonable here reverses the argument.",
        },
        {
          optionId: "opt_d",
          rationale:
            "INCORRECT — [D] falls inside the discussion of the dust-and-microbe explanation, a different theory.",
        },
      ],
    },
  ],
};

async function main() {
  const itemRef = db.collection("toeflItems").doc(ITEM_ID);

  await itemRef.set(item);
  console.log(`wrote toeflItems/${ITEM_ID}`);

  await itemRef.collection("answerKey").doc("key").set(answerKey);
  console.log(`wrote toeflItems/${ITEM_ID}/answerKey/key`);

  console.log(
    `\nFixture seeded (emulator ${process.env.FIRESTORE_EMULATOR_HOST}).\n` +
      `  Q0 locked=false → shuffle path,    correct = opt_c\n` +
      `  Q1 locked=true  → no-shuffle path, correct = opt_b\n`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("seed failed:", err);
    process.exit(1);
  });
