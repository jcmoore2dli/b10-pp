// src/screens/RecordingScreen.jsx
//
// Screen 4 — Recording Screen (Phase 2A)
//
// Pipeline:
//   Record → Stop/Submit → upload audio to Storage → create Firestore doc
//   → onSnapshot watches status → "complete" → navigate to FeedbackScreen
//
// ARCHITECTURAL INVARIANTS (enforced here):
//   - Submit button disabled immediately on tap (double-tap protection)
//   - Client never writes score/status fields after doc creation
//   - submissionNumber: 0 on creation — server assigns via transaction
//   - One-active-job check runs before doc creation (UX protection, not atomic)
//   - Audio blob released after Storage upload — never persisted in state
//   - Passage text never displayed on this screen

import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getPassageById } from '../data/passages'
import { useRecorder } from '../hooks/useRecorder'
import AudioPlayer from '../components/AudioPlayer'
import {
  uploadAudio,
  createSubmission,
  checkActiveJob,
  subscribeToSubmission,
} from '../services/submissionService'

// phase: 'idle' | 'recording' | 'uploading' | 'evaluating' | 'failed'
const STATUS_MESSAGES = {
  queued:     'Response submitted. Preparing evaluation…',
  processing: 'Evaluating your response…',
}

export default function RecordingScreen() {
  const { passageId } = useParams()
  const navigate      = useNavigate()
  const passage       = getPassageById(passageId)

  const { isRecording, startRecording, stopRecording, error: recorderError } = useRecorder()

  const [phase, setPhase]               = useState('idle')
  const [errorMessage, setErrorMessage] = useState(null)
  const [statusMessage, setStatusMessage] = useState('')
  const submittingRef = useRef(false)       // double-tap guard
  const unsubscribeRef = useRef(null)       // onSnapshot cleanup

  // Read b10Id from sessionStorage (set by EntryScreen)
  const b10Id = sessionStorage.getItem('b10pp_student_id') || 'UNKNOWN'

  // Cleanup onSnapshot on unmount
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) unsubscribeRef.current()
    }
  }, [])

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
    // Double-tap protection — ref-based so it survives re-renders
    if (submittingRef.current) return
    submittingRef.current = true

    setPhase('uploading')
    setStatusMessage('Uploading your response…')

    let audioBlob = await stopRecording()

    try {
      // ── One-active-job UX check ─────────────────────────────────────────
      // assignmentId derived from passageId for now — Phase 2B will pass real value
      const assignmentId = passage.passage_id
      const hasActive = await checkActiveJob(b10Id, assignmentId)
      if (hasActive) {
        setErrorMessage('An evaluation is already in progress for this passage. Please wait.')
        setPhase('idle')
        submittingRef.current = false
        audioBlob = null
        return
      }

      // ── Create placeholder Firestore doc to get submissionId ────────────
      // We need the submissionId before upload to build the Storage path.
      // Doc is created with status: "queued" — trigger fires on creation.
      // We must upload audio BEFORE the trigger reads audioPath.
      // Solution: create doc, upload audio to path using doc ID, then the
      // trigger will find the audio when it runs (Cloud Functions have ~10s
      // cold start buffer in practice, and retry logic handles edge cases).
      const { submissionId } = await createSubmission({
        b10Id,
        assignmentId,
        taskType:         passage.task_type      || 'NARRATION',
        passageId:        passage.passage_id,
        corpusType:       passage.corpus_type    || 'ORI',
        promptDescription: passage.prompt_description || '',
        scaffoldConfig:   passage.scaffold_config || {},
      })

      // ── Upload audio to Storage ─────────────────────────────────────────
      // Path uses submissionId so trigger can locate it.
      // Note: trigger may fire before upload completes on very fast connections.
      // Retry logic in processSubmission() handles this gracefully.
      setStatusMessage('Uploading audio…')
      await uploadAudio(b10Id, submissionId, audioBlob)
      audioBlob = null    // release — never persist blob in state

      // ── Subscribe to submission doc via onSnapshot ──────────────────────
      setPhase('evaluating')
      setStatusMessage(STATUS_MESSAGES.queued)

      unsubscribeRef.current = subscribeToSubmission(submissionId, (data) => {
        const { status } = data

        if (status === 'queued' || status === 'processing') {
          setStatusMessage(STATUS_MESSAGES[status] || 'Evaluating your response…')
          return
        }

        if (status === 'complete') {
          // Unsubscribe before navigating
          if (unsubscribeRef.current) {
            unsubscribeRef.current()
            unsubscribeRef.current = null
          }
          navigate(`/feedback/${passageId}`, { state: { submissionData: data } })
          return
        }

        if (status === 'failed') {
          if (unsubscribeRef.current) {
            unsubscribeRef.current()
            unsubscribeRef.current = null
          }
          setErrorMessage('Something went wrong. Please try again.')
          setPhase('idle')
          submittingRef.current = false
        }
      })

    } catch (err) {
      setErrorMessage('Something went wrong. Please try again.')
      setPhase('idle')
      submittingRef.current = false
      audioBlob = null
    }
  }

  const isEvaluating = phase === 'evaluating' || phase === 'uploading'

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
            {passage.prompt_description || 'Listen carefully, then record your response.'}
          </p>
        </div>

        {isEvaluating ? (
          /* Uploading / evaluating state */
          <div className="flex flex-col items-center gap-4 py-10">
            <div className="w-12 h-12 rounded-full border-4 border-blue-200 border-t-blue-700 animate-spin" />
            <p className="text-gray-600 font-medium text-center">{statusMessage}</p>
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
