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
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage'
import { uploadWithStallTimeout, UPLOAD_STALL_MS } from '../lib/stallUpload'
import { withTimeout } from '../lib/withTimeout'
import { db, storage } from '../services/firebase'
import { useAuth } from '../context/useAuth'
import { useRecorder } from '../hooks/useRecorder'
import { useAudioPlayer, useMicCheck } from '../hooks/audioPlayback'
import { MicCheck, Shell, Button, Center } from './recorderUi'
import {
  INT_QUESTION_COUNT, RESPONSE_MS, TRANSITION_MS, MIN_RESPONSE_MS,
  findAudioClip, missingAudio, nextQuestionIndex, upsertClip, clipStoragePath, clipEntry, buildSubmission,
} from '../lib/interviewFlow'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default function InterviewRecorder({ itemId }) {
  const { claims } = useAuth()
  const navigate = useNavigate()
  const studentId = claims?.b10Id ?? null

  const [item, setItem] = useState(null)
  const [blocked, setBlocked] = useState(null)        // message; the interview cannot run
  const [phase, setPhase] = useState('loading')
  // loading | preflight | intro | transition | playing | recording | finishing
  // | uploading | uploadFailed | retryQuestion | submitting | submitFailed
  // finishing = waiting for the browser to finalize the clip (rec.stop);
  // uploading = sending it to Storage. Separate so the screen, and any error,
  // names the step that is running or failed.
  const [questionIndex, setQuestionIndex] = useState(0)   // 0-based, current question
  const [resumeAt, setResumeAt] = useState(null)          // 0-based, or null
  const [message, setMessage] = useState(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [saveProgress, setSaveProgress] = useState(null)  // 0..1 while uploading

  const attemptRef = useRef(null)        // { id, clips }
  const urlsRef = useRef({})             // 'intro' | 'q1'..'q4' -> download URL
  const player = useAudioPlayer()        // one <audio> + AudioContext, unlocked by a tap (recorderUi)
  const mic = useMicCheck(player, phase === 'preflight')
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

  // ── Unmount: stop every flow (useAudioPlayer stops sound, useRecorder frees the mic)
  useEffect(() => () => { runRef.current++ }, [])

  // ── Countdown tick while recording ─────────────────────────────────────────
  const getRecordedMs = rec.getRecordedMs   // stable: the recorder is created once
  useEffect(() => {
    if (phase !== 'recording') return
    const id = setInterval(() => setElapsedMs(getRecordedMs()), 200)
    return () => clearInterval(id)
  }, [phase, getRecordedMs])

  // ── Warn before leaving mid-question (clips already uploaded are safe) ─────
  useEffect(() => {
    const active = ['intro', 'transition', 'playing', 'recording', 'finishing', 'uploading'].includes(phase)
    if (!active) return
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [phase])

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
        playing = player.play(urlsRef.current[`q${i + 1}`])
      }
      setPhase('playing')
      await playing
      if (!live()) return
      await player.tone()   // ends before recording starts, so it is not in the clip
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
  }, [player, rec])

  // ── Submission: once, after all four clips ─────────────────────────────────
  const submit = useCallback(async () => {
    setPhase('submitting')
    setMessage(null)
    const { id: attemptId, clips } = attemptRef.current
    try {
      // A submission may already exist if completing the attempt failed last
      // time; never create a second one for the same attempt.
      // Every step is bounded and named (lib/withTimeout.js): on a dead
      // connection a Firestore write never settles, which would leave this
      // screen on "Submitting…" forever.
      const existing = await withTimeout(getDocs(query(
        collection(db, 'toeflSubmissions'),
        where('studentId', '==', studentId),
        where('attemptId', '==', attemptId),
      )), 'Checking for an earlier submission')
      const submissionId = existing.empty
        ? (await withTimeout(addDoc(collection(db, 'toeflSubmissions'), buildSubmission({ attemptId, studentId, interviewClips: clips })), 'Creating the submission')).id
        : existing.docs[0].id
      try {
        // Non-fatal, but bounded: an unbounded hang here would block the
        // navigation to results even though the submission exists.
        await withTimeout(updateDoc(doc(db, 'toeflAttempts', attemptId), { completedAt: serverTimestamp() }), 'Completing the attempt')
      } catch (err) {
        console.error('could not complete attempt', attemptId, err)   // non-fatal, as in the other renderers
      }
      navigate(`/results/${submissionId}`)
    } catch (err) {
      // err.message names the step when it timed out (StepTimeoutError).
      setMessage(`Submitting failed: ${err.message}. Your recording is saved; check your connection and retry.`)
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
    setSaveProgress(null)
    try {
      // Stall timeout, not a total one: a slow upload that keeps moving is
      // never cut off (lib/stallUpload.js).
      await uploadWithStallTimeout(
        () => uploadBytesResumable(ref(storage, path), result.blob, { contentType: result.mimeType }),
        { onProgress: setSaveProgress }
      )
      const clips = upsertClip(attemptRef.current.clips, clipEntry(i, path, result.durationMs))
      await withTimeout(updateDoc(doc(db, 'toeflAttempts', attemptId), { interviewClips: clips }), 'Recording the answer on the attempt')
      attemptRef.current = { id: attemptId, clips }
      rec.discard()
      if (token !== runRef.current) return
      const next = nextQuestionIndex(clips)
      if (next === null) submit()
      else runQuestion(next)
    } catch (err) {
      if (token !== runRef.current) return
      console.error('clip upload failed', path, err)
      // Name the step that failed: the upload itself, or recording the
      // uploaded clip on the attempt (which can time out after a good upload).
      const failed = err?.code === 'step-timeout'
        ? `Saving failed: ${err.message}`
        : `Upload failed (${err?.code === 'upload-stalled'
            ? `no progress for ${Math.round(UPLOAD_STALL_MS / 1000)} seconds`
            : (err?.code || err?.message || 'unknown error')})`
      setMessage(`${failed}. Your answer was recorded and is kept on this device: check your connection and retry — you will not need to record it again.`)
      setPhase('uploadFailed')
    }
  }, [studentId, rec, runQuestion, submit])

  const finishQuestion = useCallback((result) => {
    if (finishingRef.current) return
    finishingRef.current = true
    const i = currentQRef.current
    if (result?.failed) {
      // The browser never finalized the clip (recorder stop timeout); nothing
      // was captured, so this question is answered again.
      setMessage(`Finishing the recording failed: ${result.error} This question will play again so you can answer.`)
      setPhase('retryQuestion')
      return
    }
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
    setPhase('finishing')
    finishQuestion(await rec.stop())
  }

  // ── Start (or resume): a user tap, so audio may play ───────────────────────
  function handleStart() {
    player.unlock()
    const start = resumeAt ?? 0
    if (start >= INT_QUESTION_COUNT) { submit(); return }     // all clips uploaded earlier; only the submission is missing
    if (start === 0) {
      const intro = player.play(urlsRef.current.intro)         // play() inside the tap
      setPhase('intro')
      const token = runRef.current
      intro.then(() => { if (token === runRef.current) runQuestion(0) })
        .catch(() => { if (token === runRef.current) { setMessage('The introduction could not be played. Check your connection, then start again.'); setPhase('preflight') } })
    } else {
      runQuestion(start, player.play(urlsRef.current[`q${start + 1}`]))
    }
  }

  function handleReplayQuestion() {
    // A tap again, so playback is allowed even if the element lost its unlock.
    runQuestion(currentQRef.current, player.play(urlsRef.current[`q${currentQRef.current + 1}`]))
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
          {resumeAt < INT_QUESTION_COUNT && <MicCheck check={mic} />}
          {message && <p className="text-red-600 text-sm mb-3">{message}</p>}
          <Button onClick={handleStart} disabled={resumeAt < INT_QUESTION_COUNT && !mic.heard}>
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

      {phase === 'finishing' && <Center big={`Finishing your answer to Question ${n}…`} />}

      {phase === 'uploading' && (
        <Center
          big={`Saving your answer to Question ${n}…`}
          small={saveProgress === null ? 'Starting upload…' : `Uploaded ${Math.round(saveProgress * 100)}%`}
        />
      )}

      {phase === 'submitting' && <Center big="Submitting your interview…" />}

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

function Progress({ done }) {
  return (
    <p className="text-xs text-gray-400 text-center mt-6">
      {done} of {INT_QUESTION_COUNT} answers saved
    </p>
  )
}
