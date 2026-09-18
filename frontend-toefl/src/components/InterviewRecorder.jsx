// src/components/InterviewRecorder.jsx
// Interview (INT): four questions, each played once, 45 s to answer, one clip
// per question. Per TOEFL_Interview_Recorder_Spec_v1_4:
//   - The question text is never displayed. Audio only, played once, no replay.
//   - Recording starts when the question audio ends, marked by a short tone. No
//     "ready" button, which would add preparation time the real test lacks.
//   - A visible 45 s countdown, early stop, auto-stop at 45 s.
//   - A 1-2 s "Question N of 4" transition between questions.
//   - A mic pre-flight before Q1 with a live level meter.
//   - Each clip uploads as soon as it is recorded and is written to the
//     attempt's interviewClips, so a student who leaves can resume at the first
//     unanswered question (JC 2026-09-18: resume, not restart).
//   - The submission is created once, after the fourth clip lands
//     (scoringStatus 'queued'); the server scores it asynchronously.
//
// Decisions made here that are the spec's open JC CHECK items:
//   - Mic lost mid-question: that question is replayed and re-recorded, and
//     other clips are untouched (the spec's recommended option). A replayed
//     question is heard twice, which is the one exception to "played once".
//   - Resuming also replays the question the student left in the middle of.
//
// Rules and index bases live in lib/interviewFlow.js; recording in
// hooks/useRecorder.js.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where,
} from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { db, storage } from '../services/firebase'
import { useAuth } from '../context/useAuth'
import { useRecorder } from '../hooks/useRecorder'
import {
  INT_QUESTION_COUNT, RESPONSE_MS, TRANSITION_MS, MIN_RESPONSE_MS,
  findAudioClip, missingAudio, nextQuestionIndex, upsertClip, clipStoragePath, clipEntry, buildSubmission,
} from '../lib/interviewFlow'

const LEVEL_THRESHOLD = 0.04   // pre-flight: RMS the meter must reach once ("say a few words")
const TONE_MS = 150

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default function InterviewRecorder({ itemId }) {
  const { claims } = useAuth()
  const navigate = useNavigate()
  const studentId = claims?.b10Id ?? null

  const [item, setItem] = useState(null)
  const [blocked, setBlocked] = useState(null)        // message; the interview cannot run
  const [phase, setPhase] = useState('loading')
  // loading | preflight | intro | transition | playing | recording | uploading
  // | uploadFailed | retryQuestion | submitting | submitFailed
  const [questionIndex, setQuestionIndex] = useState(0)   // 0-based, current question
  const [resumeAt, setResumeAt] = useState(null)          // 0-based, or null
  const [message, setMessage] = useState(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [level, setLevel] = useState(0)
  const [heardSignal, setHeardSignal] = useState(false)
  const [micTestOn, setMicTestOn] = useState(false)     // meter started by a tap (Chrome keeps an untapped AudioContext suspended)

  const attemptRef = useRef(null)        // { id, clips }
  const urlsRef = useRef({})             // 'intro' | 'q1'..'q4' -> download URL
  const audioElRef = useRef(null)        // ONE element for every clip (iOS: unlocked by the Start tap)
  const audioCtxRef = useRef(null)
  const runRef = useRef(0)               // bumped on unmount; stale async flows stop
  const finishingRef = useRef(false)     // one finish per question (Stop vs auto-stop)
  const currentQRef = useRef(0)

  const onAutoStopRef = useRef(null)
  const onMicLostRef = useRef(null)
  const rec = useRecorder({
    maxDurationMs: RESPONSE_MS,
    minDurationMs: MIN_RESPONSE_MS,
    onAutoStop: (result) => onAutoStopRef.current?.(result),
    onMicLost: () => onMicLostRef.current?.(),
  })

  // ── Load the item and resolve its five audio clips ─────────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const snap = await getDoc(doc(db, 'toeflItems', itemId))
        if (cancelled) return
        if (!snap.exists()) { setBlocked(`No toeflItems document found for "${itemId}".`); return }
        const data = snap.data()
        const missing = missingAudio(data)
        if (missing.length) {
          setBlocked(`This interview's audio is not available yet (missing: ${missing.join(', ')}).`)
          return
        }
        const urls = {}
        urls.intro = await getDownloadURL(ref(storage, findAudioClip(data, 'intro').storagePath))
        for (let n = 1; n <= INT_QUESTION_COUNT; n++) {
          urls[`q${n}`] = await getDownloadURL(ref(storage, findAudioClip(data, 'question', n).storagePath))
        }
        if (cancelled) return
        urlsRef.current = urls
        setItem(data)
      } catch (err) {
        if (!cancelled) setBlocked(`Could not load the interview: ${err.message}`)
      }
    })()
    return () => { cancelled = true }
  }, [itemId])

  // ── Resume an unfinished attempt, or create one, once ──────────────────────
  // Same pattern and StrictMode ref guard as TypedResponseRenderer.
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
          const clips = latest.data.interviewClips ?? []
          attemptRef.current = { id: latest.id, clips }
          const next = nextQuestionIndex(clips)
          setResumeAt(next === null ? INT_QUESTION_COUNT : next)
        } else {
          const created = await addDoc(collection(db, 'toeflAttempts'), {
            studentId,
            itemId,
            taskType: 'INT',
            courseWeek: 1, // fixture-level, as in TypedResponseRenderer
            freshness: 'fresh',
            timingMode: 'untimed',
            startedAt: serverTimestamp(),
            completedAt: null,
            flaggedByStudent: false,
            interviewClips: [],
          })
          attemptRef.current = { id: created.id, clips: [] }
          setResumeAt(0)
        }
        setPhase('preflight')
      } catch (err) {
        setBlocked(`Could not start the attempt: ${err.message}`)
        attemptStarted.current = false
      }
    })()
  }, [item, studentId, itemId])

  // ── Pre-flight mic check with a live level meter ───────────────────────────
  // Runs only after the "Test my microphone" tap, which also created and
  // resumed the AudioContext; a context made outside a tap stays suspended and
  // the meter would read zero forever.
  useEffect(() => {
    if (phase !== 'preflight' || !micTestOn) return
    let stream = null, raf = null, stopped = false
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return }
        const ctx = audioCtxRef.current
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 1024
        ctx.createMediaStreamSource(stream).connect(analyser)
        const buf = new Float32Array(analyser.fftSize)
        const loop = () => {
          analyser.getFloatTimeDomainData(buf)
          const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length)
          setLevel(rms)
          if (rms > LEVEL_THRESHOLD) setHeardSignal(true)
          raf = requestAnimationFrame(loop)
        }
        loop()
      } catch (err) {
        if (!stopped) setMessage(err?.name === 'NotAllowedError'
          ? 'Microphone access was denied. Please allow microphone access and reload the page.'
          : 'Could not access your microphone. Please check it and reload the page.')
      }
    })()
    return () => {
      stopped = true
      if (raf) cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [phase, micTestOn])

  // ── Unmount: stop every flow and every sound (the hook frees the mic) ───────
  useEffect(() => () => {
    runRef.current++
    audioElRef.current?.pause()
    audioCtxRef.current?.close?.()
  }, [])

  // ── Countdown tick while recording ─────────────────────────────────────────
  const getRecordedMs = rec.getRecordedMs   // stable: the recorder is created once
  useEffect(() => {
    if (phase !== 'recording') return
    const id = setInterval(() => setElapsedMs(getRecordedMs()), 200)
    return () => clearInterval(id)
  }, [phase, getRecordedMs])

  // ── Warn before leaving mid-question (clips already uploaded are safe) ─────
  useEffect(() => {
    const active = ['intro', 'transition', 'playing', 'recording', 'uploading'].includes(phase)
    if (!active) return
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [phase])

  // Plays one clip on the shared element. play() is called synchronously, so
  // the first call can be made inside the Start tap (iOS autoplay rule).
  const playClip = useCallback((url) => {
    const el = audioElRef.current
    return new Promise((resolve, reject) => {
      el.onended = () => resolve()
      el.onerror = () => reject(new Error('audio playback failed'))
      el.src = url
      el.play().catch(reject)
    })
  }, [])

  const tone = useCallback(async () => {
    const ctx = audioCtxRef.current
    if (!ctx) return
    const osc = ctx.createOscillator(), gain = ctx.createGain()
    osc.frequency.value = 880
    gain.gain.value = 0.15
    osc.connect(gain).connect(ctx.destination)
    osc.start(); osc.stop(ctx.currentTime + TONE_MS / 1000)
    await sleep(TONE_MS)   // the tone ends before recording begins, so it is not in the clip
  }, [])

  // ── One question: play once, tone, record ──────────────────────────────────
  // `firstPlay`, when given, is the question's playback already started inside
  // the Start tap; otherwise there is a transition beat first.
  const runQuestion = useCallback(async (i, firstPlay = null) => {
    const token = runRef.current
    const live = () => token === runRef.current
    currentQRef.current = i
    setQuestionIndex(i)
    setMessage(null)
    finishingRef.current = false
    try {
      let playing = firstPlay
      if (!playing) {
        setPhase('transition')
        await sleep(TRANSITION_MS)
        if (!live()) return
        playing = playClip(urlsRef.current[`q${i + 1}`])
      }
      setPhase('playing')
      await playing
      if (!live()) return
      await tone()
      if (!live()) return
      const started = await rec.start()
      if (!live()) return
      if (!started.success) {
        setMessage(started.error)
        setPhase('retryQuestion')
        return
      }
      setElapsedMs(0)
      setPhase('recording')
    } catch {
      if (!live()) return
      setMessage('The question audio could not be played. Check your connection, then try again.')
      setPhase('retryQuestion')
    }
  }, [playClip, tone, rec])

  // ── Submission: once, after all four clips ─────────────────────────────────
  const submit = useCallback(async () => {
    setPhase('submitting')
    setMessage(null)
    const { id: attemptId, clips } = attemptRef.current
    try {
      // A submission may already exist if completing the attempt failed last
      // time; never create a second one for the same attempt.
      const existing = await getDocs(query(
        collection(db, 'toeflSubmissions'),
        where('studentId', '==', studentId),
        where('attemptId', '==', attemptId),
      ))
      const submissionId = existing.empty
        ? (await addDoc(collection(db, 'toeflSubmissions'), buildSubmission({ attemptId, studentId, interviewClips: clips }))).id
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

  // ── Upload a finished clip, record it on the attempt, move on ──────────────
  const uploadClip = useCallback(async (i, result) => {
    const token = runRef.current
    setPhase('uploading')
    setMessage(null)
    const { id: attemptId } = attemptRef.current
    const path = clipStoragePath(studentId, attemptId, i, result.mimeType)
    try {
      await uploadBytes(ref(storage, path), result.blob, { contentType: result.mimeType })
      const clips = upsertClip(attemptRef.current.clips, clipEntry(i, path, result.durationMs))
      await updateDoc(doc(db, 'toeflAttempts', attemptId), { interviewClips: clips })
      attemptRef.current = { id: attemptId, clips }
      rec.discard()
      if (token !== runRef.current) return
      const next = nextQuestionIndex(clips)
      if (next === null) submit()
      else runQuestion(next)
    } catch (err) {
      if (token !== runRef.current) return
      console.error('clip upload failed', path, err)
      setMessage('Your answer was recorded but could not be uploaded. Check your connection and retry — you will not need to record it again.')
      setPhase('uploadFailed')
    }
  }, [studentId, rec, runQuestion, submit])

  const finishQuestion = useCallback((result) => {
    if (finishingRef.current) return
    finishingRef.current = true
    const i = currentQRef.current
    if (!result || result.empty) {
      setMessage('Nothing was recorded for this question. It will play again so you can answer.')
      setPhase('retryQuestion')
      return
    }
    uploadClip(i, result)
  }, [uploadClip])

  onAutoStopRef.current = finishQuestion
  onMicLostRef.current = () => {
    setMessage('Your microphone stopped working. Reconnect it, then replay this question to answer again. Your other answers are saved.')
    setPhase('retryQuestion')
  }

  async function handleStop() {
    if (rec.getRecordedMs() < MIN_RESPONSE_MS) return
    finishQuestion(await rec.stop())
  }

  function handleMicTest() {
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    audioCtxRef.current.resume?.()
    setMessage(null)
    setMicTestOn(true)
  }

  // ── Start (or resume): a user tap, so audio may play ───────────────────────
  function handleStart() {
    if (!audioElRef.current) audioElRef.current = new Audio()
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    audioCtxRef.current.resume?.()
    const start = resumeAt ?? 0
    if (start >= INT_QUESTION_COUNT) { submit(); return }     // all clips uploaded earlier; only the submission is missing
    if (start === 0) {
      const intro = playClip(urlsRef.current.intro)            // play() inside the tap
      setPhase('intro')
      const token = runRef.current
      intro.then(() => { if (token === runRef.current) runQuestion(0) })
        .catch(() => { if (token === runRef.current) { setMessage('The introduction could not be played. Check your connection, then start again.'); setPhase('preflight') } })
    } else {
      runQuestion(start, playClip(urlsRef.current[`q${start + 1}`]))
    }
  }

  function handleReplayQuestion() {
    // A tap again, so playback is allowed even if the element lost its unlock.
    runQuestion(currentQRef.current, playClip(urlsRef.current[`q${currentQRef.current + 1}`]))
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (blocked) return <Shell><p className="text-red-600 text-sm">{blocked}</p></Shell>
  if (!studentId && item) {
    return <Shell><p className="text-red-600 text-sm">No b10Id claim on this account — recordings and the submission would be rejected. Sign in as a student.</p></Shell>
  }
  if (phase === 'loading' || !item) return <Shell><p className="text-sm text-gray-500">Loading interview…</p></Shell>

  const n = questionIndex + 1
  const remaining = Math.max(0, Math.ceil((RESPONSE_MS - elapsedMs) / 1000))

  return (
    <Shell>
      <p className="font-mono text-xs text-gray-400 mb-1">{itemId} · INT</p>
      <h1 className="text-lg font-bold mb-4">Interview</h1>

      {phase === 'preflight' && (
        <div>
          <p className="text-sm mb-4">
            You will hear four questions, one at a time. Each question plays <strong>once</strong>.
            After each question you will hear a short tone — then speak your answer. You have up to
            45 seconds, and you can stop early.
          </p>
          {resumeAt < INT_QUESTION_COUNT && (
            !micTestOn ? (
              <div className="mb-4"><Button onClick={handleMicTest}>Test my microphone</Button></div>
            ) : (
              <>
                <p className="text-sm font-semibold mb-2">Microphone check — say a few words.</p>
                <LevelMeter level={level} />
                <p className="text-xs text-gray-500 mt-2 mb-4">
                  {heardSignal ? 'Your microphone is working.' : 'Waiting to hear you…'}
                </p>
              </>
            )
          )}
          {message && <p className="text-red-600 text-sm mb-3">{message}</p>}
          <Button onClick={handleStart} disabled={resumeAt < INT_QUESTION_COUNT && !heardSignal}>
            {resumeAt >= INT_QUESTION_COUNT ? 'Submit your answers'
              : resumeAt > 0 ? `Resume at Question ${resumeAt + 1} of ${INT_QUESTION_COUNT}`
              : 'Start the interview'}
          </Button>
        </div>
      )}

      {phase === 'intro' && (
        <div className="p-4 bg-gray-50 rounded-lg">
          <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Listen</p>
          {/* contextSentence is heard AND printed (data model v1.18); the stems never are */}
          <p className="text-sm leading-relaxed">{item.stimulus?.contextSentence}</p>
        </div>
      )}

      {phase === 'transition' && <Center big={`Question ${n} of ${INT_QUESTION_COUNT}`} />}

      {phase === 'playing' && <Center big={`Question ${n} of ${INT_QUESTION_COUNT}`} small="Listen to the question." />}

      {phase === 'recording' && (
        <div className="text-center py-6">
          <p className="text-sm text-gray-500 mb-2">Question {n} of {INT_QUESTION_COUNT}</p>
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
            <span className="text-red-600 font-semibold">Recording</span>
          </div>
          <p className="text-4xl font-mono font-bold mb-6">0:{String(remaining).padStart(2, '0')}</p>
          <Button onClick={handleStop} disabled={elapsedMs < MIN_RESPONSE_MS} danger>
            Stop and continue
          </Button>
        </div>
      )}

      {(phase === 'uploading' || phase === 'submitting') && (
        <Center big={phase === 'uploading' ? `Saving your answer to Question ${n}…` : 'Submitting your interview…'} />
      )}

      {phase === 'uploadFailed' && (
        <div>
          <p className="text-red-600 text-sm mb-3">{message}</p>
          <Button onClick={() => uploadClip(currentQRef.current, rec.getRecording())} disabled={!rec.hasRecording}>
            Retry upload
          </Button>
        </div>
      )}

      {phase === 'retryQuestion' && (
        <div>
          <p className="text-red-600 text-sm mb-3">{message}</p>
          <Button onClick={handleReplayQuestion}>Replay Question {n} and answer</Button>
        </div>
      )}

      {phase === 'submitFailed' && (
        <div>
          <p className="text-red-600 text-sm mb-3">{message}</p>
          <Button onClick={submit}>Retry</Button>
        </div>
      )}

      {!['preflight', 'intro'].includes(phase) && (
        <Progress done={(attemptRef.current?.clips ?? []).filter((c) => c.storagePath).length} />
      )}
    </Shell>
  )
}

function Center({ big, small }) {
  return (
    <div className="text-center py-10">
      <p className="text-xl font-semibold">{big}</p>
      {small && <p className="text-sm text-gray-500 mt-2">{small}</p>}
    </div>
  )
}

function LevelMeter({ level }) {
  const pct = Math.min(100, Math.round((level / 0.2) * 100))
  return (
    <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden" aria-label="microphone level">
      <div className="h-full bg-green-500 transition-[width] duration-75" style={{ width: `${pct}%` }} />
    </div>
  )
}

function Progress({ done }) {
  return (
    <p className="text-xs text-gray-400 text-center mt-6">
      {done} of {INT_QUESTION_COUNT} answers saved
    </p>
  )
}

function Button({ onClick, disabled, danger, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full py-3 rounded-lg text-white text-sm font-semibold disabled:opacity-40 ${danger ? 'bg-red-600' : ''}`}
      style={danger ? undefined : { backgroundColor: '#1e3a5f' }}
    >
      {children}
    </button>
  )
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="w-full max-w-2xl mx-auto bg-white rounded-2xl shadow-md p-6">{children}</div>
    </div>
  )
}
