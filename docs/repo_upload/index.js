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

  // Read submission doc
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
  // Firestore transaction increments /submissionCounters/{b10Id}_{assignmentId}.count
  // and writes the resulting integer as submissionNumber on the submission doc.
  // This must complete before status moves to "processing".
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

    // ── Step 4 + 5: Deepgram STT — raw transcript, student speaker isolated ─
    // INVARIANT: transcript is NEVER modified after this call.
    // Speaker diarization and student isolation handled inside deepgramSTT.js.
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
    // ESO (LEVEL3): metadata block omitted per pipeline architecture.
    // LEVEL2: metadata computed here AND written to Firestore (Step 12).
    const type       = (taskType || "").toUpperCase();
    const taskFamily = type === "ESO" ? "LEVEL3" : "LEVEL2";
    const isLevel2   = taskFamily === "LEVEL2";

    let disfluencyMetadata = null;
    if (isLevel2) {
      disfluencyMetadata = computeDisfluencyMetadata(words);
      logger.info("processSubmission: disfluency metadata computed", {
        submissionId,
        ...disfluencyMetadata,
      });
    }

    // ── Step 7 + 8: Build scorer params, route by taskType ────────────────
    // EVALUATION_POLICY injection and prompt routing handled in claudeScorer.js.
    const scorerParams = {
      transcript,        // RAW — never smoothed. Invariant enforced.
      words,             // word-level timestamps — claudeScorer computes metadata
      promptDescription: promptDescription || "",
    };

    // ESO scaffold params
    if (type === "ESO") {
      scorerParams.focusMode       = scaffoldConfig?.focusArea      || "Holistic";
      scorerParams.primaryTarget   = scaffoldConfig?.primaryFrame   || "none";
      scorerParams.secondaryTarget = scaffoldConfig?.secondaryFrame || "none";
    }

    // LEVEL2 scaffold params
    if (["NARRATION", "DESCRIPTION", "INSTRUCTIONS"].includes(type)) {
      scorerParams.primaryFocus   = scaffoldConfig?.focusArea      || "Holistic";
      scorerParams.activeMonitors = scaffoldConfig?.activeMonitors || "none";
    }

    // ── Step 9 + 10: Claude scoring — JSON validated inside claudeScorer ──
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
    // true only when:
    //   - transcript_note is non-empty (STT validity concern flagged)
    //   - score is NOT 1 (Score 1 never triggers Pass 2 per architecture)
    const transcriptNote = scoreResult.transcript_note || "";
    const pass2Available = scoreResult.score !== 1 && transcriptNote !== "";

    // ── Step 12 + 13: Write all result fields + set status "complete" ─────
    // Field names aligned to Schema v3:
    //   transcriptText  (not rawTranscript)
    //   processedAt     (not completedAt)
    const resultFields = {
      status:              "complete",
      processedAt:         admin.firestore.FieldValue.serverTimestamp(),
      taskFamily,
      transcriptText:      transcript,       // raw — invariant preserved in write
      score:               scoreResult.score,
      score_label:         scoreResult.score_label,
      strengths:           scoreResult.strengths           || "",
      gaps:                scoreResult.gaps                || "",
      language_feedback:   scoreResult.language_feedback   || "",
      transcript_note:     transcriptNote,
      pass2Available,
    };

    // LEVEL2-only fields
    if (isLevel2) {
      resultFields.monitor_notes      = scoreResult.monitor_notes || "";
      resultFields.disfluencyMetadata = disfluencyMetadata;
    }

    // ESO-only field
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
    // ── Step 14: Unrecoverable error → set status "failed" ────────────────
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
//
// Thin wrapper. All pipeline logic lives in processSubmission().
// This separation allows requeueSubmission to call the same shared function.
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
//
// Admin-only. Clears score fields, resets status to "queued",
// then calls the shared processSubmission() function.
//
// Use case: manually stuck docs during pilot. Not for production automation.
// Manual console procedure is an acceptable fallback per sprint slip budget.
//
// Security: caller must have admin === true in their /users/{uid} doc.
// Admin SDK bypasses Firestore rules — role check is enforced here in code.
// ─────────────────────────────────────────────────────────────────────────────
exports.requeueSubmission = onCall(
  {
    secrets: [DEEPGRAM_API_KEY, ANTHROPIC_API_KEY],
  },
  async (request) => {
    // ── Role check ────────────────────────────────────────────────────────
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists || userSnap.data()?.role !== "admin") {
      throw new HttpsError("permission-denied", "Admin role required.");
    }

    // ── Validate input ────────────────────────────────────────────────────
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

    // ── Clear score fields, reset to queued ───────────────────────────────
    await submissionRef.update({
      status:            "queued",
      submissionNumber:  0,           // transaction will reassign
      score:             admin.firestore.FieldValue.delete(),
      score_label:       admin.firestore.FieldValue.delete(),
      strengths:         admin.firestore.FieldValue.delete(),
      gaps:              admin.firestore.FieldValue.delete(),
      language_feedback: admin.firestore.FieldValue.delete(),
      transcript_note:   admin.firestore.FieldValue.delete(),
      transcriptText:    admin.firestore.FieldValue.delete(),
      disfluencyMetadata:admin.firestore.FieldValue.delete(),
      monitor_notes:     admin.firestore.FieldValue.delete(),
      scaffold_feedback: admin.firestore.FieldValue.delete(),
      pass2Available:    false,
      errorMessage:      admin.firestore.FieldValue.delete(),
      errorAt:           admin.firestore.FieldValue.delete(),
      processedAt:       admin.firestore.FieldValue.delete(),
      requeuedAt:        admin.firestore.FieldValue.serverTimestamp(),
      requeuedBy:        uid,
    });

    // ── Run shared pipeline ───────────────────────────────────────────────
    await processSubmission(submissionId);

    logger.info("requeueSubmission: complete", { submissionId });
    return { success: true, submissionId };
  }
);
