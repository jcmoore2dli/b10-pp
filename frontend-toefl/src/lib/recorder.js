// src/lib/recorder.js
// Framework-free microphone recorder behind hooks/useRecorder.js. It lives here,
// not in the hook, so it can be tested in Node against a fake MediaRecorder
// (scripts/testToeflRecorder.mjs).
//
// Extends B10-PP's frontend/src/hooks/useRecorder.js with what the TOEFL
// Interview and LAR recorder specs need:
//   - pause() / resume(), so the LAR trainer's replay never reaches the
//     student's recording. MediaRecorder's own pause() gives one continuous
//     file with the paused stretch left out (LAR_Recorder_Spec_v1_3).
//   - Recorded time, not wall time. getRecordedMs() excludes paused stretches,
//     which puts it on the same timeline as the audio file and therefore as the
//     word times Deepgram returns. LAR's responseBoundaries must be on that
//     timeline, or every boundary after a replay would be late by the length of
//     the replay.
//   - An optional auto-stop at maxDurationMs of recorded time (Interview: 45 s
//     per clip). Pass null for no cap: LAR's 45 s is per response window, so
//     the LAR screen runs its own countdowns.
//   - A minimum-length check. The result carries tooShort / empty; the screen
//     decides whether to allow submission.
//   - Mic released on every path: stop, auto-stop, dispose (unmount), and a
//     failed start. B10-PP's hook released it only on an explicit stop, so
//     leaving the screen mid-recording left the microphone on.
//   - The finished recording is kept until discard() or the next start(), so a
//     failed upload can be retried without re-recording.
//
// Timing is taken from MediaRecorder's own start/pause/resume events rather
// than the calls, which is closer to when audio actually begins and stops being
// written.

export const RECORDER_ERRORS = {
  unsupported: 'Recording is not supported in this browser. Please use an up-to-date Chrome, Edge or Safari.',
  insecure: 'Recording needs a secure (https) connection.',
  denied: 'Microphone access was denied. Please allow microphone access and try again.',
  noMic: 'No microphone was found. Please connect one and try again.',
  busy: 'Your microphone is being used by another application. Please close it and try again.',
  failed: 'Could not start recording. Please check your microphone and try again.',
}

// Same order as B10-PP: mp4/AAC first for iOS Safari, then webm/opus for Chrome.
const MIME_PREFERENCE = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']

function errorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError': return RECORDER_ERRORS.denied
    case 'SecurityError': return RECORDER_ERRORS.insecure
    case 'NotFoundError':
    case 'OverconstrainedError': return RECORDER_ERRORS.noMic
    case 'NotReadableError':
    case 'AbortError': return RECORDER_ERRORS.busy
    default: return RECORDER_ERRORS.failed
  }
}

// env is injectable for tests: { mediaDevices, MediaRecorder, now, setTimeout, clearTimeout }.
export function createRecorder({ maxDurationMs = 45000, minDurationMs = 1000, onAutoStop, onChange, env } = {}) {
  const E = env ?? {
    mediaDevices: globalThis.navigator?.mediaDevices,
    MediaRecorder: globalThis.MediaRecorder,
    now: () => globalThis.performance.now(),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
  }

  let state = 'idle'            // idle | starting | recording | paused | stopping
  let mr = null, stream = null, chunks = []
  let startedAt = null          // now() at MediaRecorder 'start'
  let pausedTotal = 0           // ms spent paused, completed pauses
  let pausedAt = null           // now() at the current 'pause', if paused
  let autoTimer = null
  let stopPromise = null
  let kept = null               // last finished recording, kept for retry
  let lastError = null
  let generation = 0            // bumped by dispose(); a start() awaiting the mic checks it

  const snapshot = () => ({ state, error: lastError, hasRecording: kept !== null })
  const emit = () => onChange?.(snapshot())
  const set = (s) => { state = s; emit() }

  function getRecordedMs() {
    if (startedAt === null) return 0
    const t = E.now()
    return Math.max(0, t - startedAt - pausedTotal - (pausedAt !== null ? t - pausedAt : 0))
  }

  function clearAuto() { if (autoTimer !== null) { E.clearTimeout(autoTimer); autoTimer = null } }
  function armAuto() {
    clearAuto()
    if (maxDurationMs == null) return
    const left = maxDurationMs - getRecordedMs()
    autoTimer = E.setTimeout(async () => {
      autoTimer = null
      if (state !== 'recording') return
      const result = await stop()
      if (result) onAutoStop?.(result)
    }, Math.max(0, left))
  }

  function releaseMic() {
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
  }

  const isSupported = () => Boolean(E.mediaDevices?.getUserMedia && E.MediaRecorder)
  const pauseSupported = () => Boolean(E.MediaRecorder && typeof E.MediaRecorder.prototype?.pause === 'function')

  async function start() {
    if (state !== 'idle') return { success: false, error: 'A recording is already in progress.' }
    lastError = null
    if (!isSupported()) { lastError = RECORDER_ERRORS.unsupported; emit(); return { success: false, error: lastError } }
    kept = null   // a new recording replaces the kept one; upload or discard it first
    set('starting')
    const gen = generation
    try {
      const s = await E.mediaDevices.getUserMedia({ audio: true })
      if (gen !== generation) {   // disposed while the permission prompt was open
        s.getTracks().forEach((t) => t.stop())
        return { success: false, error: RECORDER_ERRORS.failed }
      }
      stream = s
      const mimeType = MIME_PREFERENCE.find((m) => E.MediaRecorder.isTypeSupported?.(m)) || ''
      mr = mimeType ? new E.MediaRecorder(stream, { mimeType }) : new E.MediaRecorder(stream)
      chunks = []; startedAt = null; pausedTotal = 0; pausedAt = null; stopPromise = null
      mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data) }
      await new Promise((resolve, reject) => {
        mr.onstart = () => { startedAt = E.now(); resolve() }
        mr.onerror = (e) => reject(e.error || e)
        mr.start()
      })
      mr.onerror = null
      mr.onpause = () => { pausedAt = E.now() }
      mr.onresume = () => { if (pausedAt !== null) { pausedTotal += E.now() - pausedAt; pausedAt = null } }
      set('recording')
      armAuto()
      return { success: true, error: null }
    } catch (err) {
      releaseMic(); mr = null
      lastError = errorMessage(err)
      set('idle')
      return { success: false, error: lastError }
    }
  }

  // Pause and resume update state straight away; the recorded clock follows
  // MediaRecorder's own pause/resume events.
  function pause() {
    if (state !== 'recording' || !pauseSupported()) return false
    clearAuto()
    mr.pause()
    set('paused')
    return true
  }
  function resume() {
    if (state !== 'paused') return false
    mr.resume()
    set('recording')
    armAuto()
    return true
  }

  // Resolves to the finished recording, or null if nothing was recording.
  // Concurrent calls (the Stop button racing the auto-stop) share one promise.
  function stop() {
    if (stopPromise) return stopPromise
    if (state !== 'recording' && state !== 'paused') return Promise.resolve(null)
    clearAuto()
    if (pausedAt !== null) { pausedTotal += E.now() - pausedAt; pausedAt = null }
    const durationMs = Math.round(getRecordedMs())
    set('stopping')
    stopPromise = new Promise((resolve) => {
      mr.onstop = () => {
        const mimeType = (mr.mimeType || 'audio/webm').split(';')[0]
        const blob = new Blob(chunks, { type: mimeType })
        releaseMic()
        mr = null; chunks = []; startedAt = null
        kept = { blob, mimeType, durationMs, sizeBytes: blob.size,
                 empty: blob.size === 0, tooShort: blob.size === 0 || durationMs < minDurationMs }
        stopPromise = null
        set('idle')
        resolve(kept)
      }
      mr.stop()
    })
    return stopPromise
  }

  function discard() { kept = null; emit() }

  // Unmount: stop without keeping anything, and always free the microphone.
  // It is a full reset, not a shutdown: React StrictMode unmounts and remounts
  // every screen once in development, and the recorder has to work afterwards.
  function dispose() {
    generation++
    clearAuto()
    if (mr && mr.state !== 'inactive') { mr.onstop = null; try { mr.stop() } catch { /* already stopped */ } }
    releaseMic()
    mr = null; chunks = []; kept = null; stopPromise = null
    startedAt = null; pausedTotal = 0; pausedAt = null; lastError = null
    state = 'idle'
  }

  return {
    start, pause, resume, stop, discard, dispose, getRecordedMs,
    getRecording: () => kept,
    getState: () => state,
    isSupported, pauseSupported,
  }
}
