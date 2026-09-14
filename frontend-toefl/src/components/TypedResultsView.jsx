// src/components/TypedResultsView.jsx
// Results view for EM and DISC — reads back what the scoring trigger wrote.
//
// Rendered by ResultsScreen, which already holds the live submission snapshot
// plus the attempt and item. This component only presents them. It never
// computes a score: layerA is the trigger's (LayerAB spec §5), instructor is
// the confirmation UI's.
//
// Shown to the student:
//   · layerA.score, labeled provisional until an instructor confirms it. Shown
//     rather than hidden: the read rule already exposes the whole submission,
//     so hiding would be cosmetic, and with no confirmation screen built yet it
//     would mean no score at all through W1–2.
//   · layerB.items — the human-readable feedback.
// Not shown:
//   · layerB.flags — raw codes (ELEMENT_UNADDRESSED, INCOMPLETE_DATA, ...).
//     Anything a student needs from them is already in layerB.items' text, and
//     INCOMPLETE_DATA is about the item's data, not the student's writing.
//   · instructor.reason — logged for calibration; no decision yet that it is
//     student-facing.
import { Link } from 'react-router-dom'

export default function TypedResultsView({ submission, attempt, item }) {
  if (submission.scoringStatus === 'error') {
    return (
      <Shell>
        <p className="text-red-600 text-sm">
          Scoring failed for this submission. Your response is saved; check the
          function logs.
        </p>
      </Shell>
    )
  }

  const { layerA, layerB, status, instructor } = submission
  if (submission.scoringStatus !== 'scored' || !layerA || !attempt || !item) {
    return (
      <Shell>
        <p className="text-sm text-gray-500">
          Scoring… <span className="font-mono text-xs text-gray-400">
            ({submission.scoringStatus ?? 'loading'})
          </span>
        </p>
        <p className="text-xs text-gray-400 mt-2">
          Your response is being scored. This usually takes a few seconds.
        </p>
      </Shell>
    )
  }

  // Confirmation is keyed on confirmedAt, not instructorBand: a null band on a
  // confirmed submission means confirmed as scored, not unconfirmed.
  const confirmed = !!instructor?.confirmedAt
  const adjusted =
    confirmed &&
    instructor.instructorBand != null &&
    instructor.instructorBand !== layerA.score
  const band = adjusted ? instructor.instructorBand : layerA.score

  let scoreNote
  if (adjusted) {
    scoreNote = `Confirmed by your instructor (adjusted from provisional band ${layerA.score}).`
  } else if (confirmed) {
    scoreNote = 'Confirmed by your instructor.'
  } else if (status?.instructorConfirmRequired) {
    scoreNote = 'Provisional — your instructor will review this score.'
  } else {
    scoreNote = 'Provisional score.'
  }

  // Rationale belongs to the provisional judgment. Once an instructor has
  // changed the band it no longer explains the number shown, so it is hidden.
  const showRationale = !adjusted && layerA.score > 0 && layerA.rationale
  const showGateReason =
    !adjusted && layerA.score === 0 && typeof layerA.band0Gate === 'string'

  const feedback = layerB?.items ?? []
  const response = submission.responseContent ?? {}

  return (
    <Shell>
      <p className="font-mono text-xs text-gray-400 mb-1">
        {attempt.itemId} · {submission.taskType}
      </p>

      <h1 className="text-xl font-bold" style={{ color: '#1e3a5f' }}>
        Band {band} of 5
      </h1>
      <p
        className={`text-xs mb-3 ${
          confirmed ? 'text-green-700' : 'text-amber-700'
        }`}
      >
        {scoreNote}
      </p>
      {showRationale && (
        <p className="text-sm text-gray-700 mb-6">{layerA.rationale}</p>
      )}
      {showGateReason && (
        <p className="text-sm text-gray-700 mb-6">{layerA.band0Gate}</p>
      )}

      {feedback.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold">Feedback</h2>
          {layerB.label && (
            <p className="text-xs text-gray-400 mb-3">{layerB.label}</p>
          )}
          {feedback.map((f, i) => (
            <div
              key={i}
              className="mb-3 p-4 rounded-lg border-l-4 border-blue-600 bg-blue-50"
            >
              <p className="text-sm font-semibold mb-1">{f.feature}</p>
              <p className="text-sm mb-2">{f.observation}</p>
              <p className="text-sm">
                <strong>Next step:</strong> {f.target}
              </p>
            </div>
          ))}
        </div>
      )}

      <h2 className="text-sm font-semibold mb-2">Your response</h2>
      <div className="mb-1 p-4 bg-gray-50 rounded-lg">
        {submission.taskType === 'EM' && item.prompt?.header && (
          <div className="mb-3 text-sm border-b border-gray-200 pb-2">
            <p><span className="text-gray-500 inline-block w-16">To:</span>{item.prompt.header.to}</p>
            <p><span className="text-gray-500 inline-block w-16">Subject:</span>{item.prompt.header.subject}</p>
          </div>
        )}
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          {response.text}
        </p>
      </div>
      <p className="text-xs text-gray-400 mb-6">
        {response.wordCount} {response.wordCount === 1 ? 'word' : 'words'}
      </p>

      <details className="mb-6">
        <summary className="text-sm font-semibold cursor-pointer">The task</summary>
        <div className="mt-3">
          {submission.taskType === 'EM' ? (
            <>
              <p className="text-sm leading-relaxed whitespace-pre-line mb-3">
                {item.stimulus?.scenarioText}
              </p>
              <ul className="list-disc pl-5 text-sm space-y-1">
                {(item.prompt?.requiredElements ?? []).map((element, i) => (
                  <li key={i}>{element}</li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p className="text-sm leading-relaxed whitespace-pre-line mb-3">
                {item.stimulus?.professorPrompt}
              </p>
              {(item.stimulus?.peerResponses ?? []).map((peer) => (
                <div key={peer.label} className="mb-3 pl-4 border-l-2 border-gray-200">
                  <p className="text-xs font-semibold text-gray-500 mb-1">
                    {peer.peerName ?? `Student ${peer.label}`}
                  </p>
                  <p className="text-sm leading-relaxed whitespace-pre-line">{peer.text}</p>
                </div>
              ))}
            </>
          )}
        </div>
      </details>

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
