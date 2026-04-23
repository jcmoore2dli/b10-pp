// src/screens/FeedbackScreen.jsx
//
// Screen 5 — Feedback Screen (Phase 2A)
//
// Reads submission data from router state (set by RecordingScreen on "complete").
// State shape: { submissionData: { ...Firestore submission doc fields } }
//
// Score display rules (sprint spec):
//   taskFamily LEVEL3 (ESO) → X / 4
//   taskFamily LEVEL2       → X / 3
//   Contextual line:
//     3/3 or 4/4 → "Target reached"
//     3/4        → "Developing toward target"
//     2/3 or 2/4 → "Developing toward target"
//     1/3 or 1/4 → "Keep working — target is 3/3 or 4/4"
//
// INVARIANTS:
//   - No ILR labels anywhere in student-facing copy
//   - score_label displayed as-is (Insufficient / Partial / Good / Excellent)
//   - transcript_note shown only if non-empty (plain language)
//   - disfluencyMetadata never shown to student

import { useNavigate, useParams, useLocation } from 'react-router-dom'

// ── Score display helpers ─────────────────────────────────────────────────────

function getScoreMax(taskFamily) {
  return taskFamily === 'LEVEL3' ? 4 : 3
}

function getContextualLine(score, scoreMax) {
  if (score === scoreMax) return 'Target reached'
  if (score === 1) return `Keep working — target is 3/${scoreMax} or ${scoreMax}/${scoreMax}`
  return 'Developing toward target'
}

function getScoreColors(score, scoreMax) {
  if (score === scoreMax) return 'bg-green-100 text-green-700 border-green-200'
  if (score === 1)        return 'bg-red-100 text-red-700 border-red-200'
  if (score >= scoreMax - 1) return 'bg-blue-100 text-blue-700 border-blue-200'
  return 'bg-yellow-100 text-yellow-700 border-yellow-200'
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FeedbackScreen() {
  const { passageId } = useParams()
  const navigate      = useNavigate()
  const { state }     = useLocation()

  // Guard: if arrived without submission data, redirect
  if (!state?.submissionData || state.submissionData.score == null) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-gray-600 mb-3">No feedback data found.</p>
          <button
            onClick={() => navigate('/passages')}
            className="text-blue-700 underline text-sm"
          >
            Return to passage menu
          </button>
        </div>
      </div>
    )
  }

  const {
    score,
    score_label,
    taskFamily,
    strengths,
    gaps,
    language_feedback,
    transcript_note,
    transcriptText,
  } = state.submissionData

  const scoreMax       = getScoreMax(taskFamily)
  const contextualLine = getContextualLine(score, scoreMax)
  const scoreColors    = getScoreColors(score, scoreMax)
  const isLowScore     = score <= 1

  function handleRetry() {
    navigate(`/record/${passageId}`)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header className="px-4 py-4" style={{ backgroundColor: '#1e3a5f' }}>
        <p className="text-white font-bold text-base">Feedback</p>
        <p className="text-blue-200 text-xs">{passageId}</p>
      </header>

      <main className="px-4 py-6 max-w-lg mx-auto flex flex-col gap-5">

        {/* Score badge — X / N format, no ILR labels */}
        <div className={`flex items-center gap-4 border rounded-xl p-5 ${scoreColors}`}>
          <div
            className={`text-4xl font-black w-16 h-16 rounded-full flex items-center justify-center border-2 shrink-0 ${scoreColors}`}
          >
            {score}/{scoreMax}
          </div>
          <div>
            <p className="font-bold text-lg">{score_label}</p>
            <p className="text-sm opacity-80">{contextualLine}</p>
          </div>
        </div>

        {/* Strengths */}
        {strengths && (
          <FeedbackSection title="What you did well:">
            <p className="text-sm text-gray-700 leading-relaxed">{strengths}</p>
          </FeedbackSection>
        )}

        {/* Gaps */}
        {gaps && (
          <FeedbackSection title="What to work on:">
            <p className="text-sm text-gray-700 leading-relaxed">{gaps}</p>
          </FeedbackSection>
        )}

        {/* Language feedback */}
        {language_feedback && (
          <FeedbackSection title="Language note:">
            <p className="text-sm text-gray-700 leading-relaxed">{language_feedback}</p>
          </FeedbackSection>
        )}

        {/* Transcript note — plain language, shown only if non-empty */}
        {transcript_note && (
          <FeedbackSection title="Note on your recording:">
            <p className="text-sm text-gray-700 leading-relaxed">{transcript_note}</p>
          </FeedbackSection>
        )}

        {/* What we heard — transcript */}
        {transcriptText && (
          <FeedbackSection title="What we heard:">
            <p className="text-sm text-gray-600 font-mono bg-gray-50 rounded-lg p-3 leading-relaxed">
              {transcriptText}
            </p>
          </FeedbackSection>
        )}

        {/* Navigation */}
        <div className="flex flex-col gap-3 pt-2 pb-8">
          <button
            onClick={handleRetry}
            className={`w-full rounded-xl font-bold text-white ${
              isLowScore ? 'py-5 text-lg' : 'py-4 text-base'
            }`}
            style={{ backgroundColor: isLowScore ? '#c0392b' : '#1e3a5f' }}
          >
            Try Again
          </button>

          <button
            onClick={() => navigate('/passages')}
            className="w-full py-4 rounded-xl font-semibold text-white text-base"
            style={{ backgroundColor: '#6b7280' }}
          >
            Return to Menu
          </button>
        </div>

      </main>
    </div>
  )
}

function FeedbackSection({ title, children }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{title}</p>
      {children}
    </div>
  )
}
