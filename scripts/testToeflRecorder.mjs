#!/usr/bin/env node
// scripts/testToeflRecorder.mjs
// Tests frontend-toefl/src/lib/recorder.js (the logic behind useRecorder)
// against a fake MediaRecorder and a fake clock. MediaRecorder events fire
// asynchronously, as in a browser. Run: node scripts/testToeflRecorder.mjs

import { createRecorder, RECORDER_ERRORS } from '../frontend-toefl/src/lib/recorder.js'

let failures = 0, passes = 0
const ok = (cond, msg) => { if (cond) passes++; else { failures++; console.log('  FAIL:', msg) } }
const tick = () => new Promise((r) => setImmediate(r))   // let queued events run

function makeEnv({ gumError = null, ctorError = null, pause = true, emptyData = false, gumDelay = null } = {}) {
  let now = 0, timers = [], nextId = 1
  const tracks = []
  const env = {
    now: () => now,
    setTimeout: (fn, ms) => { const id = nextId++; timers.push({ id, at: now + ms, fn }); return id },
    clearTimeout: (id) => { timers = timers.filter((t) => t.id !== id) },
    mediaDevices: {
      getUserMedia: async () => {
        if (gumDelay) await gumDelay
        if (gumError) { const e = new Error(gumError); e.name = gumError; throw e }
        const track = { stopped: false, stop() { this.stopped = true } }
        tracks.push(track)
        return { getTracks: () => [track] }
      },
    },
  }
  class FakeMR {
    static isTypeSupported(m) { return m === 'audio/webm;codecs=opus' }
    constructor(stream, opts) {
      if (ctorError) throw Object.assign(new Error(ctorError), { name: ctorError })
      this.stream = stream; this.mimeType = opts?.mimeType || 'audio/webm'; this.state = 'inactive'
    }
    start() { this.state = 'recording'; queueMicrotask(() => this.onstart?.()) }
    stop() {
      this.state = 'inactive'
      queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(emptyData ? [] : ['audio-bytes']) }); this.onstop?.() })
    }
    resume() { this.state = 'recording'; queueMicrotask(() => this.onresume?.()) }
  }
  if (pause) FakeMR.prototype.pause = function () { this.state = 'paused'; queueMicrotask(() => this.onpause?.()) }
  env.MediaRecorder = FakeMR
  env.advance = async (ms) => {        // move the clock, firing due timers in order
    const target = now + ms
    for (;;) {
      timers.sort((a, b) => a.at - b.at)
      const t = timers[0]
      if (!t || t.at > target) break
      timers.shift(); now = t.at; t.fn(); await tick(); await tick()
    }
    now = target; await tick()
  }
  env.tracks = tracks
  return env
}

async function test(name, fn) { console.log(name); await fn() }

await test('1. start/stop: duration, mic released, recording kept', async () => {
  const env = makeEnv(); const r = createRecorder({ env })
  ok((await r.start()).success, 'start succeeds')
  ok(r.getState() === 'recording', 'state recording')
  await env.advance(3000)
  const res = await r.stop()
  ok(res.durationMs === 3000, `durationMs 3000 (got ${res.durationMs})`)
  ok(res.mimeType === 'audio/webm' && res.blob.size > 0, 'blob with base mime type')
  ok(!res.tooShort && !res.empty, 'not too short, not empty')
  ok(env.tracks.every((t) => t.stopped), 'mic released on stop')
  ok(r.getRecording() === res && r.getState() === 'idle', 'recording kept; idle')
})

await test('2. pause/resume: paused time excluded from the recorded clock', async () => {
  const env = makeEnv(); const r = createRecorder({ env, maxDurationMs: null })
  await r.start(); await env.advance(2000)
  ok(r.pause(), 'pause() true'); await tick()
  ok(r.getState() === 'paused', 'state paused')
  await env.advance(5000)
  ok(r.getRecordedMs() === 2000, `recorded clock frozen while paused (got ${r.getRecordedMs()})`)
  ok(r.resume(), 'resume() true'); await tick()
  await env.advance(3000)
  ok(r.getRecordedMs() === 5000, `recorded 5000 after resume (got ${r.getRecordedMs()})`)
  const res = await r.stop()
  ok(res.durationMs === 5000, `durationMs excludes the pause (got ${res.durationMs})`)
})

await test('3. auto-stop at 45 s of RECORDED time, across a pause', async () => {
  const env = makeEnv(); let auto = []
  const r = createRecorder({ env, onAutoStop: (x) => auto.push(x) })
  await r.start(); await env.advance(20000)
  r.pause(); await tick(); await env.advance(10000)
  r.resume(); await tick()
  await env.advance(24999)
  ok(auto.length === 0 && r.getState() === 'recording', 'still recording at 44.999 s recorded')
  await env.advance(1)
  ok(auto.length === 1, 'onAutoStop fired once')
  ok(auto[0]?.durationMs === 45000, `auto-stopped at 45000 recorded ms (got ${auto[0]?.durationMs})`)
  ok(env.tracks.every((t) => t.stopped) && r.getState() === 'idle', 'mic released, idle')
})

await test('4. Stop tap racing the auto-stop: one stop, same result', async () => {
  const env = makeEnv(); let auto = []
  const r = createRecorder({ env, maxDurationMs: 1000, onAutoStop: (x) => auto.push(x) })
  await r.start(); await env.advance(999)
  const p = r.stop()                 // student taps Stop
  await env.advance(1)               // cap reached during the stop
  const res = await p
  ok(res && res.durationMs === 999, 'manual stop result kept')
  ok(auto.length === 0, 'auto-stop timer cleared by the manual stop')
  ok(r.stop() instanceof Promise, 'second stop returns a promise')
  ok((await r.stop()) === null, 'stop when idle -> null')
})

await test('5. minimum length and empty recordings', async () => {
  let env = makeEnv(); let r = createRecorder({ env, minDurationMs: 1000 })
  await r.start(); await env.advance(500)
  let res = await r.stop()
  ok(res.tooShort && !res.empty, '500 ms -> tooShort')
  env = makeEnv({ emptyData: true }); r = createRecorder({ env })
  await r.start(); await env.advance(5000)
  res = await r.stop()
  ok(res.empty && res.tooShort, 'no audio data -> empty and tooShort, even at 5 s')
})

await test('6. start errors map to specific messages; mic never left on', async () => {
  const cases = [['NotAllowedError', RECORDER_ERRORS.denied], ['NotFoundError', RECORDER_ERRORS.noMic],
                 ['NotReadableError', RECORDER_ERRORS.busy], ['SecurityError', RECORDER_ERRORS.insecure],
                 ['WeirdError', RECORDER_ERRORS.failed]]
  for (const [name, msg] of cases) {
    const env = makeEnv({ gumError: name }); const r = createRecorder({ env })
    const out = await r.start()
    ok(!out.success && out.error === msg && r.getState() === 'idle', `${name} -> its message, idle`)
  }
  const env = makeEnv({ ctorError: 'NotSupportedError' }); const r = createRecorder({ env })
  const out = await r.start()
  ok(!out.success && env.tracks.length === 1 && env.tracks[0].stopped, 'MediaRecorder constructor fails -> mic released')
  const bare = createRecorder({ env: { ...makeEnv(), MediaRecorder: undefined } })
  ok((await bare.start()).error === RECORDER_ERRORS.unsupported, 'no MediaRecorder -> unsupported')
})

await test('7. dispose (unmount) mid-recording: mic released; recorder reusable (StrictMode remount)', async () => {
  const env = makeEnv(); const r = createRecorder({ env })
  await r.start(); await env.advance(2000)
  r.dispose()
  ok(env.tracks[0].stopped, 'mic released on dispose')
  ok(r.getState() === 'idle' && r.getRecording() === null, 'idle, nothing kept')
  ok((await r.start()).success, 'start works again after dispose')
  await env.advance(1500)
  ok((await r.stop()).durationMs === 1500, 'fresh timing after reuse')
})

await test('8. dispose while the permission prompt is open: mic released when it resolves', async () => {
  let release; const gate = new Promise((res) => { release = res })
  const env = makeEnv({ gumDelay: gate }); const r = createRecorder({ env })
  const p = r.start()
  r.dispose(); release(); const out = await p
  ok(!out.success, 'start reports failure')
  ok(env.tracks.length === 1 && env.tracks[0].stopped, 'late-granted mic stopped immediately')
})

await test('9. kept recording survives until discard; next start replaces it', async () => {
  const env = makeEnv(); const r = createRecorder({ env })
  await r.start(); await env.advance(2000); const first = await r.stop()
  ok(r.getRecording() === first, 'kept after stop (upload failed -> retry uses this)')
  r.discard(); ok(r.getRecording() === null, 'discard clears it')
  await r.start(); await env.advance(2000); await r.stop()
  await r.start(); ok(r.getRecording() === null, 'start clears any kept recording')
})

await test('10. maxDurationMs null: no auto-stop; pause unsupported -> pause() false', async () => {
  let env = makeEnv(); let r = createRecorder({ env, maxDurationMs: null })
  await r.start(); await env.advance(600000)
  ok(r.getState() === 'recording', 'still recording after 10 minutes')
  env = makeEnv({ pause: false }); r = createRecorder({ env })
  await r.start()
  ok(!r.pauseSupported() && r.pause() === false && r.getState() === 'recording', 'pause refused, keeps recording')
})

await test('11. LAR-style boundaries line up with the audio timeline across replays', async () => {
  // Simulates 3 cycles: trainer plays (mic paused), student responds (window timed).
  const env = makeEnv(); const r = createRecorder({ env, maxDurationMs: null })
  const bounds = []
  await r.start(); r.pause(); await tick()        // trainer line 1 plays; nothing recorded yet
  await env.advance(4000)
  for (const [i, respond, replay] of [[1, 3000, 0], [2, 2500, 4000], [3, 5000, 0]]) {
    if (replay) { r.pause(); await tick(); await env.advance(replay); r.resume(); await tick() }
    else if (i > 1) { r.pause(); await tick(); await env.advance(4000); r.resume(); await tick() }
    else { r.resume(); await tick() }
    const s = r.getRecordedMs(); await env.advance(respond); const e = r.getRecordedMs()
    bounds.push({ utteranceIndex: i, responseStartMs: s, responseEndMs: e })
  }
  const res = await r.stop()
  ok(JSON.stringify(bounds.map((b) => [b.responseStartMs, b.responseEndMs])) === JSON.stringify([[0, 3000], [3000, 5500], [5500, 10500]]),
     `boundaries contiguous on the audio timeline: ${JSON.stringify(bounds.map((b) => [b.responseStartMs, b.responseEndMs]))}`)
  ok(res.durationMs === 10500, `file length = sum of response windows (got ${res.durationMs})`)
})

console.log(`\n${passes} passed, ${failures} failed`)
process.exit(failures ? 1 : 0)
