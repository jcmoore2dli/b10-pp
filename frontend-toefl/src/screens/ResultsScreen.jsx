// src/screens/ResultsScreen.jsx
// Feedback screen — reads back what the scoring trigger wrote.
//
// The client never computes correctness. It waits for perQuestionResults to
// appear on its own submission (written server-side via the Admin SDK) and
// renders it. Until that arrives there is nothing here to show, because the
// answer genuinely is not on the client yet.
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { db } from '../services/firebase'
import { DISPLAY_LABELS, orderForQuestion } from '../lib/shuffle'

export default function ResultsScreen() {
  const { submissionId } = useParams()
  const [submission, setSubmission] = useState(null)
  const [attempt, setAttempt] = useState(null)
  const [item, setItem] = useState(null)
  const [error, setError] = useState(null)

  // Live subscription: the trigger writes perQuestionResults a moment after
  // the submission is created, so this screen watches rather than polls.
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'toeflSubmissions', submissionId),
      (snap) => {
        if (!snap.exists()) {
          setError(`No submission "${submissionId}".`)
          return
        }
        setSubmission(snap.data())
      },
      (err) => setError(err.message)
    )
    return unsub
  }, [submissionId])

  // The attempt carries displayOrder — the only record of which option showed
  // as A, B, C or D in this particular delivery.
  useEffect(() => {
    if (!submission?.attemptId) return
    getDoc(doc(db, 'toeflAttempts', submission.attemptId))
      .then((snap) => snap.exists() && setAttempt(snap.data()))
      .catch((err) => setError(err.message))
  }, [submission?.attemptId])

  // The item carries the option text.
  useEffect(() => {
    if (!attempt?.itemId) return
    getDoc(doc(db, 'toeflItems', attempt.itemId))
      .then((snap) => snap.exists() && setItem(snap.data()))
      .catch((err) => setError(err.message))
  }, [attempt?.itemId])

  if (error) return <Shell><p className="text-red-600 text-sm">{error}</p></Shell>

  if (submission?.scoringStatus === 'error') {
    return (
      <Shell>
        <p className="text-red-600 text-sm">
          Scoring failed for this submission. The answers are saved; check the
          function logs.
        </p>
      </Shell>
    )
  }

  const results = submission?.perQuestionResults
  if (!results || !attempt || !item) {
    return (
      <Shell>
        <p className="text-sm text-gray-500">
          Scoring… <span className="font-mono text-xs text-gray-400">
            ({submission?.scoringStatus ?? 'loading'})
          </span>
        </p>
        <p className="text-xs text-gray-400 mt-2">
          Correctness is computed server-side; nothing to show until it lands.
        </p>
      </Shell>
    )
  }

  const correctCount = results.filter((r) => r.isCorrect).length

  return (
    <Shell>
      <p className="font-mono text-xs text-gray-400 mb-1">
        {attempt.itemId} · {submission.taskType}
      </p>
      <h1 className="text-xl font-bold mb-5" style={{ color: '#1e3a5f' }}>
        {correctCount} of {results.length} correct
      </h1>

      {results.map((r) => {
        const question = item.questions.find(
          (q) => q.questionIndex === r.questionIndex
        )
        // Fall back to stored order if displayOrder is somehow absent, so a
        // letter is never silently wrong — worst case it is the stored order,
        // which for a locked question is exactly right anyway.
        const order =
          orderForQuestion(attempt.displayOrder, r.questionIndex).length > 0
            ? orderForQuestion(attempt.displayOrder, r.questionIndex)
            : question?.options.map((o) => o.optionId) ?? []

        const letter = (optionId) => {
          const i = order.indexOf(optionId)
          return i === -1 ? '?' : DISPLAY_LABELS[i]
        }
        const textOf = (optionId) =>
          question?.options.find((o) => o.optionId === optionId)?.text ?? ''
        const rationaleOf = (optionId) =>
          r.rationales?.find((x) => x.optionId === optionId)?.rationale ?? ''

        return (
          <div
            key={r.questionIndex}
            className={`mb-4 p-4 rounded-lg border-l-4 ${
              r.isCorrect
                ? 'border-green-600 bg-green-50'
                : 'border-red-600 bg-red-50'
            }`}
          >
            <p className="text-sm font-semibold mb-2 whitespace-pre-line">
              {r.questionIndex + 1}. {question?.stem}
              {question?.locked === true && (
                <span className="ml-2 font-normal font-mono text-xs text-amber-700">
                  [locked]
                </span>
              )}
            </p>

            <p className="text-sm mb-1">
              <strong>{r.isCorrect ? 'Correct' : 'Incorrect'}</strong>
              {' — you chose '}
              <strong>{letter(r.selectedOptionId)}</strong>
              {`. ${textOf(r.selectedOptionId)}`}
            </p>

            {!r.isCorrect && (
              <p className="text-sm mb-2">
                {'Correct answer: '}
                <strong>{letter(r.correctOptionId)}</strong>
                {`. ${textOf(r.correctOptionId)}`}
              </p>
            )}

            <p className="text-xs text-gray-700 mt-2">
              {rationaleOf(r.selectedOptionId)}
            </p>
            {!r.isCorrect && (
              <p className="text-xs text-gray-700 mt-1">
                {rationaleOf(r.correctOptionId)}
              </p>
            )}
          </div>
        )
      })}

      <Link to="/items" className="text-blue-600 underline text-xs">
        ← items
      </Link>
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
