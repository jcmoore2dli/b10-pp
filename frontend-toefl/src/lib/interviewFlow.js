// src/lib/interviewFlow.js
// The Interview recorder's rules, kept out of the component so they can be
// tested in Node (scripts/testToeflInterviewFlow.mjs). Sources:
// TOEFL_Interview_Recorder_Spec_v1_4, data model v1.18 (Collections 2 and 3,
// the `audio` field), and the scorer's input contract in
// functions/toeflScoring.js buildInterviewInput.
//
// INDEX BASES, deliberately explicit (the scorer's Sep 10 bug class):
//   - item audio clips: `question` index 1..4 (data model v1.18 Appendix B)
//   - runtime artifacts (interviewClips, responseContent): questionIndex 0..3,
//     matching the scorer ("runtime artifacts ... are 0-based")
//   - Storage file names: q1..q4 (recorder spec "q{N}")
// Everything below takes and returns the 0-based runtime index, and converts
// only where the other base is required.

export const INT_QUESTION_COUNT = 4
export const RESPONSE_MS = 45000        // recorder spec: 45 s per question
export const TRANSITION_MS = 1500       // spec: "roughly 1-2 seconds"
export const MIN_RESPONSE_MS = 1000     // JC 2026-09-18: 1 s minimum

// data model v1.18: clients find a clip by role + index, never by position.
export function findAudioClip(item, role, index1 = null) {
  const clips = item?.audio?.clips
  if (!Array.isArray(clips)) return null
  return clips.find((c) => c && c.role === role && (c.index ?? null) === index1) ?? null
}

// The intro plus all four questions must exist before the interview can run.
// This mirrors the serving rule (v1.18: an audio-type item is not shown while
// `audio` is null), in case an item reaches this screen anyway.
export function missingAudio(item) {
  const missing = []
  if (!findAudioClip(item, 'intro')) missing.push('intro')
  for (let n = 1; n <= INT_QUESTION_COUNT; n++) {
    if (!findAudioClip(item, 'question', n)) missing.push(`question ${n}`)
  }
  return missing
}

// Resume point: the first question without an uploaded clip, or null when all
// four are uploaded (then the attempt only needs its submission).
export function nextQuestionIndex(interviewClips) {
  const have = new Set((interviewClips ?? []).filter((c) => c && c.storagePath).map((c) => c.questionIndex))
  for (let i = 0; i < INT_QUESTION_COUNT; i++) if (!have.has(i)) return i
  return null
}

// Replace (never append a duplicate) the entry for one question; keep order.
// A re-recorded question after a mic failure overwrites its earlier entry.
export function upsertClip(interviewClips, entry) {
  const rest = (interviewClips ?? []).filter((c) => c && c.questionIndex !== entry.questionIndex)
  return [...rest, entry].sort((a, b) => a.questionIndex - b.questionIndex)
}

export function extensionFor(mimeType) {
  if (/mp4|aac|m4a/.test(mimeType)) return 'mp4'
  if (/ogg/.test(mimeType)) return 'ogg'
  if (/wav/.test(mimeType)) return 'wav'
  return 'webm'
}

// Recorder spec: audio/{b10Id}/toefl_{attemptId}/q{N}.<format>. The existing
// Storage rule allows a signed-in user with a b10Id claim to write under audio/.
export function clipStoragePath(studentId, attemptId, questionIndex, mimeType) {
  return `audio/${studentId}/toefl_${attemptId}/q${questionIndex + 1}.${extensionFor(mimeType)}`
}

// The attempt's interviewClips entry (Collection 2 shape). transcriptStatus
// starts 'pending': transcription happens server-side, and the scorer refuses
// anything that is not 'complete' with a transcript.
export function clipEntry(questionIndex, storagePath, durationMs) {
  return {
    questionIndex,
    storagePath,
    durationSeconds: Math.round(durationMs / 100) / 10,
    transcriptStatus: 'pending',
  }
}

// The toeflSubmissions document, created once all four clips are uploaded
// (Collection 3 INT shape: {transcripts, audioClips}). transcripts is empty:
// the client cannot transcribe. Only fields the create rule allows.
export function buildSubmission({ attemptId, studentId, interviewClips }) {
  const audioClips = [...interviewClips]
    .sort((a, b) => a.questionIndex - b.questionIndex)
    .map(({ questionIndex, storagePath, durationSeconds }) => ({ questionIndex, storagePath, durationSeconds }))
  if (audioClips.length !== INT_QUESTION_COUNT || audioClips.some((c, i) => c.questionIndex !== i || !c.storagePath)) {
    throw new Error(`cannot submit: expected clips for questions 0-3, have ${JSON.stringify(audioClips.map((c) => c.questionIndex))}`)
  }
  return {
    attemptId,
    studentId,
    taskType: 'INT',
    responseContent: { transcripts: [], audioClips },
    scoringStatus: 'queued',
    scoredAt: null,
  }
}
