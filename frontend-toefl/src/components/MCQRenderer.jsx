// src/components/MCQRenderer.jsx
// One renderer for the five MCQ types (AP, AT, RDL, LCR, LTA), per data model
// v1.15 Collection 1 — "the types sharing one renderer".
//
// What this component may and may not see:
//   · reads toeflItems/{itemId} — public display content, no secrets
//   · never reads toeflItems/{itemId}/answerKey/** — it has no read access and
//     makes no attempt. Correctness is entirely the scoring trigger's job.
//   · writes toeflSubmissions with the student's picks only. Nothing it writes
//     asserts or implies correctness.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../context/useAuth'
import {
  DISPLAY_LABELS,
  buildDisplayOrder,
  makeShuffleSeed,
  orderForQuestion,
} from '../lib/shuffle'

export default function MCQRenderer({ itemId }) {
  const { claims } = useAuth()
  const navigate = useNavigate()
  const studentId = claims?.b10Id ?? null

  const [item, setItem] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [attemptId, setAttemptId] = useState(null)
  const [selections, setSelections] = useState({}) // questionIndex -> optionId
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  // One base seed per delivery. Lazy initializer, so it is generated exactly
  // once for the life of this component and never regenerated on re-render —
  // re-seeding mid-item would reshuffle options under the student's cursor.
  const [seed] = useState(makeShuffleSeed)

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

  // ── Decide each question's on-screen option order ──────────────────────────
  // useMemo keyed on (item, seed): computed once per delivery, not per render.
  // buildDisplayOrder checks `locked` first and skips the shuffle for locked
  // questions — see src/lib/shuffle.js.
  //
  // Shape is the v1.15 displayOrder shape directly: [{questionIndex, order}].
  const displayOrder = useMemo(() => {
    if (!item?.questions) return []
    return item.questions.map((q) => ({
      questionIndex: q.questionIndex,
      order: buildDisplayOrder(q, seed),
    }))
  }, [item, seed])

  // ── Create the parent attempt, once ────────────────────────────────────────
  // toeflSubmissions.attemptId requires a real parent, and the spec puts the
  // seed and resulting order here so a flagged delivery can be reconstructed.
  // The ref guard keeps React 18 StrictMode's double-invoked effect from
  // creating two attempts in dev.
  const attemptStarted = useRef(false)
  useEffect(() => {
    if (!item || !studentId || displayOrder.length === 0) return
    if (attemptStarted.current) return
    attemptStarted.current = true
    ;(async () => {
      try {
        const ref = await addDoc(collection(db, 'toeflAttempts'), {
          studentId,
          itemId,
          taskType: item.taskType,
          courseWeek: 1, // fixture-level; real week gating is Build Week B/C
          freshness: 'fresh',
          optionShuffleSeed: seed,
          displayOrder, // v1.15: [{questionIndex, order: [...]}, ...]
          timingMode: 'untimed',
          startedAt: serverTimestamp(),
          completedAt: null,
          flaggedByStudent: false,
        })
        setAttemptId(ref.id)
      } catch (err) {
        setSubmitError(`Could not start attempt: ${err.message}`)
        attemptStarted.current = false // allow a retry
      }
    })()
  }, [item, studentId, displayOrder, itemId, seed])

  function choose(questionIndex, optionId) {
    setSelections((prev) => ({ ...prev, [questionIndex]: optionId }))
  }

  const allAnswered =
    item?.questions?.length > 0 &&
    item.questions.every((q) => selections[q.questionIndex] !== undefined)

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!allAnswered || !attemptId || submitting) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      // Exactly the v1.15 Collection 3 MCQ shape:
      //   responseContent: {answers: [{questionIndex, selectedOptionId}, ...]}
      // Note it carries optionIds, not display letters — the letter the student
      // saw is a property of this delivery, not of the answer.
      const answers = item.questions.map((q) => ({
        questionIndex: q.questionIndex,
        selectedOptionId: selections[q.questionIndex],
      }))

      const ref = await addDoc(collection(db, 'toeflSubmissions'), {
        attemptId,
        studentId,
        taskType: item.taskType,
        responseContent: { answers },
        scoringStatus: 'queued',
        scoredAt: null,
        // perQuestionResults is deliberately absent. It is the trigger's to
        // write, via the Admin SDK, and its absence is what the feedback
        // screen waits on.
      })

      // The attempt is complete at submit time — "marked complete when they
      // submit" (data model Collection 2) — not when scoring finishes. The
      // update rule allows this: it pins studentId and itemId, and this write
      // changes neither.
      //
      // Deliberately sequenced after the submission write, and deliberately
      // non-fatal. The answers are the record that matters and they are
      // already safe by this point; a failed timestamp should not strand the
      // student on the item screen or lose them their submission.
      try {
        await updateDoc(doc(db, 'toeflAttempts', attemptId), {
          completedAt: serverTimestamp(),
        })
      } catch (err) {
        console.error('could not set completedAt on attempt', attemptId, err)
      }

      navigate(`/results/${ref.id}`)
    } catch (err) {
      setSubmitError(err.message)
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

      {item.stimulus?.passageText && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <p className="text-sm leading-relaxed whitespace-pre-line">
            {item.stimulus.passageText}
          </p>
        </div>
      )}

      {item.questions.map((q) => {
        const order = orderForQuestion(displayOrder, q.questionIndex)
        return (
          <fieldset key={q.questionIndex} className="mb-6 border-0 p-0">
            <legend className="text-sm font-semibold mb-2 whitespace-pre-line">
              {q.questionIndex + 1}. {q.stem}
              {/* Build-time affordance so the locked/shuffled branch is
                  visible while testing. Remove before real student use — it is
                  internal state, not something a student needs. */}
              {q.locked === true && (
                <span className="ml-2 font-normal font-mono text-xs text-amber-700">
                  [locked · stored order]
                </span>
              )}
            </legend>

            {order.map((optionId, i) => {
              const option = q.options.find((o) => o.optionId === optionId)
              const checked = selections[q.questionIndex] === optionId
              return (
                <label
                  key={optionId}
                  className={`flex gap-3 items-start p-2 rounded cursor-pointer text-sm ${
                    checked ? 'bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    className="mt-1"
                    name={`q-${q.questionIndex}`}
                    checked={checked}
                    onChange={() => choose(q.questionIndex, optionId)}
                  />
                  <span>
                    <strong className="mr-1">{DISPLAY_LABELS[i]}.</strong>
                    {option?.text ?? `[missing option ${optionId}]`}
                  </span>
                </label>
              )
            })}
          </fieldset>
        )
      })}

      {submitError && (
        <p className="text-red-600 text-sm mb-3">{submitError}</p>
      )}

      <button
        onClick={handleSubmit}
        disabled={!allAnswered || !attemptId || submitting}
        className="w-full py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-40"
        style={{ backgroundColor: '#1e3a5f' }}
      >
        {submitting ? 'Submitting…' : 'Submit'}
      </button>
      {!allAnswered && (
        <p className="text-xs text-gray-400 mt-2 text-center">
          Answer every question to submit.
        </p>
      )}
    </Shell>
  )
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
