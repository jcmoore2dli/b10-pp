// src/components/TypedResponseRenderer.jsx
// One renderer for the two typed-response types, EM (Write an Email) and DISC
// (Academic Discussion). Both submit the same responseContent shape —
// {text, wordCount}, data model v1.17 Collection 3 — so they share a screen and
// differ only in the stimulus shown above the text box.
//
// What this component may and may not see:
//   · reads toeflItems/{itemId} — public display content. EM/DISC have no
//     answerKey subcollection; there is no fixed answer to hide.
//   · reads and writes the student's own toeflAttempts — draft autosave lives
//     on the attempt (draftContent/draftSavedAt, Collection 2), never on the
//     submission, whose update rule is `if false`.
//   · writes toeflSubmissions with the response text only. Scoring (layerA,
//     layerB, status, instructor) is the trigger's to write, and the create
//     rule rejects all four from a client.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../context/useAuth'

// Debounce for draft autosave: a write fires this long after typing stops.
const AUTOSAVE_DELAY_MS = 3000

// Same counting rule as scripts/importToeflCorpus.js wordCount(): runs of
// non-whitespace. Word count is a practice parameter, not a scoring criterion —
// the trigger deliberately never passes it to the model.
function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export default function TypedResponseRenderer({ itemId }) {
  const { claims } = useAuth()
  const navigate = useNavigate()
  const studentId = claims?.b10Id ?? null

  const [item, setItem] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [attemptId, setAttemptId] = useState(null)
  const [text, setText] = useState('')
  const [saveState, setSaveState] = useState('idle') // idle | saving | saved | error
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  // Refs for the autosave/submit handoff. lastSavedText stops a write when
  // nothing changed (including right after a recovered draft loads).
  // pendingSave holds an in-flight write so submit can wait it out, and
  // submittedRef stops any save from running once submit has begun —
  // otherwise a late autosave could re-write draftContent after submit
  // cleared it.
  const saveTimer = useRef(null)
  const pendingSave = useRef(null)
  const lastSavedText = useRef('')
  const submittedRef = useRef(false)

  // ── Load the public item document ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const snap = await getDoc(doc(db, 'toeflItems', itemId))
        if (cancelled) return
        if (!snap.exists()) {
          setLoadError(`No toeflItems document found for "${itemId}".`)
          return
        }
        setItem(snap.data())
      } catch (err) {
        if (!cancelled) setLoadError(err.message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [itemId])

  // ── Resume an unfinished attempt, or create one, once ──────────────────────
  // Draft recovery: an attempt with completedAt == null for this student and
  // item is one they opened and never submitted. Equality filters only, so
  // Firestore serves this from single-field indexes — no composite index. The
  // studentId filter is also what lets the query pass the read rule, which
  // checks ownership per document.
  //
  // If more than one unfinished attempt exists (e.g. from before recovery
  // existed), resume the one saved most recently.
  //
  // Same ref guard as MCQRenderer, for the same StrictMode reason. And, as
  // there, no cancellation flag: StrictMode's cleanup would cancel the first
  // run while the ref blocks the second, leaving no attempt at all.
  const attemptStarted = useRef(false)
  useEffect(() => {
    if (!item || !studentId) return
    if (attemptStarted.current) return
    attemptStarted.current = true
    ;(async () => {
      try {
        const existing = await getDocs(
          query(
            collection(db, 'toeflAttempts'),
            where('studentId', '==', studentId),
            where('itemId', '==', itemId),
            where('completedAt', '==', null)
          )
        )

        if (!existing.empty) {
          const millis = (ts) => ts?.toMillis?.() ?? 0
          const latest = existing.docs
            .map((d) => ({ id: d.id, data: d.data() }))
            .sort(
              (a, b) =>
                millis(b.data.draftSavedAt ?? b.data.startedAt) -
                millis(a.data.draftSavedAt ?? a.data.startedAt)
            )[0]
          const draftText = latest.data.draftContent?.text ?? ''
          lastSavedText.current = draftText
          setText(draftText)
          if (latest.data.draftSavedAt) {
            setLastSavedAt(latest.data.draftSavedAt.toDate())
            setSaveState('saved')
          }
          setAttemptId(latest.id)
          return
        }

        const ref = await addDoc(collection(db, 'toeflAttempts'), {
          studentId,
          itemId,
          taskType: item.taskType,
          courseWeek: 1, // fixture-level; real week gating is Build Week B/C
          freshness: 'fresh',
          timingMode: 'untimed',
          startedAt: serverTimestamp(),
          completedAt: null,
          flaggedByStudent: false,
          draftContent: null,
          draftSavedAt: null,
          // optionShuffleSeed and displayOrder are MCQ-only (Collection 2) and
          // deliberately absent.
        })
        setAttemptId(ref.id)
      } catch (err) {
        setSubmitError(`Could not start attempt: ${err.message}`)
        attemptStarted.current = false // allow a retry
      }
    })()
  }, [item, studentId, itemId])

  // ── Draft autosave ─────────────────────────────────────────────────────────
  // Every keystroke resets the timer (the cleanup clears it), so a write fires
  // AUTOSAVE_DELAY_MS after typing stops. A failed save is shown but never
  // blocks typing or submitting — the submission is the record that matters.
  useEffect(() => {
    if (!attemptId || text === lastSavedText.current) return
    saveTimer.current = setTimeout(() => {
      if (submittedRef.current) return
      const snapshot = text
      setSaveState('saving')
      const write = updateDoc(doc(db, 'toeflAttempts', attemptId), {
        draftContent: { text: snapshot, wordCount: countWords(snapshot) },
        draftSavedAt: serverTimestamp(),
      })
        .then(() => {
          lastSavedText.current = snapshot
          setLastSavedAt(new Date())
          setSaveState('saved')
        })
        .catch((err) => {
          console.error('draft autosave failed', attemptId, err)
          setSaveState('error')
        })
      pendingSave.current = write
    }, AUTOSAVE_DELAY_MS)
    return () => clearTimeout(saveTimer.current)
  }, [text, attemptId])

  const wordCount = countWords(text)
  const canSubmit = text.trim().length > 0 && !!attemptId && !submitting

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    setSubmitError(null)

    // Stop autosave first: cancel the scheduled write, then wait out any write
    // already in flight, so nothing lands on the attempt after the draft is
    // cleared below.
    submittedRef.current = true
    clearTimeout(saveTimer.current)
    await pendingSave.current?.catch(() => {})

    try {
      // Exactly the v1.17 Collection 3 EM/DISC shape: {text, wordCount}. The
      // text is the body only — for EM the To/Subject header is pre-filled and
      // the trigger passes it to the model separately.
      const ref = await addDoc(collection(db, 'toeflSubmissions'), {
        attemptId,
        studentId,
        taskType: item.taskType,
        responseContent: { text, wordCount },
        scoringStatus: 'queued',
        scoredAt: null,
      })

      // Complete the attempt and clear the draft ("cleared once a real
      // toeflSubmissions document is created", Collection 2). Non-fatal, as in
      // MCQRenderer: the response is already safe by this point.
      try {
        await updateDoc(doc(db, 'toeflAttempts', attemptId), {
          completedAt: serverTimestamp(),
          draftContent: null,
          draftSavedAt: null,
        })
      } catch (err) {
        console.error('could not complete attempt', attemptId, err)
      }

      navigate(`/results/${ref.id}`)
    } catch (err) {
      setSubmitError(err.message)
      submittedRef.current = false // autosave resumes if the student retries
      setSubmitting(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loadError) {
    return <Shell><p className="text-red-600 text-sm">{loadError}</p></Shell>
  }
  if (!item) {
    return <Shell><p className="text-sm text-gray-500">Loading item…</p></Shell>
  }
  if (!studentId) {
    return (
      <Shell>
        <p className="text-red-600 text-sm">
          No b10Id claim on this account — a submission would be rejected by the
          security rules. Sign in as a student.
        </p>
      </Shell>
    )
  }

  return (
    <Shell>
      <p className="font-mono text-xs text-gray-400 mb-1">
        {item.itemId} · {item.taskType}
      </p>

      {item.taskType === 'EM' ? (
        <EmailStimulus item={item} />
      ) : (
        <DiscussionStimulus item={item} />
      )}

      <label htmlFor="typed-response" className="block text-sm font-semibold mb-2">
        Your response
      </label>
      {/* Spellcheck, autocorrect and autocapitalize are off: the test's own
          writing interface has none of them. Disabled until the attempt
          resolves, so a recovered draft can't overwrite text typed first. */}
      <textarea
        id="typed-response"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={!attemptId || submitting}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        rows={14}
        className="w-full p-3 border border-gray-300 rounded-lg text-sm leading-relaxed disabled:bg-gray-50"
      />

      <div className="flex justify-between text-xs text-gray-500 mt-1 mb-4">
        <span>
          {wordCount} {wordCount === 1 ? 'word' : 'words'}
        </span>
        <SaveStatus state={saveState} lastSavedAt={lastSavedAt} />
      </div>

      {submitError && (
        <p className="text-red-600 text-sm mb-3">{submitError}</p>
      )}

      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-40"
        style={{ backgroundColor: '#1e3a5f' }}
      >
        {submitting ? 'Submitting…' : 'Submit'}
      </button>
      {text.trim().length === 0 && (
        <p className="text-xs text-gray-400 mt-2 text-center">
          Write a response to submit.
        </p>
      )}
    </Shell>
  )
}

function EmailStimulus({ item }) {
  const header = item.prompt?.header
  return (
    <>
      <div className="mb-4 p-4 bg-gray-50 rounded-lg">
        <p className="text-sm leading-relaxed whitespace-pre-line">
          {item.stimulus?.scenarioText}
        </p>
      </div>

      {item.prompt?.requiredElements?.length > 0 && (
        <div className="mb-6">
          <p className="text-sm font-semibold mb-2">In your email, do the following:</p>
          <ul className="list-disc pl-5 text-sm space-y-1">
            {item.prompt.requiredElements.map((element, i) => (
              <li key={i}>{element}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Pre-filled and read-only: not part of what the student writes. */}
      <div className="mb-3 text-sm border-b border-gray-200 pb-2">
        <p><span className="text-gray-500 inline-block w-16">To:</span>{header?.to}</p>
        <p><span className="text-gray-500 inline-block w-16">Subject:</span>{header?.subject}</p>
      </div>
    </>
  )
}

function DiscussionStimulus({ item }) {
  const peers = item.stimulus?.peerResponses ?? []
  return (
    <>
      <div className="mb-4 p-4 bg-gray-50 rounded-lg">
        <p className="text-sm leading-relaxed whitespace-pre-line">
          {item.stimulus?.professorPrompt}
        </p>
      </div>

      <div className="mb-6 space-y-4">
        {peers.map((peer) => (
          <div key={peer.label} className="pl-4 border-l-2 border-gray-200">
            {/* peerName is null for most real items (26 of 30); the letter is
                the fallback, never an invented name. */}
            <p className="text-xs font-semibold text-gray-500 mb-1">
              {peer.peerName ?? `Student ${peer.label}`}
            </p>
            <p className="text-sm leading-relaxed whitespace-pre-line">{peer.text}</p>
          </div>
        ))}
      </div>
    </>
  )
}

function SaveStatus({ state, lastSavedAt }) {
  if (state === 'saving') return <span>Saving draft…</span>
  if (state === 'error') {
    return <span className="text-amber-700">Draft not saved — keep writing</span>
  }
  if (state === 'saved' && lastSavedAt) {
    return (
      <span>
        Draft saved{' '}
        {lastSavedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
      </span>
    )
  }
  return <span />
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="w-full max-w-2xl mx-auto bg-white rounded-2xl shadow-md p-6">
        {children}
      </div>
    </div>
  )
}
