// src/screens/RecordingScreen.jsx
//
// Screen 4 — Recording Screen (Phase 2A)
//
// Pipeline:
//   Record → Stop/Submit → upload audio to Storage (timestamp path)
//   → create Firestore doc with known audioPath → onSnapshot watches status
//   → "complete" → navigate to FeedbackScreen
//
// ARCHITECTURAL INVARIANTS (enforced here):
//   - Submit button disabled immediately on tap (double-tap protection)
//   - Audio uploaded BEFORE Firestore doc created — audioPath always known at creation
//   - Client never writes score/status fields after doc creation
//   - submissionNumber: 0 on creation — server assigns via transaction
//   - One-active-job check runs before upload (UX protection, not atomic)
//   - Audio blob released after Storage upload — never persisted in state
//   - Passage text never displayed on this screen

import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { useRecorder } from '../hooks/useRecorder'
import AudioPlayer from '../components/AudioPlayer'
import { db, storage } from '../services/firebase'
import { doc, getDoc } from 'firebase/firestore'
import { ref, getDownloadURL } from 'firebase/storage'
import {
  uploadAudio,
  createSubmission,
  checkActiveJob,
  subscribeToSubmission,
} from '../services/submissionService'

// Status messages mapped from Firestore doc status field
const STATUS_MESSAGES = {
  queued:     'Response submitted. Preparing evaluation…',
  processing: 'Evaluating your response…',
}

export default function RecordingScreen() {
  const { passageId } = useParams()
  const navigate      = useNavigate()
  const [passage, setPassage]             = useState(null)
  const [audioUrl, setAudioUrl]           = useState(null)
  const [passageLoading, setPassageLoading] = useState(true)

  const { isRecording, startRecording, stopRecording, error: recorderError } = useRecorder()

  const SCAFFOLD_CUES = {
    'argument_structure': 'Focus: Make your point clearly, support it with a reason, then explain the broader significance.',
    'discourse_frame': {
      'FRAME_01': 'Focus: Consider both individual and societal levels. Shift between different groups affected.',
      'FRAME_02': 'Focus: Consider both short-term and long-term effects, costs, benefits, and unintended consequences.',
      'FRAME_03': 'Focus: Trace cause-and-effect relationships. Explain what leads to what and why.',
      'FRAME_04': 'Focus: Reason about possibilities and outcomes. Use if/then thinking to project what could happen.',
      'FRAME_05': 'Focus: Evaluate based on values and principles. Consider what is fair, right, or just.',
      'FRAME_06': 'Focus: Bring together different perspectives and make a reasoned overall judgment.',
    },
    'grammar_structure': {
      'STRUCT_01': 'Language focus: Use conditional structures — if/then, would, could — to express conditions and outcomes.',
      'STRUCT_02': 'Language focus: Use contrast and concession — although, however, even though, while — to show both sides.',
      'STRUCT_03': 'Language focus: Use relative clauses — who, which, that — to add detail and specify.',
      'STRUCT_04': 'Language focus: Use hedging language — may, might, could, it appears, arguably — to express uncertainty.',
      'STRUCT_05': 'Language focus: Use noun forms of verbs — development, reduction, implementation — for precision.',
      'STRUCT_06': 'Language focus: Use passive voice and reporting verbs — it is argued, research shows — to report and analyze.',
      'STRUCT_07': 'Language focus: Use parallel structure — similar grammatical forms — to list and compare clearly.',
    },
    'combined': null,
  }

  function getScaffoldCue() {
    try {
      const raw = sessionStorage.getItem('b10pp_scaffold')
      if (!raw) return null
      const sc = JSON.parse(raw)
      if (!sc || sc.focusArea === 'holistic') return null
      if (sc.focusArea === 'argument_structure') return SCAFFOLD_CUES.argument_structure
      if (sc.focusArea === 'discourse_frame') return SCAFFOLD_CUES.discourse_frame[sc.primaryFrame] || null
      if (sc.focusArea === 'grammar_structure') return SCAFFOLD_CUES.grammar_structure[sc.primaryStructure] || null
      if (sc.focusArea === 'combined') {
        const df = sc.primaryFrame ? SCAFFOLD_CUES.discourse_frame[sc.primaryFrame] : null
        const gs = sc.primaryStructure ? SCAFFOLD_CUES.grammar_structure[sc.primaryStructure] : null
        if (df && gs) return df + ' ' + gs
        return df || gs || null
      }
      return null
    } catch { return null }
  }
  // For ESO-AES Frames passages — inject cue from passage fields if no session scaffold
  function getFramesCue() {
    if (!passage?.passage_id?.startsWith('ESO-AES-')) return null
    if (getScaffoldCue()) return null  // session scaffold takes priority
    const frameLabels = {
      FRAME_01: 'Speaking Focus: Scale & Stakeholder — Consider who is affected and at what scale.',
      FRAME_02: 'Speaking Focus: Trade-offs & Constraints — What must be given up, and what limits apply?',
      FRAME_03: 'Speaking Focus: Causal Systems — Trace the causes and consequences at work.',
      FRAME_04: 'Speaking Focus: Hypothetical & Conditional — Consider what would happen if conditions changed.',
      FRAME_05: 'Speaking Focus: Values, Heuristics & Bias — What assumptions or values are driving this?',
      FRAME_06: 'Speaking Focus: Synthesis & Judgment — Weigh the evidence and reach a supported conclusion.',
    }
    return passage.suggestedPrimaryFrame ? (frameLabels[passage.suggestedPrimaryFrame] || null) : null
  }
  const scaffoldCue = getScaffoldCue() || getFramesCue()

  const [phase, setPhase]                 = useState('idle')
  const [errorMessage, setErrorMessage]   = useState(null)
  const [statusMessage, setStatusMessage] = useState('')
  const submittingRef  = useRef(false)   // double-tap guard
  const unsubscribeRef = useRef(null)    // onSnapshot cleanup

  useEffect(() => {
    async function loadPassage() {
      setPassageLoading(true)
      try {
        const docSnap = await getDoc(doc(db, 'passages', passageId))
        if (docSnap.exists()) {
          const d = docSnap.data()
          const normalized = {
            passage_id:          d.passageId || passageId,
            task_type:           (d.taskType || 'PARAPHRASE').toLowerCase(),
            corpus_type:         d.corpusType || 'COR',
            prompt_description:  d.taskType === 'EXTENDED_LISTENING'
              ? 'Listen to the passage up to 3 times. Then record yourself explaining: what does the passage say is actually happening, and why is that different from what people commonly assume?'
              : ['NARRATION','DESCRIPTION','INSTRUCTIONS'].includes(d.taskType)
              ? 'Record yourself speaking on this topic.'
              : d.promptDescription || 'Listen carefully, then record your paraphrase.',
            scaffold_config:        d.scaffoldConfig || {},
            audioPath:             d.audioPath || null,
            suggestedPrimaryFrame: d.suggestedPrimaryFrame || null,
            framesWeek:            d.framesWeek || null,
            framesFrame:           d.framesFrame || null,
          }
          setPassage(normalized)
          if (normalized.audioPath) {
            try {
              const url = await getDownloadURL(ref(storage, normalized.audioPath))
              setAudioUrl(url)
            } catch (e) {
              console.error('Audio fetch failed:', e)
            }
          }
        }
      } catch (err) {
        console.error('Failed to load passage:', err)
      } finally {
        setPassageLoading(false)
      }
    }
    loadPassage()
  }, [passageId])

  // Read b10Id from sessionStorage (set by EntryScreen)
  const { claims } = useAuth()
  const b10Id = claims?.b10Id || 'UNKNOWN'

  // Cleanup onSnapshot on unmount
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) unsubscribeRef.current()
    }
  }, [])

  if (passageLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-4 border-blue-200 border-t-blue-700 animate-spin" />
      </div>
    )
  }

  if (!passage) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-red-600 font-semibold mb-2">Passage not found.</p>
          <button onClick={() => navigate('/b10_practice_platform/passages')} className="text-blue-700 underline text-sm">
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
    // Double-tap protection
    if (submittingRef.current) return
    submittingRef.current = true

    setPhase('uploading')
    setStatusMessage('Stopping recording…')

    let audioBlob = await stopRecording()

    try {
      // ── One-active-job UX check ───────────────────────────────────────────
      const assignmentId = passage.passage_id
      const hasActive = await checkActiveJob(b10Id, assignmentId)
      if (hasActive) {
        setErrorMessage('An evaluation is already in progress for this passage. Please wait.')
        setPhase('idle')
        submittingRef.current = false
        audioBlob = null
        return
      }

      // ── Upload audio FIRST — use timestamp path, submissionId not yet known ─
      // audioPath must be known before creating the Firestore doc so the
      // Cloud Function trigger can locate the file immediately on creation.
      setStatusMessage('Uploading audio…')
      const tempId = `${b10Id}_${Date.now()}`
      const { audioPath } = await uploadAudio(b10Id, tempId, audioBlob)
      audioBlob = null  // release — never persist blob in state

      // ── Create Firestore doc with known audioPath ────────────────────────
      // onCreate trigger fires here. Audio is already in Storage.
      // Client writes only identity fields + audioPath + status/submissionNumber placeholders.
      const { submissionId } = await createSubmission({
        b10Id,
        assignmentId,
        taskType:          passage.task_type          || 'NARRATION',
        passageId:         passage.passage_id,
        corpusType:        passage.corpus_type        || 'ORI',
        promptDescription: passage.prompt_description || '',
        scaffoldConfig:    passage.scaffold_config    || {},
        audioPath,
      })

      // ── Subscribe to submission doc via onSnapshot ───────────────────────
      setPhase('evaluating')
      setStatusMessage(STATUS_MESSAGES.queued)

      // ── 45-second timeout guard ─────────────────────────────────────────
      const timeoutId = setTimeout(() => {
        if (unsubscribeRef.current) {
          unsubscribeRef.current()
          unsubscribeRef.current = null
        }
        setErrorMessage('Evaluation timed out. Please check your connection and try again.')
        setPhase('idle')
        submittingRef.current = false
      }, 45000)

      unsubscribeRef.current = subscribeToSubmission(submissionId, (data) => {
        clearTimeout(timeoutId)
       
        const { status } = data

        if (status === 'queued' || status === 'processing') {
          setStatusMessage(STATUS_MESSAGES[status] || 'Evaluating your response…')
          return
        }

        if (status === 'complete') {
          if (unsubscribeRef.current) {
            unsubscribeRef.current()
            unsubscribeRef.current = null
          }
          navigate(`/b10_practice_platform/feedback/${passageId}`, { state: { submissionData: data } })
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
      console.error('SUBMIT ERROR:', err.message, err)
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
            onClick={() => navigate(`/b10_practice_platform/passage/${passageId}`)}
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
        {/* Scaffold cue */}
        {scaffoldCue && (() => {
          const FRAME_GUIDE_URLS = {
            'FRAME_01': 'https://storage.googleapis.com/b10-practice-platform.firebasestorage.app/resources/speaking-guides/B10_FP_W1_Scale_and_Stakeholder.pdf',
            'FRAME_02': 'https://storage.googleapis.com/b10-practice-platform.firebasestorage.app/resources/speaking-guides/B10_FP_W2_Trade-offs_and_Constraints.pdf',
            'FRAME_03': 'https://storage.googleapis.com/b10-practice-platform.firebasestorage.app/resources/speaking-guides/B10_FP_W3_Causal_Systems.pdf',
            'FRAME_04': 'https://storage.googleapis.com/b10-practice-platform.firebasestorage.app/resources/speaking-guides/B10_FP_W4_Hypothetical_and_Conditional.pdf',
            'FRAME_05': 'https://storage.googleapis.com/b10-practice-platform.firebasestorage.app/resources/speaking-guides/B10_FP_W5_Values_Heuristics_and_Bias.pdf',
            'FRAME_06': 'https://storage.googleapis.com/b10-practice-platform.firebasestorage.app/resources/speaking-guides/B10_FP_W6_Synthesis_and_Judgment.pdf',
          }
          const GRAMMAR_GUIDE_URLS = {
            'argument_structure': 'https://storage.googleapis.com/b10-practice-platform.firebasestorage.app/resources/speaking-guides/b10pp-argument-structure.pdf',
            'STRUCT_01': 'https://storage.googleapis.com/b10-practice-platform.firebasestorage.app/resources/speaking-guides/b10pp-grammar-conditional-structures.pdf',
            'STRUCT_02': 'https://storage.googleapis.com/b10-practice-platform.firebasestorage.app/resources/speaking-guides/b10pp-grammar-concession-contrast.pdf',
            'STRUCT_03': 'https://storage.googleapis.com/b10-practice-platform.firebasestorage.app/resources/speaking-guides/b10pp-grammar-relative-clauses.pdf',
            'STRUCT_04': 'https://storage.googleapis.com/b10-practice-platform.firebasestorage.app/resources/speaking-guides/b10pp-grammar-modality-hedging.pdf',
            'STRUCT_05': 'https://storage.googleapis.com/b10-practice-platform.firebasestorage.app/resources/speaking-guides/b10pp-grammar-nominalization.pdf',
            'STRUCT_06': 'https://storage.googleapis.com/b10-practice-platform.firebasestorage.app/resources/speaking-guides/b10pp-grammar-passive-reporting.pdf',
            'STRUCT_07': 'https://storage.googleapis.com/b10-practice-platform.firebasestorage.app/resources/speaking-guides/b10pp-grammar-parallelism.pdf',
          }
          let frameGuideUrl = null
          let grammarGuideUrl = null
          try {
            const raw = sessionStorage.getItem('b10pp_scaffold')
            if (raw) {
              const sc = JSON.parse(raw)
              // Frame guide — resolve from primaryFrame or suggestedPrimaryFrame independently
              const frameKey = sc?.primaryFrame || sc?.suggestedPrimaryFrame || null
              frameGuideUrl = frameKey ? (FRAME_GUIDE_URLS[frameKey] || null) : null
              // Grammar guide — resolve from focusArea or primaryStructure independently
              if (sc?.focusArea === 'argument_structure') grammarGuideUrl = GRAMMAR_GUIDE_URLS['argument_structure'] || null
              else if (sc?.primaryStructure) grammarGuideUrl = GRAMMAR_GUIDE_URLS[sc.primaryStructure] || null
            }
          } catch(e) {}
          // For ESO-AES Frames passages with no session scaffold
          if (!frameGuideUrl && passage?.passage_id?.startsWith('ESO-AES-') && passage?.suggestedPrimaryFrame) {
            frameGuideUrl = FRAME_GUIDE_URLS[passage.suggestedPrimaryFrame] || null
          }
          return (
            <div className="w-full rounded-xl p-4 border" style={{ backgroundColor: '#fffbeb', borderColor: '#c8a84b' }}>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#92640a' }}>Speaking Focus</p>
                <div className="flex items-center gap-3">
                  {frameGuideUrl && (
                    <a href={frameGuideUrl} target="_blank" rel="noopener noreferrer"
                      className="text-xs font-semibold underline" style={{ color: '#0d9488' }}>
                      Frame Guide ↗
                    </a>
                  )}
                  {grammarGuideUrl && (
                    <a href={grammarGuideUrl} target="_blank" rel="noopener noreferrer"
                      className="text-xs font-semibold underline" style={{ color: '#4338ca' }}>
                      Grammar Guide ↗
                    </a>
                  )}
                </div>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: '#78350f' }}>{scaffoldCue}</p>
            </div>
          )
        })()}

        {isEvaluating ? (
          /* Uploading / evaluating state */
          <div className="flex flex-col items-center gap-4 py-10">
            <div className="w-12 h-12 rounded-full border-4 border-blue-200 border-t-blue-700 animate-spin" />
            <p className="text-gray-600 font-medium text-center">{statusMessage}</p>
          </div>
        ) : (
          <>
            {!isRecording && passage.task_type !== 'eso' && !['narration','description','instructions'].includes(passage.task_type) && (
              <div className="w-full">
                <AudioPlayer audioSrc={audioUrl} />
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
