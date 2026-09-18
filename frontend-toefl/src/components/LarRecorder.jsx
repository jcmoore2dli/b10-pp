// src/components/LarRecorder.jsx
// Listen and Repeat (LAR): seven sentences, ONE continuous recording, with the
// seven response windows timed as responseBoundaries. Per
// TOEFL_LAR_Recorder_Spec_v1_3:
//   - The trainer's sentence plays; the student repeats it. The sentence text
//     is never shown (heard-only, data model v1.18). The item's introduction is
//     shown, being both heard and printed.
//   - 45 s per response window. The clock starts when the sentence's FIRST play
//     ends and keeps running through an optional single replay, so a replay
//     costs response time and can't be used as preparation time.
//   - The mic is paused during every trainer playback (each sentence's first
//     play after the first, and every replay), so the trainer's voice never
//     enters the recording.
//   - responseBoundaries: [{utteranceIndex, responseStartMs, responseEndMs}]
//     on the RECORDING's own timeline (useRecorder.getRecordedMs, paused time
//     excluded). That is the timeline of Deepgram's word timings, which the
//     comparer segments with these boundaries.
//   - After sentence 7: upload once, then create the submission ('queued').
//
// Choices made here, not in the spec (flagged in the commit):
//   - "Done" ends a window early once 1 s has been recorded in it.
//   - The replay is offered once per sentence, at any point in the window.
//   - No tone before a window opens (Interview has one; LAR's spec does not).
//   - No resume mid-set: a continuous recording can't survive a reload, so a
//     reopened attempt starts again from sentence 1. A lost mic mid-set does
//     the same.
//   - Browsers without MediaRecorder pause: the recording runs straight
//     through, so trainer audio sits between the windows. The comparer's
//     segmentation excludes it as orphans; that is the design deepgramSTT's LAR
//     note describes.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where,
} from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { db, storage } from '../services/firebase'
import { useAuth } from '../context/useAuth'
import { useRecorder } from '../hooks/useRecorder'
import { useAudioPlayer, useMicCheck } from '../hooks/audioPlayback'
import { MicCheck, Shell, Button, Center } from './recorderUi'
import { findAudioClip } from '../lib/interviewFlow'
import {
  LAR_UTTERANCE_COUNT, LAR_RESPONSE_MS, LAR_MIN_RESPONSE_MS,
  missingLarAudio, makeBoundary, boundaryProblems, larStoragePath, buildLarSubmission,
} from '../lib/larFlow'

export default function LarRecorder({ itemId }) {
  const { claims } = useAuth()
  const navigate = useNavigate()
  const studentId = claims?.b10Id ?? null

  const [item, setItem] = useState(null)
  const [blocked, setBlocked] = useState(null)
  const [phase, setPhase] = useState('loading')
  // loading | preflight | intro | playing | responding | replaying | uploading
  // | uploadFailed | submitting | submitFailed | restart
  const [utterance, setUtterance] = useState(1)       // 1-based, current sentence
  const [message, setMessage] = useState(null)
  const [remainingMs, setRemainingMs] = useState(LAR_RESPONSE_MS)
  const [windowMs, setWindowMs] = useState(0)          // recorded time in the current window
  const [replayUsed, setReplayUsed] = useState(false)

  const attemptRef = useRef(null)          // { id }
  const urlsRef = useRef({})               // 'intro' | 'u1'..'u7' -> download URL
  const runRef = useRef(0)                 // bumped on unmount / restart; stale async flows stop
  const boundariesRef = useRef([])
  const windowRef = useRef(null)           // { k, startMs, deadline, timer, closed, replaying }
  const pausingRef = useRef(true)          // false when the browser can't pause MediaRecorder
  const uploadedRef = useRef(null)         // { storagePath, durationMs } once the file is in Storage
  const closeWindowRef = useRef(null)      // latest closeWindow; called from the 45 s timer

  const player = useAudioPlayer()
  const mic = useMicCheck(player, phase === 'preflight')
  const onMicLostRef = useRef(null)
  const rec = useRecorder({
    maxDurationMs: null,                   // 45 s is per window, timed below
    minDurationMs: LAR_MIN_RESPONSE_MS,
    onMicLost: () => onMicLostRef.current?.(),
  })

  // ── Load the item and resolve its eight audio clips ────────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const snap = await getDoc(doc(db, 'toeflItems', itemId))
        if (cancelled) return
        if (!snap.exists()) { setBlocked(`No toeflItems document found for "${itemId}".`); return }
        const data = snap.data()
        const missing = missingLarAudio(data)
        if (missing.length) { setBlocked(`This task's audio is not available yet (missing: ${missing.join(', ')}).`); return }
        const urls = { intro: await getDownloadURL(ref(storage, findAudioClip(data, 'intro').storagePath)) }
        for (let n = 1; n <= LAR_UTTERANCE_COUNT; n++) {
          urls[`u${n}`] = await getDownloadURL(ref(storage, findAudioClip(data, 'utterance', n).storagePath))
        }
        if (cancelled) return
        urlsRef.current = urls
        setItem(data)
      } catch (err) {
        if (!cancelled) setBlocked(`Could not load the task: ${err.message}`)
      }
    })()
    return () => { cancelled = true }
  }, [itemId])

  // ── Reuse an unfinished attempt, or create one, once ───────────────────────
  // No mid-set resume (see header). If a submission already exists for the
  // attempt, only completing the attempt was left undone.
  const attemptStarted = useRef(false)
  useEffect(() => {
    if (!item || !studentId || attemptStarted.current) return
    attemptStarted.current = true
    ;(async () => {
      try {
        const existing = await getDocs(query(
          collection(db, 'toeflAttempts'),
          where('studentId', '==', studentId),
          where('itemId', '==', itemId),
          where('completedAt', '==', null),
        ))
        if (!existing.empty) {
          const millis = (ts) => ts?.toMillis?.() ?? 0
          const latest = existing.docs.map((d) => ({ id: d.id, data: d.data() }))
            .sort((a, b) => millis(b.data.startedAt) - millis(a.data.startedAt))[0]
          attemptRef.current = { id: latest.id }
          const subs = await getDocs(query(
            collection(db, 'toeflSubmissions'),
            where('studentId', '==', studentId),
            where('attemptId', '==', latest.id),
          ))
          if (!subs.empty) {
            await updateDoc(doc(db, 'toeflAttempts', latest.id), { completedAt: serverTimestamp() }).catch(() => {})
            navigate(`/results/${subs.docs[0].id}`)
            return
          }
        } else {
          const created = await addDoc(collection(db, 'toeflAttempts'), {
            studentId,
            itemId,
            taskType: 'LAR',
            courseWeek: 1, // fixture-level, as in TypedResponseRenderer
            freshness: 'fresh',
            timingMode: 'untimed',
            startedAt: serverTimestamp(),
            completedAt: null,
            flaggedByStudent: false,
          })
          attemptRef.current = { id: created.id }
        }
        setPhase('preflight')
      } catch (err) {
        setBlocked(`Could not start the attempt: ${err.message}`)
        attemptStarted.current = false
      }
    })()
  }, [item, studentId, itemId, navigate])

  // ── Unmount: stop every flow and the window timer ──────────────────────────
  useEffect(() => () => {
    runRef.current++
    clearTimeout(windowRef.current?.timer)
  }, [])

  // ── Countdown (wall clock, runs through a replay) and window length ────────
  const getRecordedMs = rec.getRecordedMs
  useEffect(() => {
    if (phase !== 'responding' && phase !== 'replaying') return
    const id = setInterval(() => {
      const w = windowRef.current
      if (!w) return
      setRemainingMs(Math.max(0, w.deadline - Date.now()))
      setWindowMs(getRecordedMs() - w.startMs)
    }, 200)
    return () => clearInterval(id)
  }, [phase, getRecordedMs])

  // ── Warn before leaving mid-set: the recording can't be recovered ──────────
  useEffect(() => {
    if (!['intro', 'playing', 'responding', 'replaying', 'uploading'].includes(phase)) return
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [phase])

  // ── Submission, once ───────────────────────────────────────────────────────
  const submit = useCallback(async () => {
    setPhase('submitting')
    setMessage(null)
    const attemptId = attemptRef.current.id
    try {
      const existing = await getDocs(query(
        collection(db, 'toeflSubmissions'),
        where('studentId', '==', studentId),
        where('attemptId', '==', attemptId),
      ))
      const { storagePath, durationMs } = uploadedRef.current
      const submissionId = existing.empty
        ? (await addDoc(collection(db, 'toeflSubmissions'), buildLarSubmission({
            attemptId, studentId, storagePath, durationMs, boundaries: boundariesRef.current,
          }))).id
        : existing.docs[0].id
      try {
        await updateDoc(doc(db, 'toeflAttempts', attemptId), { completedAt: serverTimestamp() })
      } catch (err) {
        console.error('could not complete attempt', attemptId, err)   // non-fatal, as in the other renderers
      }
      navigate(`/results/${submissionId}`)
    } catch (err) {
      setMessage(`Could not submit: ${err.message}`)
      setPhase('submitFailed')
    }
  }, [navigate, studentId])

  // ── Upload the one recording ───────────────────────────────────────────────
  const upload = useCallback(async (result) => {
    setPhase('uploading')
    setMessage(null)
    const storagePath = larStoragePath(studentId, attemptRef.current.id, result.mimeType)
    try {
      await uploadBytes(ref(storage, storagePath), result.blob, { contentType: result.mimeType })
      uploadedRef.current = { storagePath, durationMs: result.durationMs }
      rec.discard()
      submit()
    } catch (err) {
      console.error('LAR upload failed', storagePath, err)
      setMessage('Your recording is complete but could not be uploaded. Check your connection and retry — you will not need to record it again.')
      setPhase('uploadFailed')
    }
  }, [studentId, rec, submit])

  // Abandon the set: stop every flow and any sound, and stop and drop the
  // recording in progress, so "Start again" can begin a fresh one. The restart
  // button appears only once the recorder is idle again.
  const restartWith = useCallback(async (msg) => {
    runRef.current++
    clearTimeout(windowRef.current?.timer)
    windowRef.current = null
    player.stop()
    boundariesRef.current = []
    setMessage(msg)
    setPhase('uploading')        // brief "saving" state while the recorder stops
    await rec.stop()             // null if nothing was recording (e.g. mic already lost)
    rec.discard()
    setPhase('restart')
  }, [player, rec])

  // ── One sentence: play, then open its response window ─────────────────────
  // `firstPlay`, when given, is playback already started inside a tap.
  const runUtterance = useCallback(async (k, firstPlay = null) => {
    const token = runRef.current
    const live = () => token === runRef.current
    setUtterance(k)
    setReplayUsed(false)
    setPhase('playing')
    try {
      await (firstPlay ?? player.play(urlsRef.current[`u${k}`]))
      if (!live()) return
      if (k === 1) {
        // Recording starts after the first sentence's first play, so no
        // trainer audio precedes the first window.
        const started = await rec.start()
        if (!live()) return
        if (!started.success) { restartWith(started.error); return }
        pausingRef.current = rec.pauseSupported()
      } else if (pausingRef.current) {
        rec.resume()
      }
    } catch {
      if (live()) restartWith('A sentence could not be played. Check your connection, then start again.')
      return
    }
    const startMs = rec.getRecordedMs()
    const deadline = Date.now() + LAR_RESPONSE_MS
    windowRef.current = { k, startMs, deadline, closed: false, replaying: false, timer: setTimeout(() => closeWindowRef.current?.('timeout'), LAR_RESPONSE_MS) }
    setRemainingMs(LAR_RESPONSE_MS)
    setWindowMs(0)
    setPhase('responding')
  }, [player, rec, restartWith])

  // ── Close the current window (Done, or 45 s) ───────────────────────────────
  closeWindowRef.current = async (reason) => {
    const w = windowRef.current
    if (!w || w.closed) return
    w.closed = true
    clearTimeout(w.timer)
    if (w.replaying) player.stop()      // 45 s ran out mid-replay; the mic is already paused
    const endMs = rec.getRecordedMs()
    boundariesRef.current = [...boundariesRef.current, makeBoundary(w.k, w.startMs, Math.max(endMs, w.startMs + 1))]
    if (reason === 'timeout') console.info(`LAR sentence ${w.k}: window closed at 45 s`)
    if (w.k < LAR_UTTERANCE_COUNT) {
      if (pausingRef.current) rec.pause()      // refuses safely if not recording
      runUtterance(w.k + 1)
      return
    }
    // Sentence 7 done: finish the one recording.
    setPhase('uploading')
    const result = await rec.stop()
    if (!result || result.empty) {
      restartWith('Nothing was recorded. The set will start again from sentence 1.')
      return
    }
    const problems = boundaryProblems(boundariesRef.current, result.durationMs)
    if (problems.length) {
      // A bug here, not a student error: never submit boundaries the comparer would reject.
      console.error('LAR boundaries invalid', problems, boundariesRef.current, result.durationMs)
      restartWith('Something went wrong with the recording timing. The set will start again from sentence 1.')
      return
    }
    upload(result)
  }

  onMicLostRef.current = () => {
    restartWith('Your microphone stopped working, so the recording could not be kept. Reconnect it, then start again from sentence 1.')
  }

  // ── Taps ───────────────────────────────────────────────────────────────────
  function handleStart() {
    player.unlock()
    boundariesRef.current = []
    const token = runRef.current
    const intro = player.play(urlsRef.current.intro)          // play() inside the tap
    setPhase('intro')
    intro.then(() => { if (token === runRef.current) runUtterance(1) })
      .catch(() => { if (token === runRef.current) restartWith('The introduction could not be played. Check your connection, then start again.') })
  }

  function handleRestart() {
    player.unlock()
    boundariesRef.current = []
    runUtterance(1, player.play(urlsRef.current.u1))           // inside the tap; intro not repeated
  }

  function handleReplay() {
    const w = windowRef.current
    if (!w || w.closed || w.replaying || replayUsed) return
    setReplayUsed(true)
    w.replaying = true
    if (pausingRef.current) rec.pause()                         // trainer audio must not enter the recording
    setPhase('replaying')
    const token = runRef.current
    player.play(urlsRef.current[`u${w.k}`])
      .catch(() => {})                                          // a failed replay just ends the replay
      .then(() => {
        if (token !== runRef.current || w.closed) return
        w.replaying = false
        if (pausingRef.current) rec.resume()
        setPhase('responding')
      })
  }

  function handleDone() {
    if (rec.getRecordedMs() - (windowRef.current?.startMs ?? 0) < LAR_MIN_RESPONSE_MS) return
    closeWindowRef.current?.('done')
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (blocked) return <Shell><p className="text-red-600 text-sm">{blocked}</p></Shell>
  if (!studentId && item) {
    return <Shell><p className="text-red-600 text-sm">No b10Id claim on this account — the recording and submission would be rejected. Sign in as a student.</p></Shell>
  }
  if (phase === 'loading' || !item) return <Shell><p className="text-sm text-gray-500">Loading…</p></Shell>

  const secs = Math.ceil(remainingMs / 1000)

  return (
    <Shell>
      <p className="font-mono text-xs text-gray-400 mb-1">{itemId} · LAR</p>
      <h1 className="text-lg font-bold mb-4">Listen and Repeat</h1>

      {phase === 'preflight' && (
        <div>
          <p className="text-sm mb-4">
            You will hear {LAR_UTTERANCE_COUNT} sentences, one at a time. After each sentence, repeat it
            exactly as you heard it. You have 45 seconds for each sentence. You may replay each sentence
            <strong> once</strong>, but the replay uses your 45 seconds.
          </p>
          <MicCheck check={mic} />
          {message && <p className="text-red-600 text-sm mb-3">{message}</p>}
          <Button onClick={handleStart} disabled={!mic.heard}>Start</Button>
        </div>
      )}

      {phase === 'intro' && (
        <div className="p-4 bg-gray-50 rounded-lg">
          <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Listen</p>
          {/* introduction is heard AND printed (data model v1.18); the sentences never are */}
          <p className="text-sm leading-relaxed">{item.stimulus?.introduction ?? ''}</p>
        </div>
      )}

      {phase === 'playing' && <Center big={`Sentence ${utterance} of ${LAR_UTTERANCE_COUNT}`} small="Listen." />}

      {(phase === 'responding' || phase === 'replaying') && (
        <div className="text-center py-6">
          <p className="text-sm text-gray-500 mb-2">Sentence {utterance} of {LAR_UTTERANCE_COUNT}</p>
          {phase === 'replaying' ? (
            <p className="text-gray-600 font-semibold mb-2">Listen again…</p>
          ) : (
            <div className="flex items-center justify-center gap-2 mb-2">
              <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
              <span className="text-red-600 font-semibold">Repeat the sentence</span>
            </div>
          )}
          <p className="text-4xl font-mono font-bold mb-6">0:{String(secs).padStart(2, '0')}</p>
          <div className="flex flex-col gap-3">
            <Button onClick={handleReplay} disabled={replayUsed || phase === 'replaying'}>
              {replayUsed ? 'Replay used' : 'Replay the sentence (once)'}
            </Button>
            <Button onClick={handleDone} disabled={phase !== 'responding' || windowMs < LAR_MIN_RESPONSE_MS} danger>
              {utterance < LAR_UTTERANCE_COUNT ? 'Done — next sentence' : 'Done — finish'}
            </Button>
          </div>
        </div>
      )}

      {(phase === 'uploading' || phase === 'submitting') && (
        <Center big={phase === 'uploading' ? 'Saving your recording…' : 'Submitting…'} />
      )}

      {phase === 'uploadFailed' && (
        <div>
          <p className="text-red-600 text-sm mb-3">{message}</p>
          <Button onClick={() => upload(rec.getRecording())} disabled={!rec.hasRecording}>Retry upload</Button>
        </div>
      )}

      {phase === 'submitFailed' && (
        <div>
          <p className="text-red-600 text-sm mb-3">{message}</p>
          <Button onClick={submit}>Retry</Button>
        </div>
      )}

      {phase === 'restart' && (
        <div>
          <p className="text-red-600 text-sm mb-3">{message}</p>
          <Button onClick={handleRestart}>Start again from sentence 1</Button>
        </div>
      )}
    </Shell>
  )
}
