#!/usr/bin/env node
// scripts/testToeflInterviewFlow.mjs
// Tests frontend-toefl/src/lib/interviewFlow.js: resume point, clip upsert,
// Storage paths, index bases, audio lookup, submission shape.
// Run: node scripts/testToeflInterviewFlow.mjs

import {
  findAudioClip, missingAudio, nextQuestionIndex, upsertClip, clipStoragePath,
  clipEntry, buildSubmission, extensionFor,
} from '../frontend-toefl/src/lib/interviewFlow.js'

let failures = 0, passes = 0
const ok = (cond, msg) => { if (cond) passes++; else { failures++; console.log('  FAIL:', msg) } }
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}`)

const item = { audio: { clips: [
  { role: 'intro', index: null, storagePath: 'audio/toefl/int/INT-001/INT-001_intro.mp3' },
  ...[1, 2, 3, 4].map((n) => ({ role: 'question', index: n, storagePath: `audio/toefl/int/INT-001/INT-001_q${n}.mp3` })),
] } }

console.log('audio lookup (v1.18: role + index, 1-based questions)')
eq(findAudioClip(item, 'question', 3)?.storagePath, 'audio/toefl/int/INT-001/INT-001_q3.mp3', 'question 3')
eq(findAudioClip(item, 'intro')?.storagePath, 'audio/toefl/int/INT-001/INT-001_intro.mp3', 'intro')
eq(findAudioClip(item, 'question', 0), null, 'no question 0')
eq(missingAudio(item), [], 'complete item')
eq(missingAudio({ audio: null }), ['intro', 'question 1', 'question 2', 'question 3', 'question 4'], 'audio null')
eq(missingAudio({ audio: { clips: item.audio.clips.filter((c) => c.index !== 2) } }), ['question 2'], 'one missing')

console.log('resume point')
eq(nextQuestionIndex([]), 0, 'fresh attempt -> Q1 (index 0)')
eq(nextQuestionIndex(undefined), 0, 'no field -> index 0')
eq(nextQuestionIndex([{ questionIndex: 0, storagePath: 'a' }, { questionIndex: 1, storagePath: 'b' }]), 2, 'left after Q2 -> resume at Q3')
eq(nextQuestionIndex([{ questionIndex: 0, storagePath: 'a' }, { questionIndex: 2, storagePath: 'c' }]), 1, 'gap -> first missing')
eq(nextQuestionIndex([0, 1, 2, 3].map((i) => ({ questionIndex: i, storagePath: 'x' }))), null, 'all four -> null (submit only)')
eq(nextQuestionIndex([{ questionIndex: 0, storagePath: null }]), 0, 'entry without a path does not count')

console.log('clip upsert')
let clips = upsertClip([], clipEntry(1, 'p1', 12345))
clips = upsertClip(clips, clipEntry(0, 'p0', 5000))
eq(clips.map((c) => c.questionIndex), [0, 1], 'sorted by index')
clips = upsertClip(clips, clipEntry(1, 'p1-retry', 8000))
eq(clips.length, 2, 're-record replaces, no duplicate')
eq(clips[1], { questionIndex: 1, storagePath: 'p1-retry', durationSeconds: 8, transcriptStatus: 'pending' }, 'replaced entry')
eq(clipEntry(3, 'p', 44987).durationSeconds, 45, 'duration rounded to 0.1 s')

console.log('Storage paths (spec: audio/{b10Id}/toefl_{attemptId}/q{N}, N 1-based)')
eq(clipStoragePath('B10-7', 'att1', 0, 'audio/webm'), 'audio/B10-7/toefl_att1/q1.webm', 'Chrome webm, first question')
eq(clipStoragePath('B10-7', 'att1', 3, 'audio/mp4'), 'audio/B10-7/toefl_att1/q4.mp4', 'Safari mp4, fourth question')
eq(extensionFor('audio/ogg'), 'ogg', 'ogg')

console.log('submission')
const four = [3, 1, 0, 2].map((i) => clipEntry(i, `audio/B10-7/toefl_att1/q${i + 1}.webm`, 30000))
const sub = buildSubmission({ attemptId: 'att1', studentId: 'B10-7', interviewClips: four })
eq(sub.responseContent.audioClips.map((c) => c.questionIndex), [0, 1, 2, 3], 'audioClips ordered 0..3')
eq(Object.keys(sub).sort(), ['attemptId', 'responseContent', 'scoredAt', 'scoringStatus', 'studentId', 'taskType'], 'only rule-allowed fields')
eq([sub.taskType, sub.scoringStatus, sub.scoredAt, sub.responseContent.transcripts], ['INT', 'queued', null, []], 'INT, queued, no transcripts')
let threw = false
try { buildSubmission({ attemptId: 'a', studentId: 's', interviewClips: four.slice(0, 3) }) } catch { threw = true }
ok(threw, 'refuses to submit with fewer than four clips')

console.log(`\n${passes} passed, ${failures} failed`)
process.exit(failures ? 1 : 0)
