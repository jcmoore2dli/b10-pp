import { useNavigate, useParams } from 'react-router-dom'
import { getPassageById, passages } from '../data/passages'

/**
 * Screen 5 — Feedback Screen
 * Spec §3.6, §8.5
 *
 * Phase 1 STUB — scaffold only.
 * Real scoring data from Claude API arrives in Phase 2.
 * This screen renders the layout with placeholder content.
 *
 * Passage text IS revealed here (spec §3.6, §8.5).
 *
 * Navigation options:
 *   1. Retry this passage → Recording Screen
 *   2. Next passage → Passage Detail (next in assigned set)
 *   3. Return to menu → Passage Menu
 */

// Phase 1 placeholder feedback data
const PLACEHOLDER_FEEDBACK = {
  score: 3,
  score_label: 'Good',
  strengths:
    'You accurately conveyed the central finding and identified the main causal relationship in the passage.',
  gaps:
    'The counter-intuitive element in the second half of the passage was not captured in your response.',
  language_feedback:
    'Consider using contrast markers such as "however" or "surprisingly" to signal unexpected findings.',
  transcript_note: null,
  transcript:
    '[Transcript will appear here after Whisper transcription — Phase 2]',
}

const SCORE_CONFIG = {
  1: { label: 'Inaccurate', color: 'bg-red-100 text-red-700 border-red-200' },
  2: { label: 'Partial', color: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  3: { label: 'Good', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  4: { label: 'Excellent', color: 'bg-green-100 text-green-700 border-green-200' },
}

export default function FeedbackScreen() {
  const { passageId } = useParams()
  const navigate = useNavigate()
  const passage = getPassageById(passageId)

  if (!passage) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-red-600 font-semibold mb-2">Passage not found.</p>
          <button onClick={() => navigate('/passages')} className="text-blue-700 underline text-sm">
            Return to passage menu
          </button>
        </div>
      </div>
    )
  }

  const feedback = PLACEHOLDER_FEEDBACK
  const scoreConf = SCORE_CONFIG[feedback.score] || SCORE_CONFIG[1]

  // Find next passage in the full list for "Next passage" navigation
  const currentIndex = passages.findIndex((p) => p.passage_id === passageId)
  const nextPassage = currentIndex >= 0 ? passages[currentIndex + 1] : null

  const isLowScore = feedback.score <= 2

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header
        className="px-4 py-4"
        style={{ backgroundColor: '#1e3a5f' }}
      >
        <p className="text-white font-bold text-base">Feedback</p>
        <p className="text-blue-200 text-xs">{passage.passage_id} · {passage.domain}</p>
      </header>

      <main className="px-4 py-6 max-w-lg mx-auto flex flex-col gap-5">

        {/* Score badge */}
        <div className={`flex items-center gap-4 border rounded-xl p-5 ${scoreConf.color}`}>
          <div className={`text-4xl font-black w-14 h-14 rounded-full flex items-center justify-center border-2 ${scoreConf.color}`}>
            {feedback.score}
          </div>
          <div>
            <p className="font-bold text-lg">{feedback.score_label}</p>
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
            {feedback.transcript}
          </p>
        </FeedbackSection>

        {/* Passage reveal */}
        <FeedbackSection title="The passage:">
          <p className="text-sm text-gray-700 leading-relaxed">{passage.text}</p>
        </FeedbackSection>

        {/* Strengths */}
        <FeedbackSection title="What you did well:">
          <p className="text-sm text-gray-700 leading-relaxed">{feedback.strengths}</p>
        </FeedbackSection>

        {/* Gaps */}
        <FeedbackSection title="What to work on:">
          <p className="text-sm text-gray-700 leading-relaxed">{feedback.gaps}</p>
        </FeedbackSection>

        {/* Language feedback — hidden if null */}
        {feedback.language_feedback && (
          <FeedbackSection title="Language note:">
            <p className="text-sm text-gray-700 leading-relaxed">{feedback.language_feedback}</p>
          </FeedbackSection>
        )}

        {/* Transcript note — hidden if null */}
        {feedback.transcript_note && (
          <p className="text-xs text-gray-400 italic">{feedback.transcript_note}</p>
        )}

        {/* Navigation actions */}
        <div className="flex flex-col gap-3 pt-2 pb-8">
          {/* Retry — visually emphasized for score 1-2 */}
          <button
            onClick={() => navigate(`/record/${passageId}`)}
            className="w-full py-4 rounded-xl font-bold text-white text-base"
            style={{ backgroundColor: isLowScore ? '#c0392b' : '#1e3a5f' }}
          >
            Retry This Passage
          </button>

          {nextPassage ? (
            <button
              onClick={() => navigate(`/passage/${nextPassage.passage_id}`)}
              className="w-full py-4 rounded-xl font-semibold text-white text-base"
              style={{ backgroundColor: '#2c5282' }}
            >
              Next Passage
            </button>
          ) : (
            <button
              disabled
              className="w-full py-4 rounded-xl font-semibold text-gray-400 text-base bg-gray-100"
            >
              Next Passage (end of set)
            </button>
          )}

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
