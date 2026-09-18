// src/lib/larFlow.js
// Listen and Repeat (LAR) recorder rules, kept out of the component so they
// can be tested in Node (scripts/testToeflLarFlow.mjs). Sources:
// TOEFL_LAR_Recorder_Spec_v1_3, data model v1.18 (Collection 3 LAR shape,
// Appendix B), and the comparer's boundary contract in
// functions/lib/lar/contract.js, mirrored here so a bad boundary is caught in
// the browser instead of failing at scoring.
//
// TIMELINE: every boundary is in RECORDED milliseconds (hooks/useRecorder
// getRecordedMs), i.e. the audio file's own clock and Deepgram's. With the mic
// paused during trainer playback, windows sit back to back on that timeline.
// Without pause support the trainer audio is in the file between windows, and
// the comparer's segmentation excludes it as orphans. Both are valid.
//
// INDEX BASE: utteranceIndex is 1-based everywhere (item, audio clips,
// boundaries, comparer), so nothing converts here.

import { findAudioClip, extensionFor } from './interviewFlow.js'   // explicit extension: this file is also loaded by Node tests

export const LAR_UTTERANCE_COUNT = 7
export const LAR_RESPONSE_MS = 45000     // spec: 45 s per response window, replay included
export const LAR_MIN_RESPONSE_MS = 1000  // JC 2026-09-18: 1 s minimum (per window here)

export function missingLarAudio(item) {
  const missing = []
  if (!findAudioClip(item, 'intro')) missing.push('intro')
  for (let n = 1; n <= LAR_UTTERANCE_COUNT; n++) {
    if (!findAudioClip(item, 'utterance', n)) missing.push(`utterance ${n}`)
  }
  return missing
}

// Integer ms, as the contract requires ("a float here means seconds leaked").
export function makeBoundary(utteranceIndex, startMs, endMs) {
  return { utteranceIndex, responseStartMs: Math.round(startMs), responseEndMs: Math.round(endMs) }
}

// Same rules as functions/lib/lar/contract.js assertContract, plus: every
// window inside the recording. Returns a list of problems (empty = valid).
export function boundaryProblems(boundaries, recordingMs) {
  const p = []
  if (!Array.isArray(boundaries) || boundaries.length !== LAR_UTTERANCE_COUNT) {
    return [`expected ${LAR_UTTERANCE_COUNT} boundaries, got ${Array.isArray(boundaries) ? boundaries.length : 'none'}`]
  }
  const idx = boundaries.map((b) => b.utteranceIndex)
  if (idx.join() !== [1, 2, 3, 4, 5, 6, 7].join()) p.push(`utteranceIndex must be 1..7 in order, got ${idx.join(',')}`)
  boundaries.forEach((b, i) => {
    if (!Number.isInteger(b.responseStartMs) || !Number.isInteger(b.responseEndMs)) p.push(`utterance ${b.utteranceIndex}: not integer ms`)
    if (!(b.responseStartMs < b.responseEndMs)) p.push(`utterance ${b.utteranceIndex}: start ${b.responseStartMs} not before end ${b.responseEndMs}`)
    if (b.responseStartMs < 0) p.push(`utterance ${b.utteranceIndex}: negative start`)
    if (i > 0 && b.responseStartMs < boundaries[i - 1].responseEndMs) p.push(`utterance ${b.utteranceIndex} overlaps the previous window`)
  })
  if (typeof recordingMs === 'number' && boundaries[boundaries.length - 1].responseEndMs > recordingMs + 50) {
    // 50 ms tolerance: the recorder's stop lands a moment after the last window closes.
    p.push(`last window ends at ${boundaries[boundaries.length - 1].responseEndMs} ms, after the recording (${recordingMs} ms)`)
  }
  return p
}

// LAR recorder spec: audio/{b10Id}/toefl_{attemptId}/lar.<format>
export function larStoragePath(studentId, attemptId, mimeType) {
  return `audio/${studentId}/toefl_${attemptId}/lar.${extensionFor(mimeType)}`
}

// Collection 3 LAR shape: {audioClip: {storagePath, durationSeconds},
// transcript, responseBoundaries}. transcript, wordTimings and sttMeta are
// written server-side by the transcription step.
export function buildLarSubmission({ attemptId, studentId, storagePath, durationMs, boundaries }) {
  const problems = boundaryProblems(boundaries, durationMs)
  if (problems.length) throw new Error(`cannot submit LAR: ${problems.join('; ')}`)
  return {
    attemptId,
    studentId,
    taskType: 'LAR',
    responseContent: {
      audioClip: { storagePath, durationSeconds: Math.round(durationMs / 100) / 10 },
      responseBoundaries: boundaries,
    },
    scoringStatus: 'queued',
    scoredAt: null,
  }
}
