"use strict";

const { setGlobalOptions } = require("firebase-functions");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { transcribeAudio } = require("./lib/deepgramSTT");
const { scoreTranscript } = require("./lib/claudeScorer");

// ── Secrets ────────────────────────────────────────────────────────────────
const DEEPGRAM_API_KEY   = defineSecret("DEEPGRAM_API_KEY");
const ASSEMBLYAI_API_KEY = defineSecret("ASSEMBLYAI_API_KEY");
const ANTHROPIC_API_KEY  = defineSecret("ANTHROPIC_API_KEY");

// ── Global options ─────────────────────────────────────────────────────────
setGlobalOptions({ maxInstances: 10 });

// ── Firebase Admin ─────────────────────────────────────────────────────────
admin.initializeApp();
const db = admin.firestore();
const storage = admin.storage();

// ── processSubmission ──────────────────────────────────────────────────────
// Triggered on new document creation in /submissions/{submissionId}.
// Owns the full pipeline: audio → Deepgram STT → Claude scoring → Firestore write.
//
// ARCHITECTURAL INVARIANT:
// Raw Deepgram transcript is passed to the scoring engine without modification.
// No smoothing or cleaning between STT output and scoring engine input.

exports.processSubmission = onDocumentCreated(
  {
    document: "submissions/{submissionId}",
    secrets: [DEEPGRAM_API_KEY, ANTHROPIC_API_KEY],
  },
  async (event) => {
    const submissionId = event.params.submissionId;
    const data = event.data?.data();

    if (!data) {
      logger.error("processSubmission: no data on event", { submissionId });
      return;
    }

    const { studentId, audioPath, taskType, promptDescription, scaffoldConfig } = data;

    logger.info("processSubmission: started", {
      submissionId,
      studentId,
      taskType,
    });

    // ── Mark as processing ───────────────────────────────────────────────
    await db.collection("submissions").doc(submissionId).update({
      status: "processing",
      processingStartedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    try {
      // ── Step 1: Fetch audio from Firebase Storage ──────────────────────
      logger.info("processSubmission: fetching audio", { audioPath });
      const bucket = storage.bucket();
      const file = bucket.file(audioPath);
      const [audioBuffer] = await file.download();
      const mimeType = audioPath.endsWith(".mp4") ? "audio/mp4"
                     : audioPath.endsWith(".wav") ? "audio/wav"
                     : "audio/webm";

      // ── Step 2: Deepgram STT — raw transcript, word-level timestamps ───
      // INVARIANT: transcript is never modified after this call.
      logger.info("processSubmission: calling Deepgram", { submissionId });
      const { transcript, words } = await transcribeAudio(
        DEEPGRAM_API_KEY.value(),
        audioBuffer,
        mimeType
      );

      logger.info("processSubmission: transcript received", {
        submissionId,
        transcriptLength: transcript.length,
        wordCount: words.length,
      });

      // ── Step 3: Build scorer params ────────────────────────────────────
      const type = (taskType || "").toUpperCase();
      const taskFamily = type === "ESO" ? "LEVEL3" : "LEVEL2";

      const scorerParams = {
        transcript,   // RAW — never smoothed
        words,        // word-level timestamps for disfluency metadata
        promptDescription: promptDescription || "",
      };

      // ESO scaffold params
      if (type === "ESO") {
        scorerParams.focusMode    = scaffoldConfig?.focusArea || "Holistic";
        scorerParams.primaryTarget  = scaffoldConfig?.primaryFrame || "none";
        scorerParams.secondaryTarget = scaffoldConfig?.secondaryFrame || "none";
      }

      // LEVEL2 scaffold params
      if (["NARRATION", "DESCRIPTION", "INSTRUCTIONS"].includes(type)) {
        scorerParams.primaryFocus   = scaffoldConfig?.focusArea || "Holistic";
        scorerParams.activeMonitors = scaffoldConfig?.activeMonitors || "none";
      }

      // ── Step 4: Claude scoring ─────────────────────────────────────────
      logger.info("processSubmission: calling Claude scorer", {
        submissionId,
        taskType,
        taskFamily,
      });

      const scoreResult = await scoreTranscript(
        ANTHROPIC_API_KEY.value(),
        taskType,
        scorerParams
      );

      logger.info("processSubmission: score received", {
        submissionId,
        score: scoreResult.score,
        score_label: scoreResult.score_label,
        taskFamily,
      });

      // ── Step 5: Write result to Firestore (admin SDK) ──────────────────
      await db.collection("submissions").doc(submissionId).update({
        status: "complete",
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        taskFamily,
        rawTranscript: transcript,
        score: scoreResult.score,
        score_label: scoreResult.score_label,
        strengths: scoreResult.strengths,
        gaps: scoreResult.gaps,
        language_feedback: scoreResult.language_feedback,
        transcript_note: scoreResult.transcript_note || "",
        // LEVEL2 fields
        monitor_notes: scoreResult.monitor_notes || "",
        // ESO scaffold field
        scaffold_feedback: scoreResult.scaffold_feedback || "",
        // Pass 2 availability flag
        pass2Available: (
          scoreResult.score !== 1 &&
          scoreResult.transcript_note !== ""
        ),
      });

      logger.info("processSubmission: complete", {
        submissionId,
        score: scoreResult.score,
        score_label: scoreResult.score_label,
      });

    } catch (err) {
      logger.error("processSubmission: pipeline error", {
        submissionId,
        error: err.message,
      });

      await db.collection("submissions").doc(submissionId).update({
        status: "error",
        errorMessage: err.message,
        errorAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }
);
