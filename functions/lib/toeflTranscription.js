// functions/lib/toeflTranscription.js
// Deepgram transcription for TOEFL spoken submissions (INT, LAR). It runs
// inside onToeflSubmissionCreated, after the claim and before the scorer.
//
// REUSES B10-PP'S PASS 1, NOTHING NEW. Same key (DEEPGRAM_API_KEY), same
// function (lib/deepgramSTT.transcribeAudio: nova-2, smart_format off, fillers
// kept, diarized, word timestamps), and the same retry delays as index.js's
// withRetry. Its architectural invariant carries over unchanged: the raw
// Deepgram transcript reaches the scorer unmodified. B10-PP's Pass 2
// (AssemblyAI, instructor display only) is not involved and never feeds
// scoring.
//
// WHY IN THE SCORING TRIGGER, NOT PER CLIP. The trigger's claim transaction
// already guarantees one run per submission, so Deepgram is never called
// twice for one submission, just as the Anthropic call isn't. A per-clip
// Storage trigger would need its own idempotency, and the scorer needs all
// four transcripts at once anyway.
//
// WHAT IT WRITES, in the shapes the scorer already reads:
//   INT (scoreInterview / buildInterviewInput):
//     toeflAttempts.interviewClips[i].transcriptStatus   'complete' | 'error'
//     toeflSubmissions.responseContent.transcripts       [{questionIndex,
//       transcript, deliveryEvidence, sttMeta}], 0-based, the shape
//       scripts/seedToeflIntFixture.js defines
//   LAR (scoreListenAndRepeat):
//     toeflSubmissions.responseContent.transcript, .wordTimings (integer ms),
//     .sttMeta. Exactly B10-PP's Stage 00 (index.js step 13b): UNFILTERED
//     allWords through lib/lar/ingest. responseBoundaries come from the
//     client. `intelligibility` is NOT produced here; transcription cannot
//     supply it, and the LAR scorer will still refuse until something does.
//
// Anything a client wrote into these fields at create time is overwritten:
// the create rule does not validate responseContent.

"use strict";

const { transcribeAudio } = require("./deepgramSTT");
const { computeDisfluencyMetadata } = require("./claudeScorer");
const { toWordTimings, buildSttMeta } = require("./lar/ingest");

// Same schedule as functions/index.js withRetry: 3 attempts, 2 s then 4 s.
const RETRY_DELAYS_MS = [2000, 4000, 8000];

// Word confidence below this counts as "low" for the evidence summary.
// A choice made here, not taken from any spec: see wordConfidencePattern.
const LOW_CONFIDENCE = 0.6;

function mimeTypeFor(storagePath) {
  if (/\.mp4$|\.m4a$/i.test(storagePath)) return "audio/mp4";
  if (/\.wav$/i.test(storagePath)) return "audio/wav";
  if (/\.ogg$/i.test(storagePath)) return "audio/ogg";
  return "audio/webm";   // B10-PP's default, and Chrome's recorder format
}

async function withRetry(fn, label, { sleep, logger }) {
  let lastError;
  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      logger.warn(`${label}: attempt ${attempt} failed — ${err.message}`);
      if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    }
  }
  throw new Error(`${label}: all ${RETRY_DELAYS_MS.length} attempts failed. Last: ${lastError.message}`);
}

// "mean 0.96; no low-confidence stretches" /
// "mean 0.88; two low-confidence stretches (16-18s, 31-33s)", the phrasing
// seedToeflIntFixture.js uses. A stretch is two or more consecutive words below
// LOW_CONFIDENCE. Both the threshold and the two-word minimum are this module's
// choices; the evidence is qualitative (Interview prompt A3: "no number in the
// delivery evidence maps to a band").
function wordConfidencePattern(words) {
  const confs = words.map((w) => w.confidence).filter((c) => typeof c === "number");
  if (!confs.length) return null;
  const mean = (confs.reduce((a, b) => a + b, 0) / confs.length).toFixed(2);
  const stretches = [];
  let run = [];
  const flush = () => { if (run.length >= 2) stretches.push(run); run = []; };
  for (const w of words) {
    if (typeof w.confidence === "number" && w.confidence < LOW_CONFIDENCE) run.push(w);
    else flush();
  }
  flush();
  if (!stretches.length) return `mean ${mean}; no low-confidence stretches`;
  const NUM = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  const n = stretches.length < NUM.length ? NUM[stretches.length] : String(stretches.length);
  const spans = stretches.map((r) => `${Math.floor(r[0].start)}-${Math.ceil(r[r.length - 1].end)}s`).join(", ");
  return `mean ${mean}; ${n} low-confidence stretch${stretches.length === 1 ? "" : "es"} (${spans})`;
}

// The deliveryEvidence block renderDeliveryEvidence reads, built from
// computeDisfluencyMetadata, per JC's Sep 10 call: render the pipeline's real
// 1.5 s / 2.5 s pause tiers (the renderer labels them) rather than fabricate
// the contract's 0.495 s figures.
//
// wordsPerMinute is measured over the SPEECH SPAN (first word start to last
// word end), not the clip length, so the reaction time before speaking and
// any silence before Stop don't dilute it. Also a choice made here.
function deliveryEvidence(words, clipDurationSeconds) {
  if (!words.length) return null;   // no speech: nothing to measure, never estimated
  const m = computeDisfluencyMetadata(words);
  const spanSeconds = Math.max(0, (words[words.length - 1].end || 0) - (words[0].start || 0));
  return {
    wordsPerMinute: spanSeconds > 0 ? Math.round((words.length / spanSeconds) * 60) : null,
    meanGapSeconds: m.mean_gap,
    longPauseCount: m.pause_count_1500,
    longPauseTimestamps: m.pause_timestamps_1500,
    severePauseCount: m.pause_count_2500,
    severePauseTimestamps: m.pause_timestamps_2500,
    filledPauseCount: m.filled_pause_count,
    wordConfidencePattern: wordConfidencePattern(words),
    durationSeconds: typeof clipDurationSeconds === "number" ? clipDurationSeconds : null,
  };
}

async function transcribeClip({ bucket, storagePath, apiKey, transcribe, sleep, logger, label }) {
  const [buffer] = await bucket.file(storagePath).download();
  return withRetry(
    () => transcribe(apiKey, buffer, mimeTypeFor(storagePath), { allowEmpty: true }),
    label,
    { sleep, logger }
  );
}

/**
 * INT: transcribe every recorded clip, write the results, and return the
 * submission object the scorer should receive.
 *
 * On any clip failure: that clip's transcriptStatus becomes 'error' (the
 * others keep what they reached), everything is written, and it throws. The
 * trigger then marks the submission 'error'. The scorer is never reached, as
 * its own contract requires ("the model is deliberately not called").
 */
async function transcribeInterview({
  db, bucket, submissionRef, submission, apiKey,
  transcribe = transcribeAudio, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), logger, serverTimestamp,
}) {
  const attemptRef = db.collection("toeflAttempts").doc(submission.attemptId);
  const attemptSnap = await attemptRef.get();
  if (!attemptSnap.exists) throw new Error(`attempt ${submission.attemptId} not found`);
  const clips = Array.isArray(attemptSnap.data().interviewClips) ? attemptSnap.data().interviewClips : [];

  const results = await Promise.all(clips.map(async (clip) => {
    if (!clip || !clip.storagePath) return { clip, entry: null };   // no recording: scorer renders [NO RECORDING]
    try {
      const { transcript, words } = await transcribeClip({
        bucket, storagePath: clip.storagePath, apiKey, transcribe, sleep, logger,
        label: `Deepgram INT q${clip.questionIndex}`,
      });
      return {
        clip: { ...clip, transcriptStatus: "complete" },
        entry: {
          questionIndex: clip.questionIndex,
          transcript,   // raw Pass 1 text, unmodified (invariant 1)
          deliveryEvidence: deliveryEvidence(words, clip.durationSeconds),
          sttMeta: buildSttMeta(words),
        },
      };
    } catch (err) {
      logger.error("transcribeInterview: clip failed", { attemptId: submission.attemptId, questionIndex: clip.questionIndex, error: err.message });
      return { clip: { ...clip, transcriptStatus: "error" }, entry: null, error: err };
    }
  }));

  const interviewClips = results.map((r) => r.clip);
  const transcripts = results.filter((r) => r.entry).map((r) => r.entry)
    .sort((a, b) => a.questionIndex - b.questionIndex);

  // The attempt first: the scorer reads transcriptStatus from there.
  await attemptRef.update({ interviewClips });
  await submissionRef.update({ "responseContent.transcripts": transcripts, transcribedAt: serverTimestamp() });

  const failed = results.filter((r) => r.error);
  if (failed.length) {
    throw new Error(
      `INT transcription failed for question(s) ${failed.map((r) => r.clip.questionIndex).join(", ")} ` +
      `of attempt ${submission.attemptId}: ${failed[0].error.message}`
    );
  }
  return { ...submission, responseContent: { ...(submission.responseContent || {}), transcripts } };
}

/**
 * LAR: one continuous recording. B10-PP's Stage 00, applied to toeflSubmissions.
 */
async function transcribeListenAndRepeat({
  bucket, submissionRef, submission, apiKey,
  transcribe = transcribeAudio, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), logger, serverTimestamp,
}) {
  const rc = submission.responseContent || {};
  const storagePath = rc.audioClip && rc.audioClip.storagePath;
  if (!storagePath) {
    throw new Error("LAR submission has no responseContent.audioClip.storagePath to transcribe");
  }
  const { transcript, allWords } = await transcribeClip({
    bucket, storagePath, apiKey, transcribe, sleep, logger, label: "Deepgram LAR",
  });
  // UNFILTERED allWords, per deepgramSTT's LAR note: a speaker guess is
  // meaningless when stimulus and response are the same sentence.
  const wordTimings = toWordTimings(allWords);
  const sttMeta = { ...buildSttMeta(allWords), capturedAt: serverTimestamp() };
  await submissionRef.update({
    "responseContent.transcript": transcript,
    "responseContent.wordTimings": wordTimings,
    "responseContent.sttMeta": sttMeta,
    transcribedAt: serverTimestamp(),
  });
  return { ...submission, responseContent: { ...rc, transcript, wordTimings, sttMeta } };
}

const TRANSCRIBERS = { INT: transcribeInterview, LAR: transcribeListenAndRepeat };

module.exports = {
  TRANSCRIBERS, transcribeInterview, transcribeListenAndRepeat,
  deliveryEvidence, wordConfidencePattern, mimeTypeFor, LOW_CONFIDENCE,
};
