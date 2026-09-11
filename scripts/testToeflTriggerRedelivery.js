#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// TEST B — real-trigger redelivery check for the idempotency guard in
// functions/toeflScoring.js (onToeflSubmissionCreated).
//
// THE DELIVERABLE IS THE CALL COUNT. Test A proved the claim transaction's
// semantics against a duplicated copy of the claim body. This one invokes the
// actual exported trigger twice, concurrently, on one submission, and asserts
// the Anthropic client was constructed and called EXACTLY ONCE. That is the
// assertion that maps to the real cost: a redelivered EM submission must not
// buy a second paid model call.
//
// WHY THE EMULATOR CANNOT DO THIS BY ITSELF
// The Firestore emulator's trigger system is fire-once. It delivers each write
// event a single time, has no redeliver command, and does not honour the v2
// retry/failure policy (that is production-only). So the redelivery has to be
// staged by invoking the handler directly, which is what firebase-functions-test
// is for. Run with --only firestore: if the functions emulator is up, the seed
// write fires the real trigger too and that automatic delivery would score the
// document before either staged delivery ran.
//
// THE STUB
// Deliberately minimal — @anthropic-ai/sdk is replaced in the require cache
// before toeflScoring.js is loaded, with just enough surface for scoreEmail's
// one call site: new Anthropic({apiKey}) → .messages.create() → one text block
// of valid Layer A/B JSON. It counts its calls and holds the first one open on
// a barrier so delivery 1 is provably still mid-flight (claimed, not yet
// "scored") when delivery 2 attempts its claim. Without that barrier the two
// deliveries can serialise by luck and the test passes while proving nothing.
// No network, no API key, no cost.
//
// CAVEAT, STATED PLAINLY: the emulator implements transaction contention for
// real, so a pass is good evidence the guard is correct. It is not proof that
// production Firestore's timing is identical.
//
// SAFETY: refuses to run unless FIRESTORE_EMULATOR_HOST is set. Per CLAUDE.md
// the live project carries an active B10-PP student population whose
// non-interruption is a permanent constraint.
//
// Usage:
//   firebase emulators:start --only firestore
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/testToeflTriggerRedelivery.js
// ─────────────────────────────────────────────────────────────────────────────

const path = require("path");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    "\nREFUSING TO RUN: FIRESTORE_EMULATOR_HOST is not set.\n\n" +
      "Start the emulator and re-run:\n\n" +
      "  firebase emulators:start --only firestore\n" +
      "  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/testToeflTriggerRedelivery.js\n"
  );
  process.exit(1);
}

const PROJECT_ID = process.env.GCLOUD_PROJECT || "b10-practice-platform";
process.env.GCLOUD_PROJECT = PROJECT_ID;
// The trigger declares ANTHROPIC_API_KEY as a secret; .value() reads it from
// the environment when invoked directly. The stub never looks at it.
process.env.ANTHROPIC_API_KEY = "STUB_KEY_NOT_A_REAL_CREDENTIAL";

const LAYER_B_LABEL = "practice focus — project diagnostic, not part of the score";

// ── Stub, installed before toeflScoring.js is required ───────────────────────

const calls = { constructed: 0, created: 0 };
let releaseFirstCall;
const firstCallBarrier = new Promise((resolve) => {
  releaseFirstCall = resolve;
});
let firstCallInFlight;
const firstCallStarted = new Promise((resolve) => {
  firstCallInFlight = resolve;
});

function StubAnthropic() {
  calls.constructed += 1;
  this.messages = {
    create: async () => {
      calls.created += 1;
      if (calls.created === 1) {
        firstCallInFlight();
        await firstCallBarrier; // hold delivery 1 mid-flight
      }
      return {
        content: [
          {
            text: JSON.stringify({
              layerA: {
                score: 4,
                band0Gate: false,
                rationale: "STUB rationale — not a real judgment.",
              },
              layerB: { items: [], flags: [], label: LAYER_B_LABEL },
            }),
          },
        ],
      };
    },
  };
}

const sdkPath = require.resolve("@anthropic-ai/sdk", {
  paths: [path.join(__dirname, "..", "functions")],
});
require.cache[sdkPath] = {
  id: sdkPath,
  filename: sdkPath,
  loaded: true,
  exports: StubAnthropic,
};

// ── Now load the real trigger, on top of the stub ────────────────────────────

const admin = require(require.resolve("firebase-admin", {
  paths: [path.join(__dirname, "..", "functions")],
}));
const { FieldValue } = require(require.resolve("firebase-admin/firestore", {
  paths: [path.join(__dirname, "..", "functions")],
}));

const fft = require(require.resolve("firebase-functions-test", {
  paths: [path.join(__dirname, "..", "functions")],
}))({ projectId: PROJECT_ID });

const toeflScoring = require(path.join(__dirname, "..", "functions", "toeflScoring.js"));

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const ITEM_ID = "EM-REDELIVERY-TEST-001";
const ATTEMPT_ID = "ATT-REDELIVERY-TEST-001";
const SUB_ID = "SUB-REDELIVERY-TEST-001";
const submissionRef = db.collection("toeflSubmissions").doc(SUB_ID);

const SUBMISSION = {
  submissionId: SUB_ID,
  attemptId: ATTEMPT_ID,
  taskType: "EM",
  studentId: "TEST-STUDENT-01",
  responseContent: { text: "Dear Ms. Danforth, the wheel arrived bent.", wordCount: 8 },
  scoringStatus: "queued",
};

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

async function seed() {
  await db.collection("toeflItems").doc(ITEM_ID).set({
    itemId: ITEM_ID,
    taskType: "EM",
    status: "active",
    stimulus: { scenarioText: "STUB scenario — throwaway test data.", recipientContext: null },
    prompt: {
      relationshipType: "Reader/contributor to institution",
      requiredElements: ["STUB element one.", "STUB element two.", "STUB element three."],
      header: { to: "Ms. Danforth", subject: "STUB subject" },
    },
    contentSpecVersion: "FIXTURE_NOT_A_REAL_SPEC_VERSION",
  });

  await db.collection("toeflAttempts").doc(ATTEMPT_ID).set({
    attemptId: ATTEMPT_ID,
    itemId: ITEM_ID,
    taskType: "EM",
    studentId: "TEST-STUDENT-01",
  });

  await submissionRef.set({ ...SUBMISSION, submittedAt: FieldValue.serverTimestamp() });
}

async function cleanup() {
  await Promise.all([
    db.collection("toeflItems").doc(ITEM_ID).delete(),
    db.collection("toeflAttempts").doc(ATTEMPT_ID).delete(),
    submissionRef.delete(),
  ]);
}

async function main() {
  console.log(
    `TEST B — real trigger, staged redelivery (emulator ${process.env.FIRESTORE_EMULATOR_HOST})`
  );

  await seed();

  const wrapped = fft.wrap(toeflScoring.onToeflSubmissionCreated);
  const snap = fft.firestore.makeDocumentSnapshot(
    SUBMISSION,
    `toeflSubmissions/${SUB_ID}`
  );
  const event = { data: snap, params: { submissionId: SUB_ID } };

  console.log("\nCase 1 — two concurrent deliveries of the same create event");

  // Delivery 1 starts and is held inside the model call. Delivery 2 is only
  // launched once that is true, so it is guaranteed to meet a document that is
  // claimed ("scoring") but not yet "scored" — the exact mid-flight window.
  const delivery1 = wrapped(event);
  await firstCallStarted;

  const midFlight = (await submissionRef.get()).data();
  check(
    'delivery 1 claimed the document ("scoring")',
    midFlight.scoringStatus === "scoring",
    midFlight.scoringStatus
  );
  check(
    "scoringStartedAt stamped by the claim",
    midFlight.scoringStartedAt !== undefined,
    String(midFlight.scoringStartedAt)
  );

  const delivery2 = wrapped(event);
  await delivery2; // returns without scoring: the claim declines

  check(
    "delivery 2 made no additional model call while delivery 1 was mid-flight",
    calls.created === 1,
    `messages.create called ${calls.created}x`
  );

  releaseFirstCall();
  await delivery1;

  const scored = (await submissionRef.get()).data();
  check('delivery 1 completed to "scored"', scored.scoringStatus === "scored", scored.scoringStatus);
  check("score written", scored.layerA?.score === 4, JSON.stringify(scored.layerA));

  console.log("\nCase 2 — a third delivery after scoring completed");
  await wrapped(event);
  check(
    "no model call on a delivery arriving after completion",
    calls.created === 1,
    `messages.create called ${calls.created}x`
  );

  console.log("\nDELIVERABLE — model call count across three deliveries");
  check(
    "Anthropic client constructed exactly once",
    calls.constructed === 1,
    `constructed ${calls.constructed}x`
  );
  check(
    "messages.create called exactly once",
    calls.created === 1,
    `called ${calls.created}x`
  );

  await cleanup();
  fft.cleanup();

  console.log(
    failures === 0
      ? "\nTEST B PASSED — three deliveries of one submission, exactly one paid model call.\n"
      : `\nTEST B FAILED — ${failures} check(s) failed.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nTEST B ERRORED:", err);
  process.exit(1);
});
