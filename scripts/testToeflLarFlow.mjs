#!/usr/bin/env node
// scripts/testToeflLarFlow.mjs
// Tests frontend-toefl/src/lib/larFlow.js, and checks its boundary rules
// agree with the comparer's own contract (functions/lib/lar/contract.js):
// anything the browser accepts, the comparer must accept. The browser is
// stricter in one place only (it requires 1..7 in order; the comparer sorts).
// Run: node scripts/testToeflLarFlow.mjs

import { createRequire } from 'module'
import { missingLarAudio, makeBoundary, boundaryProblems, larStoragePath, buildLarSubmission } from '../frontend-toefl/src/lib/larFlow.js'
const require = createRequire(import.meta.url)
const { assertContract } = require('../functions/lib/lar/contract.js')

let passes = 0, failures = 0
const ok = (c, m) => { if (c) passes++; else { failures++; console.log('  FAIL:', m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)}`)
const TARGETS = [1, 2, 3, 4, 5, 6, 7].map((i) => `Sentence ${i}.`)
const comparerAccepts = (b) => { try { assertContract(b, TARGETS); return true } catch { return false } }

console.log('audio lookup')
const item = { audio: { clips: [{ role: 'intro', index: null, storagePath: 'i' }, ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ role: 'utterance', index: n, storagePath: `u${n}` }))] } }
eq(missingLarAudio(item), [], 'complete')
eq(missingLarAudio({ audio: { clips: item.audio.clips.filter((c) => c.index !== 5) } }), ['utterance 5'], 'one missing')
eq(missingLarAudio({}), ['intro', 'utterance 1', 'utterance 2', 'utterance 3', 'utterance 4', 'utterance 5', 'utterance 6', 'utterance 7'], 'no audio')

console.log('boundaries: rounding and validity, agreeing with the comparer')
eq(makeBoundary(3, 2999.6, 5500.4), { utteranceIndex: 3, responseStartMs: 3000, responseEndMs: 5500 }, 'rounded to integer ms')
// Paused design: windows back to back on the recorded timeline.
const paused = [[0, 3000], [3000, 5500], [5500, 10500], [10500, 12000], [12000, 15000], [15000, 18000], [18000, 21000]]
  .map(([s, e], i) => makeBoundary(i + 1, s, e))
eq(boundaryProblems(paused, 21000), [], 'back-to-back windows valid')
ok(comparerAccepts(paused), 'comparer accepts the same')
// Unpaused fallback: gaps (trainer audio) between windows.
const unpaused = paused.map((b, i) => ({ ...b, responseStartMs: b.responseStartMs + i * 4000 + 4000, responseEndMs: b.responseEndMs + i * 4000 + 4000 }))
eq(boundaryProblems(unpaused, 60000), [], 'windows with gaps valid')
ok(comparerAccepts(unpaused), 'comparer accepts the same')
const bad = {
  overlap: paused.map((b, i) => (i === 2 ? { ...b, responseStartMs: 5400 } : b)),
  float: paused.map((b, i) => (i === 0 ? { ...b, responseEndMs: 3000.5 } : b)),
  zeroLength: paused.map((b, i) => (i === 6 ? { ...b, responseEndMs: 18000 } : b)),
  six: paused.slice(0, 6),
  order: [paused[1], paused[0], ...paused.slice(2)],
}
for (const [name, b] of Object.entries(bad)) {
  ok(boundaryProblems(b, 60000).length > 0, `${name}: browser rejects`)
  // The comparer sorts by utteranceIndex itself, so it accepts an unordered
  // list; the browser is deliberately stricter (it always produces 1..7 in
  // order). The safe direction holds: browser-accepted is a subset of
  // comparer-accepted.
  if (name === 'order') ok(comparerAccepts(b), 'order: comparer accepts (sorts itself); browser stricter')
  else ok(!comparerAccepts(b), `${name}: comparer also rejects`)
}
ok(boundaryProblems(paused, 20000).some((p) => /after the recording/.test(p)), 'window past the end of the recording rejected')
eq(boundaryProblems(paused, 20960), [], 'within 50 ms stop tolerance accepted')

console.log('storage path and submission')
eq(larStoragePath('B10-7', 'att9', 'audio/webm'), 'audio/B10-7/toefl_att9/lar.webm', 'spec path, webm')
eq(larStoragePath('B10-7', 'att9', 'audio/mp4'), 'audio/B10-7/toefl_att9/lar.mp4', 'spec path, Safari mp4')
const sub = buildLarSubmission({ attemptId: 'att9', studentId: 'B10-7', storagePath: 'p', durationMs: 21034, boundaries: paused })
eq(Object.keys(sub).sort(), ['attemptId', 'responseContent', 'scoredAt', 'scoringStatus', 'studentId', 'taskType'], 'only rule-allowed fields')
eq(sub.responseContent, { audioClip: { storagePath: 'p', durationSeconds: 21 }, responseBoundaries: paused }, 'Collection 3 LAR shape')
eq([sub.taskType, sub.scoringStatus], ['LAR', 'queued'], 'LAR, queued')
let threw = false
try { buildLarSubmission({ attemptId: 'a', studentId: 's', storagePath: 'p', durationMs: 20000, boundaries: bad.overlap }) } catch { threw = true }
ok(threw, 'refuses to submit invalid boundaries')

console.log(`\n${passes} passed, ${failures} failed`)
process.exit(failures ? 1 : 0)
