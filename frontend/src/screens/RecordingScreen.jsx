import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getPassageById } from '../data/passages'
import { useRecorder } from '../hooks/useRecorder'
import AudioPlayer from '../components/AudioPlayer'
import { transcribe } from '../services/transcription/WhisperTranscriber'
import { evaluate } from '../services/scoring/ScoringService'

/**
 * Screen 4 — Recording Screen (Oral Paraphrase)
 *
 * Pipeline: audio → transcript → evaluate() → result → FeedbackScreen
 *
 * Architectural rules enforced:
 *   - Passage text never displayed on this screen
 *   - audioBlob explicitly released after transcription
 *   - ScoringService.evaluate() called — never ClaudeScorer directly
 *   - No re-recording after submission
 */

// phase: 'idle' | 'recording' | 'analyzing'
export default function RecordingScreen() {
  const { passageId } = useParams()
  const navigate = useNavigate()
  const passage = getPassageById(passageId)
  const { isRecording, startRecording, stopRecording, error: recorderError } = useRecorder()

  const [phase, setPhase] = useState('idle')
  const [errorMessage, setErrorMessage] = useState(null)

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

  async function handleRecord() {
    setErrorMessage(null)
    const { success, error } = await startRecording()
    if (!success) {
      setErrorMessage(error)
    } else {
      setPhase('recording')
    }
  }

  async function handleStopAndSubmit() {
    setPhase('analyzing')
    let audioBlob = await stopRecording()

    try {
      const { transcript } = await transcribe(audioBlob)
      // Explicitly release audio blob — must not persist
      audioBlob = null

      const result = await evaluate({
        transcript,
        passageText: passage.passage_text,
        passageId: passage.passage_id,
      })

      navigate(`/feedback/${passageId}`, {
        state: {
          score: result.score,
          score_label: result.score_label,
          transcript,
          strengths: result.strengths,
          gaps: result.gaps,
          language_note: result.language_note,
          passageText: passage.passage_text,
          passageId: passage.passage_id,
        },
      })
    } catch (err) {
      setErrorMessage('Something went wrong. Please try again.')
      setPhase('idle')
    }
  }

  const isAnalyzing = phase === 'analyzing'

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header className="px-4 py-4 flex items-center gap-3" style={{ backgroundColor: '#1e3a5f' }}>
        {phase === 'idle' && (
          <button
            onClick={() => navigate(`/passage/${passageId}`)}
            className="text-blue-200 hover:text-white p-1 -ml-1 rounded"
            aria-label="Back to passage detail"
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
        <div>
          <p className="text-white font-bold text-base">Recording</p>
          <p className="text-blue-200 text-xs">{passage.passage_id}</p>
        </div>
      </header>

      <main className="px-4 py-8 max-w-lg mx-auto flex flex-col items-center gap-6">
        {/* Task prompt */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 w-full text-center">
          <p className="text-blue-900 font-medium text-base leading-relaxed">
            Listen carefully, then record your paraphrase of the passage.
          </p>
        </div>

        {isAnalyzing ? (
          /* Analyzing state */
          <div className="flex flex-col items-center gap-4 py-10">
            <div className="w-12 h-12 rounded-full border-4 border-blue-200 border-t-blue-700 animate-spin" />
            <p className="text-gray-600 font-medium">Analyzing your response...</p>
          </div>
        ) : (
          <>
            {/* Replay audio — hidden while recording */}
            {!isRecording && (
              <div className="w-full">
                <AudioPlayer audioSrc={passage.audio_file} />
              </div>
            )}

            {/* Microphone indicator */}
            <div className="flex flex-col items-center gap-3">
              <div
                className={`w-20 h-20 rounded-full flex items-center justify-center transition-colors ${
                  isRecording ? 'bg-red-100' : 'bg-gray-100'
                }`}
              >
                <svg
                  className={`w-10 h-10 ${isRecording ? 'text-red-500' : 'text-gray-300'}`}
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 2a4 4 0 014 4v6a4 4 0 01-8 0V6a4 4 0 014-4z" />
                  <path d="M6 10a1 1 0 012 0 4 4 0 008 0 1 1 0 112 0 6 6 0 01-5 5.917V18h2a1 1 0 010 2H9a1 1 0 010-2h2v-2.083A6 6 0 016 10z" />
                </svg>
              </div>

              {isRecording && (
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-red-600 font-semibold text-sm">Recording…</span>
                </div>
              )}
            </div>

            {/* Error message */}
            {(errorMessage || recorderError) && (
              <div className="w-full bg-red-50 border border-red-200 rounded-xl p-4 text-center">
                <p className="text-red-700 text-sm">{errorMessage || recorderError}</p>
              </div>
            )}

            {/* Record / Stop+Submit */}
            {!isRecording ? (
              <button
                onClick={handleRecord}
                className="w-full py-4 rounded-xl font-bold text-white text-base"
                style={{ backgroundColor: '#1e3a5f' }}
              >
                Record
              </button>
            ) : (
              <button
                onClick={handleStopAndSubmit}
                className="w-full py-4 rounded-xl font-bold text-white text-base bg-red-600"
              >
                Stop / Submit
              </button>
            )}
          </>
        )}
      </main>
    </div>
  )
}
