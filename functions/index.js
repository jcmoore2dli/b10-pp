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
const { onSchedule }            = require("firebase-functions/v2/scheduler");
const { defineSecret }          = require("firebase-functions/params");
const logger                    = require("firebase-functions/logger");
const admin                     = require("firebase-admin");
const { transcribeAudio }       = require("./lib/deepgramSTT");
const { scoreTranscript, computeDisfluencyMetadata, validateFeedbackGrammar } = require("./lib/claudeScorer");


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
    const taskFamily = ["ESO", "PARAPHRASE", "EXTENDED_LISTENING"].includes(type) ? "LEVEL3" : "LEVEL2";
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
    // ── Step 6c: Frames Practice auto-scaffold (ESO-AES- passages) ──────────
    // If the passage is a Frames Practice question, override scaffoldConfig
    // from the passage doc's frame fields. Instructor scaffold not used.
    let effectiveScaffoldConfig = scaffoldConfig || null;

    if (data.passageId && data.passageId.startsWith("ESO-AES-")) {
      try {
        const framesSnap = await db.collection("passages").doc(data.passageId).get();
        if (framesSnap.exists) {
          const fd = framesSnap.data();
          effectiveScaffoldConfig = {
            focusArea:    fd.suggestedFocusArea   || "discourse_frame",
            primaryFrame: fd.suggestedPrimaryFrame || null,
            secondaryFrame: null,
            primaryStructure: null,
            studentCueText: "",
          };
          logger.info("processSubmission: Frames auto-scaffold applied", {
            submissionId,
            passageId: data.passageId,
            effectiveScaffoldConfig,
          });
        } else {
          logger.warn("processSubmission: Frames passage doc not found — scoring holistic", {
            submissionId,
            passageId: data.passageId,
          });
        }
      } catch (framesErr) {
        logger.error("processSubmission: Frames auto-scaffold fetch failed — scoring holistic", {
          submissionId,
          passageId: data.passageId,
          error: framesErr.message,
        });
      }
    }

    // ── Step 7 + 8: Build scorer params ───────────────────────────────────
    const scorerParams = {
      transcript,
      words,
      promptDescription: promptDescription || "",
      passageText,
    };

    if (type === "ESO") {
      scorerParams.focusMode       = effectiveScaffoldConfig?.focusArea      || "Holistic";
      scorerParams.primaryTarget   = effectiveScaffoldConfig?.primaryFrame   || effectiveScaffoldConfig?.primaryStructure   || "none";
      scorerParams.secondaryTarget = effectiveScaffoldConfig?.secondaryFrame || effectiveScaffoldConfig?.secondaryStructure || "none";

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

    // ── Step 11b: Grammar validation pass ──────────────────────────────────
    const validatedFeedback = await validateFeedbackGrammar(
      ANTHROPIC_API_KEY.value(),
      {
        strengths:         scoreResult.strengths         || "",
        gaps:              scoreResult.gaps              || "",
        language_feedback: scoreResult.language_feedback || "",
      }
    );
    logger.info("processSubmission: grammar validation complete", { submissionId });
    // ── Step 12 + 13: Write result fields ────────────────────────────────
    const resultFields = {
      status:            "complete",
      processedAt:       admin.firestore.FieldValue.serverTimestamp(),
      taskFamily,
      transcriptText:    transcript,
      score:             scoreResult.score,
      score_label:       scoreResult.score_label,
      strengths:         validatedFeedback.strengths,
      gaps:              validatedFeedback.gaps,
      language_feedback: validatedFeedback.language_feedback,
      transcript_note:   transcriptNote,
      pass2Available,
    };

    if (isLevel2) {
      resultFields.monitor_notes      = scoreResult.monitor_notes || "";
      resultFields.disfluencyMetadata = disfluencyMetadata;
    }

    if (type === "ESO") {
      resultFields.scaffold_feedback = scoreResult.scaffold_feedback || "";
      resultFields.summary = scoreResult.summary || "";
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
// ── cleanupAudio ─────────────────────────────────────────────────────────────
// Runs daily. Deletes audio files after 14 days, nulls transcripts after 30 days.
// Privacy hard gate — required before pilot.
exports.cleanupAudio = onSchedule("every 24 hours", async () => {
  const db = admin.firestore();
  const bucket = admin.storage().bucket();
  const now = Date.now();
  const day14 = new Date(now - 3 * 24 * 60 * 60 * 1000);
  const day30 = new Date(now - 30 * 24 * 60 * 60 * 1000);

  // ── Delete audio files older than 14 days ─────────────────────────────────
  const audioSnap = await db.collection("submissions")
    .where("createdAt", "<", day14)
    .where("audioPath", "!=", null)
    .get();

  let audioDeleted = 0;
  await Promise.all(audioSnap.docs.map(async (doc) => {
    const { audioPath } = doc.data();
    try {
      await bucket.file(audioPath).delete();
      await doc.ref.update({ audioPath: null });
      audioDeleted++;
    } catch (err) {
      logger.error("cleanupAudio: failed to delete audio", { docId: doc.id, audioPath, error: err.message });
    }
  }));
  logger.info("cleanupAudio: audio deletion complete", { audioDeleted });

  // ── Null transcript text older than 30 days ───────────────────────────────
  const transcriptSnap = await db.collection("submissions")
    .where("createdAt", "<", day30)
    .where("transcriptText", "!=", null)
    .get();

  let transcriptNulled = 0;
  await Promise.all(transcriptSnap.docs.map(async (doc) => {
    try {
      await doc.ref.update({ transcriptText: null });
      transcriptNulled++;
    } catch (err) {
      logger.error("cleanupAudio: failed to null transcript", { docId: doc.id, error: err.message });
    }
  }));
  logger.info("cleanupAudio: transcript cleanup complete", { transcriptNulled });
});

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

    const callerRole = request.auth?.token?.role;
    if (callerRole !== "admin") {
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

    const callerRole = request.auth?.token?.role;
    if (!["instructor", "admin"].includes(callerRole)) {
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
// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: enrollStudent
//
// Called by client (EntryScreen) after student signs in.
// Validates access code, assigns b10Id, creates /students doc,
// sets custom claims { b10Id, role, groupId } on student's Auth account.
//
// Access code format: YY-NNN (e.g., 26-001)
// b10Id format: YY-NNN-S (e.g., 26-001-1)
// Default track: B · Default ilrBaseline: 3
//
// INVARIANT: b10Id assignment uses Firestore transaction — no duplicates.
// ─────────────────────────────────────────────────────────────────────────────
exports.enrollStudent = onCall(async (request) => {
  // ── Auth check ────────────────────────────────────────────────────────────
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Must be signed in.");

  // ── Input validation ──────────────────────────────────────────────────────
  const { accessCode } = request.data;
  if (!accessCode || typeof accessCode !== "string") {
    throw new HttpsError("invalid-argument", "accessCode required.");
  }

  const code = accessCode.trim().toUpperCase().replace(/\s/g, "");

  // ── Check if student is already enrolled ─────────────────────────────────
  const existingSnap = await db.collection("students")
    .where("uid", "==", uid)
    .limit(1)
    .get();
  if (!existingSnap.empty) {
    const existing = existingSnap.docs[0].data();
    logger.info("enrollStudent: already enrolled", { uid, b10Id: existing.b10Id });
    return { success: true, b10Id: existing.b10Id, alreadyEnrolled: true };
  }

  // ── Validate access code ──────────────────────────────────────────────────
  const codeRef = db.collection("accessCodes").doc(code);
  const codeSnap = await codeRef.get();
  if (!codeSnap.exists) {
    throw new HttpsError("not-found", "Access code not found.");
  }
  const codeData = codeSnap.data();
  if (!codeData.active) {
    throw new HttpsError("failed-precondition", "Access code is no longer active.");
  }

  const { groupId } = codeData;

  // ── Transaction: assign b10Id ─────────────────────────────────────────────
  let b10Id;
  try {
    b10Id = await db.runTransaction(async (tx) => {
      const freshSnap = await tx.get(codeRef);
      const count = freshSnap.data().enrolledCount || 0;
      const newCount = count + 1;
      const newB10Id = `${code}-${newCount}`;

      tx.update(codeRef, { enrolledCount: newCount });
      tx.set(db.collection("students").doc(newB10Id), {
        b10Id:        newB10Id,
        uid:          uid,
        groupId:      groupId,
        accessCode:   code,
        track:        "B",
        ilrBaseline:  "3",
        createdAt:    admin.firestore.FieldValue.serverTimestamp(),
      });

      return newB10Id;
    });
  } catch (err) {
    logger.error("enrollStudent: transaction failed", { uid, code, error: err.message });
    throw new HttpsError("internal", `Enrollment transaction failed: ${err.message}`);
  }

  // ── Set custom claims ─────────────────────────────────────────────────────
  await admin.auth().setCustomUserClaims(uid, {
    b10Id,
    role:    "student",
    groupId,
  });

  // ── Pre-load CORE bundles if access code has preloadBundles: true ──────────
  if (codeData.preloadBundles && codeData.linkedInstrB10Id) {
    try {
      const instrEmail = codeData.linkedInstrB10Id.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-') + '@b10pp.local';
      let instrRecord = null;
      try {
        instrRecord = await admin.auth().getUserByEmail(instrEmail);
      } catch (e) {
        logger.warn("enrollStudent: linked instructor not found, skipping preload", { linkedInstrB10Id: codeData.linkedInstrB10Id });
      }

      if (instrRecord) {
        const instrUid = instrRecord.uid;

        await db.collection("rosters").doc(instrUid).collection("students").doc(b10Id).set({
          b10Id,
          studentUid: uid,
          addedAt: admin.firestore.FieldValue.serverTimestamp(),
          addedBy: "enrollStudent",
        }, { merge: true });

        const existingCheck = await db.collection("assignments")
          .where("studentId", "==", b10Id)
          .where("bundleId", "==", "S1.1")
          .limit(1)
          .get();

        if (existingCheck.empty) {
          const batch = db.batch();
          for (const bundle of CORE_BUNDLE_MAP) {
            const assignmentRef = db.collection("assignments").doc();
            batch.set(assignmentRef, {
              studentId:      b10Id,
              assignedBy:     instrUid,
              assignedTo:     uid,
              passageIds:     [bundle.leg, bundle.cor, bundle.eso],
              bundleId:       `S${bundle.set}.${bundle.day}`,
              setNumber:      bundle.set,
              dayNumber:      bundle.day,
              assignmentType: "main",
              corpusType:     "COR",
              scaffoldConfig: null,
              instrRole:      "main",
              assignedAt:     admin.firestore.FieldValue.serverTimestamp(),
              createdAt:      admin.firestore.FieldValue.serverTimestamp(),
              status:         "pending",
            });
          }
          await batch.commit();
          logger.info("enrollStudent: CORE bundles preloaded", { b10Id, instrUid });
        } else {
          logger.info("enrollStudent: bundles already exist, skipping preload", { b10Id });
        }
      }
    } catch (preloadErr) {
      logger.error("enrollStudent: preload failed — enrollment still complete", { b10Id, error: preloadErr.message });
    }
  }

  logger.info("enrollStudent: complete", { uid, b10Id, groupId, accessCode: code });

  return { success: true, b10Id, alreadyEnrolled: false };
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: createInstructorAccount
//
// Admin-only. Creates a Firebase Auth user for an instructor and sets
// custom claims { b10Id, role: "instructor", groupId } in one server-side call.
//
// Input: { b10Id, password, groupId }
// b10Id format: YY-NNN (e.g., 26-001)
// Synthetic email: {b10id}@b10pp.local
//
// INVARIANT: Only admin role may call this. Never callable by students.
// ─────────────────────────────────────────────────────────────────────────────
exports.createInstructorAccount = onCall(async (request) => {
  // ── Auth check ────────────────────────────────────────────────────────────
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "Must be signed in.");
  const callerToken = request.auth?.token;
  if (callerToken?.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin role required.");
  }
  // ── Input validation ──────────────────────────────────────────────────────
  const { b10Id, password, groupId = "DLIELC" } = request.data;
  if (!b10Id || !password) {
    throw new HttpsError("invalid-argument", "b10Id and password are required.");
  }
  if (password.length < 6) {
    throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");
  }
  // ── Construct synthetic email ─────────────────────────────────────────────
  const syntheticEmail = b10Id.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-') + '@b10pp.local';
  // ── Create Firebase Auth user ─────────────────────────────────────────────
  let userRecord;
  try {
    userRecord = await admin.auth().createUser({
      email:    syntheticEmail,
      password: password,
    });
  } catch (err) {
    if (err.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", `An account with B10 ID ${b10Id} already exists.`);
    }
    throw new HttpsError("internal", `Failed to create user: ${err.message}`);
  }
  // ── Set custom claims ─────────────────────────────────────────────────────
  await admin.auth().setCustomUserClaims(userRecord.uid, {
    b10Id:   b10Id.trim(),
    role:    "instructor",
    groupId: groupId.trim(),
  });
  logger.info("createInstructorAccount: complete", { uid: userRecord.uid, b10Id, groupId });
  return { success: true, uid: userRecord.uid, b10Id, role: "instructor", groupId };
});
// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: lookupStudent
//
// Instructor/admin only. Looks up a student by B10 ID via Firebase Auth.
// Works regardless of whether student went through enrollStudent or direct
// registration. Returns basic account info if found.
//
// Input: { b10Id }
// ─────────────────────────────────────────────────────────────────────────────
exports.lookupStudent = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "Must be signed in.");
  const callerToken = request.auth?.token;
  if (!["instructor", "admin"].includes(callerToken?.role)) {
    throw new HttpsError("permission-denied", "Instructor or admin role required.");
  }
  const { b10Id } = request.data;
  if (!b10Id) throw new HttpsError("invalid-argument", "b10Id is required.");
  const syntheticEmail = b10Id.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-') + '@b10pp.local';
  try {
    const userRecord = await admin.auth().getUserByEmail(syntheticEmail);
    logger.info("lookupStudent: found", { b10Id, uid: userRecord.uid });
    return { success: true, b10Id: b10Id.trim(), uid: userRecord.uid };
  } catch (err) {
    if (err.code === "auth/user-not-found") {
      throw new HttpsError("not-found", `No student found with B10 ID: ${b10Id}`);
    }
    throw new HttpsError("internal", `Lookup failed: ${err.message}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: adminBulkRosterSetup
//
// Admin-only. Bulk-adds students to an instructor's roster.
// Optionally pre-loads all 12 CORE bundle assignments in sequence order.
// Optionally sets an expiry date on each roster entry.
//
// Input: {
//   instructorB10Id: string,
//   studentB10Ids:   string[],
//   preloadBundles:  boolean,
//   expiryDate:      string | null  (ISO date string, e.g. "2026-10-01")
// }
// ─────────────────────────────────────────────────────────────────────────────
const CORE_BUNDLE_MAP = [
  { set: 1,  day: 1, leg: 'COR-ECN-002', cor: 'COR-EDU-001', eso: 'EDU-001' },
  { set: 1,  day: 2, leg: 'COR-ECN-010', cor: 'COR-EDU-006', eso: 'EDU-006' },
  { set: 1,  day: 3, leg: 'COR-SCI-002', cor: 'COR-EDU-015', eso: 'EDU-015' },
  { set: 1,  day: 4, leg: 'COR-SCI-010', cor: 'COR-WRK-003', eso: 'WRK-003' },
  { set: 1,  day: 5, leg: 'COR-SCI-013', cor: 'COR-WRK-007', eso: 'WRK-007' },
  { set: 2,  day: 1, leg: 'COR-BIO-008', cor: 'COR-ENV-008', eso: 'ENV-008' },
  { set: 2,  day: 2, leg: 'COR-BIO-011', cor: 'COR-ENV-015', eso: 'ENV-015' },
  { set: 2,  day: 3, leg: 'COR-ENV-001', cor: 'COR-HLT-005', eso: 'HLT-005' },
  { set: 2,  day: 4, leg: 'COR-HLT-002', cor: 'COR-HLT-012', eso: 'HLT-012' },
  { set: 2,  day: 5, leg: 'COR-HLT-009', cor: 'COR-HLT-022', eso: 'HLT-022' },
  { set: 3,  day: 1, leg: 'COR-ECN-003', cor: 'COR-GOV-003', eso: 'GOV-003' },
  { set: 3,  day: 2, leg: 'COR-SOC-003', cor: 'COR-GOV-012', eso: 'GOV-012' },
  { set: 3,  day: 3, leg: 'COR-SOC-005', cor: 'COR-INT-004', eso: 'INT-004' },
  { set: 3,  day: 4, leg: 'COR-SOC-007', cor: 'COR-JUS-003', eso: 'JUS-003' },
  { set: 3,  day: 5, leg: 'COR-SOC-008', cor: 'COR-JUS-008', eso: 'JUS-008' },
  { set: 4,  day: 1, leg: 'COR-PHY-003', cor: 'COR-ECN-008', eso: 'ECN-008' },
  { set: 4,  day: 2, leg: 'COR-PHY-006', cor: 'COR-TEC-003', eso: 'TEC-003' },
  { set: 4,  day: 3, leg: 'COR-TEC-006', cor: 'COR-TEC-012', eso: 'TEC-012' },
  { set: 4,  day: 4, leg: 'COR-TEC-007', cor: 'COR-TEC-018', eso: 'TEC-018' },
  { set: 4,  day: 5, leg: 'COR-TEC-009', cor: 'COR-TEC-025', eso: 'TEC-025' },
  { set: 5,  day: 1, leg: 'COR-BIO-001', cor: 'COR-CUL-005', eso: 'CUL-005' },
  { set: 5,  day: 2, leg: 'COR-ECN-006', cor: 'COR-EDU-003', eso: 'EDU-003' },
  { set: 5,  day: 3, leg: 'COR-ENV-006', cor: 'COR-GOV-008', eso: 'GOV-008' },
  { set: 5,  day: 4, leg: 'COR-SCI-004', cor: 'COR-HLT-008', eso: 'HLT-008' },
  { set: 5,  day: 5, leg: 'COR-SOC-001', cor: 'COR-TEC-008', eso: 'TEC-008' },
  { set: 6,  day: 1, leg: 'COR-BIO-007', cor: 'COR-ENV-003', eso: 'ENV-003' },
  { set: 6,  day: 2, leg: 'COR-HLT-004', cor: 'COR-HLT-018', eso: 'HLT-018' },
  { set: 6,  day: 3, leg: 'COR-PHY-007', cor: 'COR-INT-006', eso: 'INT-006' },
  { set: 6,  day: 4, leg: 'COR-SCI-008', cor: 'COR-INT-008', eso: 'INT-008' },
  { set: 6,  day: 5, leg: 'COR-TEC-011', cor: 'COR-WRK-012', eso: 'WRK-012' },
  { set: 7,  day: 1, leg: 'COR-BIO-006', cor: 'COR-EDU-012', eso: 'EDU-012' },
  { set: 7,  day: 2, leg: 'COR-ECN-005', cor: 'COR-GOV-018', eso: 'GOV-018' },
  { set: 7,  day: 3, leg: 'COR-ENV-013', cor: 'COR-HLT-025', eso: 'HLT-025' },
  { set: 7,  day: 4, leg: 'COR-HLT-006', cor: 'COR-SOC-010', eso: 'SOC-010' },
  { set: 7,  day: 5, leg: 'COR-SCI-006', cor: 'COR-TEC-022', eso: 'TEC-022' },
  { set: 8,  day: 1, leg: 'COR-ECN-009', cor: 'COR-EDU-005', eso: 'EDU-005' },
  { set: 8,  day: 2, leg: 'COR-ECN-015', cor: 'COR-EDU-018', eso: 'EDU-018' },
  { set: 8,  day: 3, leg: 'COR-SCI-003', cor: 'COR-EDU-022', eso: 'EDU-022' },
  { set: 8,  day: 4, leg: 'COR-SCI-009', cor: 'COR-WRK-008', eso: 'WRK-008' },
  { set: 8,  day: 5, leg: 'COR-SCI-014', cor: 'COR-WRK-015', eso: 'WRK-015' },
  { set: 9,  day: 1, leg: 'COR-BIO-002', cor: 'COR-ENV-012', eso: 'ENV-012' },
  { set: 9,  day: 2, leg: 'COR-BIO-003', cor: 'COR-ENV-018', eso: 'ENV-018' },
  { set: 9,  day: 3, leg: 'COR-ENV-007', cor: 'COR-HLT-015', eso: 'HLT-015' },
  { set: 9,  day: 4, leg: 'COR-HLT-003', cor: 'COR-HLT-028', eso: 'HLT-028' },
  { set: 9,  day: 5, leg: 'COR-HLT-010', cor: 'COR-HLT-032', eso: 'HLT-032' },
  { set: 10, day: 1, leg: 'COR-ECN-001', cor: 'COR-GOV-015', eso: 'GOV-015' },
  { set: 10, day: 2, leg: 'COR-SOC-002', cor: 'COR-GOV-022', eso: 'GOV-022' },
  { set: 10, day: 3, leg: 'COR-SOC-006', cor: 'COR-INT-012', eso: 'INT-012' },
  { set: 10, day: 4, leg: 'COR-SOC-009', cor: 'COR-JUS-005', eso: 'JUS-005' },
  { set: 10, day: 5, leg: 'COR-SOC-012', cor: 'COR-JUS-015', eso: 'JUS-015' },
  { set: 11, day: 1, leg: 'COR-PHY-001', cor: 'COR-ECN-012', eso: 'ECN-012' },
  { set: 11, day: 2, leg: 'COR-PHY-012', cor: 'COR-ECN-018', eso: 'ECN-018' },
  { set: 11, day: 3, leg: 'COR-TEC-002', cor: 'COR-TEC-015', eso: 'TEC-015' },
  { set: 11, day: 4, leg: 'COR-TEC-010', cor: 'COR-TEC-028', eso: 'TEC-028' },
  { set: 11, day: 5, leg: 'COR-TEC-014', cor: 'COR-TEC-032', eso: 'TEC-032' },
  { set: 12, day: 1, leg: 'COR-BIO-013', cor: 'COR-CUL-012', eso: 'CUL-012' },
  { set: 12, day: 2, leg: 'COR-ECN-004', cor: 'COR-EDU-025', eso: 'EDU-025' },
  { set: 12, day: 3, leg: 'COR-ENV-002', cor: 'COR-GOV-025', eso: 'GOV-025' },
  { set: 12, day: 4, leg: 'COR-PHY-015', cor: 'COR-HLT-020', eso: 'HLT-020' },
  { set: 12, day: 5, leg: 'COR-SCI-007', cor: 'COR-TEC-035', eso: 'TEC-035' },
];

exports.adminBulkRosterSetup = onCall(async (request) => {
  // ── Auth check ────────────────────────────────────────────────────────────
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "Must be signed in.");
  const callerToken = request.auth?.token;
  if (callerToken?.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin role required.");
  }

  // ── Input validation ──────────────────────────────────────────────────────
  const { instructorB10Id, studentB10Ids, preloadBundles, expiryDate } = request.data;
  if (!instructorB10Id || typeof instructorB10Id !== "string") {
    throw new HttpsError("invalid-argument", "instructorB10Id required.");
  }
  if (!Array.isArray(studentB10Ids) || studentB10Ids.length === 0) {
    throw new HttpsError("invalid-argument", "studentB10Ids must be a non-empty array.");
  }

  // ── Resolve instructor UID ────────────────────────────────────────────────
  const instrEmail = instructorB10Id.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-') + '@b10pp.local';
  let instructorRecord;
  try {
    instructorRecord = await admin.auth().getUserByEmail(instrEmail);
  } catch (err) {
    throw new HttpsError("not-found", `Instructor not found: ${instructorB10Id}`);
  }
  const instructorUid = instructorRecord.uid;
  const instructorClaims = instructorRecord.customClaims || {};
  const groupId = instructorClaims.groupId || "DLIELC";

  logger.info("adminBulkRosterSetup: instructor resolved", { instructorB10Id, instructorUid, groupId });

  // ── Process each student ──────────────────────────────────────────────────
  const results = [];

  for (const rawB10Id of studentB10Ids) {
    const b10Id = rawB10Id.trim();
    if (!b10Id) continue;

    const studentResult = { b10Id, status: null, error: null, assignmentsCreated: 0 };

    try {
      // Resolve student UID
      const studentEmail = b10Id.toLowerCase().replace(/[^a-z0-9-]/g, '-') + '@b10pp.local';
      let studentRecord;
      try {
        studentRecord = await admin.auth().getUserByEmail(studentEmail);
      } catch (err) {
        throw new Error(`Student not found in Firebase Auth: ${b10Id}`);
      }
      const studentUid = studentRecord.uid;

      // Set student claims
      await admin.auth().setCustomUserClaims(studentUid, {
        b10Id,
        role:    "student",
        groupId,
      });

      // Write roster entry
      const rosterRef = db
        .collection("rosters")
        .doc(instructorUid)
        .collection("students")
        .doc(b10Id);

      const rosterEntry = {
        b10Id,
        studentUid,
        addedAt:   admin.firestore.FieldValue.serverTimestamp(),
        addedBy:   callerUid,
      };
      if (expiryDate) {
        rosterEntry.expiryDate = expiryDate;
      }
      await rosterRef.set(rosterEntry, { merge: true });

      // Pre-load CORE bundle assignments if requested
      // Deduplication: skip if S1.1 already exists for this student
      if (preloadBundles) {
        const existingCheck = await db.collection('assignments')
          .where('studentId', '==', b10Id)
          .where('bundleId', '==', 'S1.1')
          .limit(1)
          .get()
        if (!existingCheck.empty) {
          logger.info('adminBulkRosterSetup: bundles already exist, skipping', { b10Id })
          studentResult.status = 'ok'
          studentResult.skippedPreload = true
          results.push(studentResult)
          continue
        }
        const batch = db.batch();
        let count = 0;
        for (const bundle of CORE_BUNDLE_MAP) {
          const assignmentRef = db.collection("assignments").doc();
          batch.set(assignmentRef, {
            studentId:      b10Id,
            assignedBy:     callerUid,
            assignedTo:     studentUid,
            passageIds:     [bundle.leg, bundle.cor, bundle.eso],
            bundleId:       `S${bundle.set}.${bundle.day}`,
            setNumber:      bundle.set,
            dayNumber:      bundle.day,
            assignmentType: "main",
            corpusType:     "COR",
            scaffoldConfig: null,
            instrRole:      "main",
            assignedAt:     admin.firestore.FieldValue.serverTimestamp(),
            createdAt:      admin.firestore.FieldValue.serverTimestamp(),
            status:         "pending",
          });
          count++;
        }
        await batch.commit();
        studentResult.assignmentsCreated = count;
      }

      studentResult.status = "ok";
      logger.info("adminBulkRosterSetup: student processed", { b10Id, preloadBundles, assignmentsCreated: studentResult.assignmentsCreated });

    } catch (err) {
      studentResult.status = "error";
      studentResult.error = err.message;
      logger.error("adminBulkRosterSetup: student error", { b10Id, error: err.message });
    }

    results.push(studentResult);
  }

  const successCount = results.filter(r => r.status === "ok").length;
  const errorCount   = results.filter(r => r.status === "error").length;

  logger.info("adminBulkRosterSetup: complete", { instructorB10Id, successCount, errorCount });

  return { success: true, instructorUid, groupId, results, successCount, errorCount };
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: instructorAddStudent
//
// Instructor or admin. Adds a student to the calling instructor's roster
// and sets student claims via admin SDK. Replaces direct setStudentClaims
// call from instructor dashboard.
//
// Input: { b10Id, groupId }
// ─────────────────────────────────────────────────────────────────────────────
exports.instructorAddStudent = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "Must be signed in.");
  const callerToken = request.auth?.token;
  if (!["instructor", "admin"].includes(callerToken?.role)) {
    throw new HttpsError("permission-denied", "Instructor or admin role required.");
  }

  const { b10Id, groupId = "DLIELC" } = request.data;
  if (!b10Id) throw new HttpsError("invalid-argument", "b10Id is required.");

  // Resolve student UID
  const syntheticEmail = b10Id.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-') + '@b10pp.local';
  let studentRecord;
  try {
    studentRecord = await admin.auth().getUserByEmail(syntheticEmail);
  } catch (err) {
    throw new HttpsError("not-found", `No student found with B10 ID: ${b10Id}`);
  }
  const studentUid = studentRecord.uid;

  // Set student claims
  await admin.auth().setCustomUserClaims(studentUid, {
    b10Id: b10Id.trim(),
    role: "student",
    groupId,
  });

  // Write roster entry
  await db
    .collection("rosters")
    .doc(callerUid)
    .collection("students")
    .doc(b10Id.trim())
    .set({
      b10Id: b10Id.trim(),
      studentUid,
      addedAt: admin.firestore.FieldValue.serverTimestamp(),
      addedBy: callerUid,
    }, { merge: true });

  logger.info("instructorAddStudent: complete", { b10Id, callerUid, groupId });
  return { success: true, b10Id, studentUid };
});

// ─────────────────────────────────────────────────────────────────────────────
// CALLABLE: generateProgressSummary
//
// Instructor or admin. Takes a pre-built prompt from the client and calls
// Anthropic. Returns plain-text summary. API key never leaves the server.
//
// Input: { prompt: string }
// ─────────────────────────────────────────────────────────────────────────────
exports.generateProgressSummary = onCall(
  { secrets: [ANTHROPIC_API_KEY] },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError("unauthenticated", "Must be signed in.");
    const callerToken = request.auth?.token;
    if (!["instructor", "admin"].includes(callerToken?.role)) {
      throw new HttpsError("permission-denied", "Instructor or admin role required.");
    }

    const { prompt } = request.data;
    if (!prompt || typeof prompt !== "string") {
      throw new HttpsError("invalid-argument", "prompt is required.");
    }

    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content?.[0]?.text || "No summary generated.";
    logger.info("generateProgressSummary: complete", { callerUid, promptLength: prompt.length });
    return { success: true, text };
  }
);
