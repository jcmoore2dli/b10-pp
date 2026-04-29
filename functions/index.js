"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// B10-PP · functions/index.js
// Pipeline v1.4 · Sprint Architecture v3
//
// ARCHITECTURAL INVARIANTS (do not modify without Director approval):
//   1. Raw Deepgram transcript is NEVER modified before reaching scoring engine.
//   2. EVALUATION_POLICY is injected on every Claude call (handled in claudeScorer).
//   3. submissionNumber is assigned server-side via Firestore transaction.
//   4. AssemblyAI Pass 2 is conditional only — never default.
//   5. Temperature = 0 on all Claude calls (enforced in claudeScorer).
//   6. Admin SDK bypasses Firestore security rules — all pipeline writes use admin SDK.
// ─────────────────────────────────────────────────────────────────────────────

const { setGlobalOptions }      = require("firebase-functions");
const { onDocumentCreated }     = require("firebase-functions/v2/firestore");
const { onCall, HttpsError }    = require("firebase-functions/v2/https");
const { defineSecret }          = require("firebase-functions/params");
const logger                    = require("firebase-functions/logger");
const admin                     = require("firebase-admin");
const { transcribeAudio }       = require("./lib/deepgramSTT");
const { scoreTranscript, computeDisfluencyMetadata } = require("./lib/claudeScorer");

// ── Secrets ───────────────────────────────────────────────────────────────────
const DEEPGRAM_API_KEY   = defineSecret("DEEPGRAM_API_KEY");
const ASSEMBLYAI_API_KEY = defineSecret("ASSEMBLYAI_API_KEY");
const ANTHROPIC_API_KEY  = defineSecret("ANTHROPIC_API_KEY");

// ── Global options ────────────────────────────────────────────────────────────
setGlobalOptions({ maxInstances: 10 });

// ── Firebase Admin ────────────────────────────────────────────────────────────
admin.initializeApp();
const db      = admin.firestore();
const storage = admin.storage();

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY: withRetry
// Wraps an async fn with exponential backoff.
// Delays: 2s → 4s → 8s (3 attempts total).
// Retries are invisible to the student record — no side effects between attempts.
// ─────────────────────────────────────────────────────────────────────────────
async function withRetry(fn, label, maxAttempts = 3) {
  const delays = [2000, 4000, 8000];
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      logger.warn(`${label}: attempt ${attempt} failed — ${err.message}`);
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, delays[attempt - 1]));
      }
    }
  }
  throw new Error(`${label}: all ${maxAttempts} attempts failed. Last: ${lastError.message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE: processSubmission(submissionId)
//
// Shared function called by:
//   - onDocumentCreated trigger (new submission)
//   - requeueSubmission callable (admin requeue)
//
// 14-step pipeline per Sprint Architecture v3:
//   Step 1:  Counter transaction → assign submissionNumber
//   Step 2:  Set status "processing"
//   Step 3:  Retrieve audio from Firebase Storage
//   Step 4:  Deepgram STT → raw transcript + words[]
//   Step 5:  Speaker diarization → student speaker isolated (handled in deepgramSTT)
//   Step 6:  Disfluency pre-processor (LEVEL2 tasks only)
//   Step 7:  EVALUATION_POLICY injection (handled in claudeScorer)
//   Step 8:  Route to correct scoring prompt by taskType (handled in claudeScorer)
//   Step 9:  Claude scoring → parse JSON response
//   Step 10: Validate score field (handled in claudeScorer — throws on bad score)
//   Step 11: Set pass2Available flag if transcript_note non-empty AND score !== 1
//   Step 12: Write all result fields to submission doc
//   Step 13: Set status "complete" + write processedAt
//   Step 14: On unrecoverable error → set status "failed"
// ─────────────────────────────────────────────────────────────────────────────
async function processSubmission(submissionId) {
  const submissionRef = db.collection("submissions").doc(submissionId);

  const snap = await submissionRef.get();
  if (!snap.exists) {
    logger.error("processSubmission: submission doc not found", { submissionId });
    return;
  }
  const data = snap.data();

  const {
    b10Id,
    assignmentId,
    audioPath,
    taskType,
    taskFamily: existingTaskFamily,
    promptDescription,
    scaffoldConfig,
  } = data;

  logger.info("processSubmission: started", { submissionId, b10Id, taskType });

  // ── Step 1: Counter transaction → assign submissionNumber ─────────────────
  const counterDocId  = `${b10Id}_${assignmentId}`;
  const counterRef    = db.collection("submissionCounters").doc(counterDocId);

  let submissionNumber;
  try {
    submissionNumber = await db.runTransaction(async (tx) => {
      const counterSnap = await tx.get(counterRef);
      const currentCount = counterSnap.exists ? (counterSnap.data().count || 0) : 0;
      const newCount = currentCount + 1;
      tx.set(counterRef, { count: newCount }, { merge: true });
      tx.update(submissionRef, { submissionNumber: newCount });
      return newCount;
    });
    logger.info("processSubmission: submissionNumber assigned", {
      submissionId,
      submissionNumber,
    });
  } catch (err) {
    logger.error("processSubmission: counter transaction failed", {
      submissionId,
      error: err.message,
    });
    await submissionRef.update({
      status: "failed",
      errorMessage: `Counter transaction failed: ${err.message}`,
      errorAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return;
  }

  // ── Step 2: Set status "processing" ──────────────────────────────────────
  await submissionRef.update({
    status: "processing",
    processingStartedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  try {
    // ── Step 3: Retrieve audio from Firebase Storage ───────────────────────
    logger.info("processSubmission: fetching audio", { submissionId, audioPath });
    const bucket = storage.bucket();
    const file   = bucket.file(audioPath);
    const [audioBuffer] = await file.download();
    const mimeType = audioPath.endsWith(".mp4") ? "audio/mp4"
                   : audioPath.endsWith(".wav") ? "audio/wav"
                   : "audio/webm";

    // ── Step 4 + 5: Deepgram STT ──────────────────────────────────────────
    logger.info("processSubmission: calling Deepgram", { submissionId });
    const { transcript, words } = await withRetry(
      () => transcribeAudio(DEEPGRAM_API_KEY.value(), audioBuffer, mimeType),
      "Deepgram"
    );
    logger.info("processSubmission: transcript received", {
      submissionId,
      transcriptLength: transcript.length,
      wordCount: words.length,
    });

    // ── Step 6: Disfluency pre-processor (LEVEL2 tasks only) ─────────────
    const type       = (taskType || "").toUpperCase();
    const taskFamily = ["ESO", "PARAPHRASE"].includes(type) ? "LEVEL3" : "LEVEL2";
    const isLevel2   = taskFamily === "LEVEL2";

    let disfluencyMetadata = null;
    if (isLevel2) {
      disfluencyMetadata = computeDisfluencyMetadata(words);
      logger.info("processSubmission: disfluency metadata computed", {
        submissionId,
        ...disfluencyMetadata,
      });
    }

    // ── Step 6b: Retrieve passageText for PARAPHRASE tasks ────────────────
    // passageId is a direct field on the submission doc (confirmed April 23).
    // TODO: verify passageText field name against passage doc schema before pilot.
    let passageText = "";
    if (type === "PARAPHRASE") {
      if (!data.passageId) {
        throw new Error("processSubmission: PARAPHRASE task missing passageId on submission doc.");
      }
      const passageSnap = await db.collection("passages").doc(data.passageId).get();
      if (!passageSnap.exists) {
        throw new Error(`processSubmission: passage doc not found for passageId ${data.passageId}.`);
      }
      // Field name fallback: try passageText first, then transcript
      passageText = passageSnap.data().passageText || passageSnap.data().transcript || "";
      if (!passageText) {
        throw new Error(`processSubmission: passageText empty for passageId ${data.passageId}.`);
      }
      logger.info("processSubmission: passageText retrieved", {
        submissionId,
        passageId: data.passageId,
        passageTextLength: passageText.length,
      });
    }
    // ── Step 7 + 8: Build scorer params ───────────────────────────────────
    const scorerParams = {
      transcript,
      words,
      promptDescription: promptDescription || "",
      passageText,
    };

    if (type === "ESO") {
      scorerParams.focusMode       = scaffoldConfig?.focusArea      || "Holistic";
      scorerParams.primaryTarget   = scaffoldConfig?.primaryFrame   || "none";
      scorerParams.secondaryTarget = scaffoldConfig?.secondaryFrame || "none";
    }

    if (["NARRATION", "DESCRIPTION", "INSTRUCTIONS"].includes(type)) {
      scorerParams.primaryFocus   = scaffoldConfig?.focusArea      || "Holistic";
      scorerParams.activeMonitors = scaffoldConfig?.activeMonitors || "none";
    }

    // ── Step 9 + 10: Claude scoring ───────────────────────────────────────
    logger.info("processSubmission: calling Claude scorer", {
      submissionId,
      taskType,
      taskFamily,
    });
    const scoreResult = await withRetry(
      () => scoreTranscript(ANTHROPIC_API_KEY.value(), taskType, scorerParams),
      "Claude"
    );
    logger.info("processSubmission: score received", {
      submissionId,
      score: scoreResult.score,
      score_label: scoreResult.score_label,
      taskFamily,
    });

    // ── Step 11: pass2Available flag ──────────────────────────────────────
    const transcriptNote = scoreResult.transcript_note || "";
    const pass2Available = scoreResult.score !== 1 && transcriptNote !== "";

    // ── Step 12 + 13: Write result fields ────────────────────────────────
    const resultFields = {
      status:            "complete",
      processedAt:       admin.firestore.FieldValue.serverTimestamp(),
      taskFamily,
      transcriptText:    transcript,
      score:             scoreResult.score,
      score_label:       scoreResult.score_label,
      strengths:         scoreResult.strengths         || "",
      gaps:              scoreResult.gaps              || "",
      language_feedback: scoreResult.language_feedback || "",
      transcript_note:   transcriptNote,
      pass2Available,
    };

    if (isLevel2) {
      resultFields.monitor_notes      = scoreResult.monitor_notes || "";
      resultFields.disfluencyMetadata = disfluencyMetadata;
    }

    if (type === "ESO") {
      resultFields.scaffold_feedback = scoreResult.scaffold_feedback || "";
    }

    await submissionRef.update(resultFields);

    logger.info("processSubmission: complete", {
      submissionId,
      submissionNumber,
      score: scoreResult.score,
      score_label: scoreResult.score_label,
      pass2Available,
    });

  } catch (err) {
    // ── Step 14: Unrecoverable error ──────────────────────────────────────
    logger.error("processSubmission: pipeline error", {
      submissionId,
      error: err.message,
    });
    await submissionRef.update({
      status:       "failed",
      errorMessage: err.message,
      errorAt:      admin.firestore.FieldValue.serverTimestamp(),
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER: onDocumentCreated → /submissions/{submissionId}
// ─────────────────────────────────────────────────────────────────────────────
exports.onSubmissionCreated = onDocumentCreated(
  {
    document: "submissions/{submissionId}",
    secrets:  [DEEPGRAM_API_KEY, ANTHROPIC_API_KEY],
  },
  async (event) => {
    const submissionId = event.params.submissionId;
    const data = event.data?.data();

    if (!data) {
      logger.error("onSubmissionCreated: no data on event", { submissionId });
      return;
    }

    logger.info("onSubmissionCreated: trigger fired", { submissionId });
    await processSubmission(submissionId);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: requeueSubmission
// Admin-only. Clears score fields, resets to queued, reruns pipeline.
// ─────────────────────────────────────────────────────────────────────────────
exports.requeueSubmission = onCall(
  {
    secrets: [DEEPGRAM_API_KEY, ANTHROPIC_API_KEY],
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Must be signed in.");

    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists || userSnap.data()?.role !== "admin") {
      throw new HttpsError("permission-denied", "Admin role required.");
    }

    const { submissionId } = request.data;
    if (!submissionId || typeof submissionId !== "string") {
      throw new HttpsError("invalid-argument", "submissionId required.");
    }

    const submissionRef = db.collection("submissions").doc(submissionId);
    const snap = await submissionRef.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", `Submission ${submissionId} not found.`);
    }

    logger.info("requeueSubmission: requeuing", { submissionId, uid });

    await submissionRef.update({
      status:             "queued",
      submissionNumber:   0,
      score:              admin.firestore.FieldValue.delete(),
      score_label:        admin.firestore.FieldValue.delete(),
      strengths:          admin.firestore.FieldValue.delete(),
      gaps:               admin.firestore.FieldValue.delete(),
      language_feedback:  admin.firestore.FieldValue.delete(),
      transcript_note:    admin.firestore.FieldValue.delete(),
      transcriptText:     admin.firestore.FieldValue.delete(),
      transcriptClean:    admin.firestore.FieldValue.delete(),
      disfluencyMetadata: admin.firestore.FieldValue.delete(),
      monitor_notes:      admin.firestore.FieldValue.delete(),
      scaffold_feedback:  admin.firestore.FieldValue.delete(),
      pass2Available:     false,
      pass2Status:        admin.firestore.FieldValue.delete(),
      pass2CompletedAt:   admin.firestore.FieldValue.delete(),
      pass2Error:         admin.firestore.FieldValue.delete(),
      errorMessage:       admin.firestore.FieldValue.delete(),
      errorAt:            admin.firestore.FieldValue.delete(),
      processedAt:        admin.firestore.FieldValue.delete(),
      requeuedAt:         admin.firestore.FieldValue.serverTimestamp(),
      requeuedBy:         uid,
    });

    await processSubmission(submissionId);

    logger.info("requeueSubmission: complete", { submissionId });
    return { success: true, submissionId };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// PASS 2: runPass2(submissionId)
//
// Shared function called by requestPass2 callable.
// Produces a clean AssemblyAI transcript for instructor review ONLY.
// Output written to transcriptClean field.
//
// ARCHITECTURAL INVARIANTS (enforced here):
//   - transcriptClean NEVER reaches the scoring engine. Ever.
//   - Pass 2 NEVER runs on Score 1 submissions.
//   - transcriptText (raw Deepgram) is never modified or replaced.
// ─────────────────────────────────────────────────────────────────────────────
async function runPass2(submissionId) {
  const submissionRef = db.collection("submissions").doc(submissionId);
  const snap = await submissionRef.get();

  if (!snap.exists) {
    throw new Error(`runPass2: submission ${submissionId} not found.`);
  }

  const data = snap.data();

  // ── Score 1 gate — hard block ─────────────────────────────────────────────
  if (data.score === 1) {
    throw new Error("runPass2: Score 1 submissions are ineligible for Pass 2.");
  }

  const { audioPath } = data;
  if (!audioPath) {
    throw new Error(`runPass2: no audioPath on submission ${submissionId}.`);
  }

  logger.info("runPass2: started", { submissionId, audioPath });

  await submissionRef.update({
    pass2Status:    "processing",
    pass2StartedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  try {
    // ── Fetch audio ───────────────────────────────────────────────────────
    const bucket = storage.bucket();
    const [audioBuffer] = await bucket.file(audioPath).download();

    // ── AssemblyAI — clean transcript ─────────────────────────────────────
    // Smart formatting ON, disfluencies OFF — human-readable output only.
    // INVARIANT: result written ONLY to transcriptClean. Never to scoring engine.
    const { AssemblyAI } = require("assemblyai");
    const aaiClient = new AssemblyAI({ apiKey: ASSEMBLYAI_API_KEY.value() });

    const transcriptClean = await withRetry(async () => {
      const uploadUrl = await aaiClient.files.upload(audioBuffer);
      const result    = await aaiClient.transcripts.transcribe({
        audio_url:      uploadUrl,
        speech_model:   "best",
        punctuate:      true,
        format_text:    true,    // smart formatting ON
        disfluencies:   false,   // filler words removed
        speaker_labels: true,
      });

      if (result.status === "error") {
        throw new Error(`AssemblyAI error: ${result.error}`);
      }

      // Isolate student speaker — dominant speaker by word count.
      const utterances = result.utterances || [];
      if (utterances.length === 0) {
        return result.text || "";
      }

      const speakerWordCounts = {};
      for (const u of utterances) {
        speakerWordCounts[u.speaker] = (speakerWordCounts[u.speaker] || 0) + u.words.length;
      }
      const studentSpeaker = Object.entries(speakerWordCounts)
        .sort((a, b) => b[1] - a[1])[0][0];

      return utterances
        .filter((u) => u.speaker === studentSpeaker)
        .map((u) => u.text)
        .join(" ");
    }, "AssemblyAI");

    // ── Write transcriptClean only ────────────────────────────────────────
    await submissionRef.update({
      transcriptClean,
      pass2Status:      "complete",
      pass2CompletedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info("runPass2: complete", {
      submissionId,
      transcriptCleanLength: transcriptClean.length,
    });

  } catch (err) {
    logger.error("runPass2: error", { submissionId, error: err.message });
    await submissionRef.update({
      pass2Status:  "failed",
      pass2Error:   err.message,
      pass2ErrorAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: requestPass2
//
// Instructor or admin only.
// Gates: role check + Score 1 block + status "complete" required.
// Calls runPass2() on validated submission.
// ─────────────────────────────────────────────────────────────────────────────
exports.requestPass2 = onCall(
  {
    secrets: [ASSEMBLYAI_API_KEY],
  },
  async (request) => {
    // ── Auth + role check ─────────────────────────────────────────────────
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Must be signed in.");

    const userSnap = await db.collection("users").doc(uid).get();
    const role = userSnap.exists ? userSnap.data()?.role : null;
    if (!["instructor", "admin"].includes(role)) {
      throw new HttpsError("permission-denied", "Instructor or admin role required.");
    }

    // ── Input validation ──────────────────────────────────────────────────
    const { submissionId } = request.data;
    if (!submissionId || typeof submissionId !== "string") {
      throw new HttpsError("invalid-argument", "submissionId required.");
    }

    // ── Eligibility gates ─────────────────────────────────────────────────
    const submissionRef = db.collection("submissions").doc(submissionId);
    const snap = await submissionRef.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", `Submission ${submissionId} not found.`);
    }

    const data = snap.data();

    if (data.score === 1) {
      throw new HttpsError(
        "failed-precondition",
        "Pass 2 is not available for Score 1 submissions."
      );
    }

    if (data.status !== "complete") {
      throw new HttpsError(
        "failed-precondition",
        `Submission status is "${data.status}". Pass 2 requires status "complete".`
      );
    }

    logger.info("requestPass2: request validated", { submissionId, uid, role });

    await runPass2(submissionId);

    return { success: true, submissionId };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: setStudentClaims
//
// Admin-only. Sets custom claims { b10Id, role, groupId } on a Firebase Auth user.
// Must be called server-side — client forces token refresh after this returns.
//
// INVARIANT: Only admin role may set claims. Never callable by students.
// ─────────────────────────────────────────────────────────────────────────────
exports.setStudentClaims = onCall(async (request) => {
  // ── Auth check ────────────────────────────────────────────────────────────
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "Must be signed in.");

  // ── Caller must be admin (checked via existing claims) ───────────────────
  const callerToken = request.auth?.token;
  if (callerToken?.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin role required.");
  }

  // ── Input validation ──────────────────────────────────────────────────────
  const { uid, b10Id, role, groupId } = request.data;
  if (!uid || !b10Id || !role || !groupId) {
    throw new HttpsError("invalid-argument", "uid, b10Id, role, and groupId are required.");
  }
  if (!["student", "instructor", "admin"].includes(role)) {
    throw new HttpsError("invalid-argument", `Invalid role: ${role}`);
  }

  // ── Set claims via Admin SDK ──────────────────────────────────────────────
  await admin.auth().setCustomUserClaims(uid, { b10Id, role, groupId });

  logger.info("setStudentClaims: claims set", { uid, b10Id, role, groupId, callerUid });

  return { success: true, uid, b10Id, role, groupId };
});
