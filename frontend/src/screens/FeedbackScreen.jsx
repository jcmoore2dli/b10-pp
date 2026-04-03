import { useNavigate, useParams, useLocation } from 'react-router-dom'

/**
 * Screen 5 — Feedback Screen
 *
 * Reads all fields from React Router location.state (set by RecordingScreen).
 * Passage text is revealed here for the first time.
 *
 * State shape (from RecordingScreen):
 *   score, score_label, transcript, strengths, gaps,
 *   language_note, passageText, passageId
 *
 * Retry emphasis rule: score 1 or 2 → Retry button is primary/emphasized.
 * Retry clears all prior session state by navigating to RecordingScreen fresh.
 */

const SCORE_CONFIG = {
  1: { label: 'Inaccurate', color: 'bg-red-100 text-red-700 border-red-200' },
  2: { label: 'Partial',    color: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  3: { label: 'Good',       color: 'bg-blue-100 text-blue-700 border-blue-200' },
  4: { label: 'Excellent',  color: 'bg-green-100 text-green-700 border-green-200' },
}

export default function FeedbackScreen() {
  const { passageId } = useParams()
  const navigate = useNavigate()
  const { state } = useLocation()

  // Guard: if arrived without scoring state (e.g. direct URL), redirect to menu
  if (!state || state.score == null) {
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

  const { score, score_label, transcript, strengths, gaps, language_note, passageText } = state
  const scoreConf = SCORE_CONFIG[score] || SCORE_CONFIG[1]
  const isLowScore = score <= 2

  function handleRetry() {
    // Navigate to RecordingScreen with no state — ensures clean session
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

        {/* Score badge */}
        <div className={`flex items-center gap-4 border rounded-xl p-5 ${scoreConf.color}`}>
          <div
            className={`text-4xl font-black w-14 h-14 rounded-full flex items-center justify-center border-2 shrink-0 ${scoreConf.color}`}
          >
            {score}
          </div>
          <div>
            <p className="font-bold text-lg">{score_label}</p>
            <p className="text-sm opacity-80">B10 4-point paraphrase scale</p>
          </div>
        </div>

        {/* Retry prompt for low scores */}
        {isLowScore && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
            <p className="text-amber-800 font-semibold text-sm">
              Try again — you can improve this.
            </p>
          </div>
        )}

        {/* What we heard you say */}
        <FeedbackSection title="What we heard you say:">
          <p className="text-sm text-gray-600 font-mono bg-gray-50 rounded-lg p-3 leading-relaxed">
            {transcript}
          </p>
        </FeedbackSection>

        {/* Passage reveal — first time shown */}
        <FeedbackSection title="The passage:">
          <p className="text-sm text-gray-700 leading-relaxed">{passageText}</p>
        </FeedbackSection>

        {/* Strengths */}
        <FeedbackSection title="What you did well:">
          <p className="text-sm text-gray-700 leading-relaxed">{strengths}</p>
        </FeedbackSection>

        {/* Gaps */}
        <FeedbackSection title="What to work on:">
          <p className="text-sm text-gray-700 leading-relaxed">{gaps}</p>
        </FeedbackSection>

        {/* Language note — hidden if null/empty */}
        {language_note && (
          <FeedbackSection title="Language note:">
            <p className="text-sm text-gray-700 leading-relaxed">{language_note}</p>
          </FeedbackSection>
        )}

        {/* Navigation */}
        <div className="flex flex-col gap-3 pt-2 pb-8">
          {/* Retry — emphasized (larger/primary) for score 1-2 */}
          <button
            onClick={handleRetry}
            className={`w-full rounded-xl font-bold text-white ${
              isLowScore ? 'py-5 text-lg' : 'py-4 text-base'
            }`}
            style={{ backgroundColor: isLowScore ? '#c0392b' : '#1e3a5f' }}
          >
            Retry This Passage
          </button>

          <button
            onClick={() => navigate('/passages')}
            className="w-full py-4 rounded-xl font-semibold text-white text-base"
            style={{ backgroundColor: isLowScore ? '#6b7280' : '#2c5282' }}
          >
            Next Passage
          </button>

          <button
            onClick={() => navigate('/passages')}
            className="w-full py-4 rounded-xl font-semibold text-gray-700 text-base bg-white border border-gray-200"
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
