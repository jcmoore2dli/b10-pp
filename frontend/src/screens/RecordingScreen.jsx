import { useNavigate, useParams } from 'react-router-dom'
import { getPassageById } from '../data/passages'

/**
 * Screen 4 — Recording Screen (Oral Paraphrase)
 * Spec §3.5
 *
 * Phase 1 STUB — scaffold only.
 * Recording, Whisper transcription, and Claude scoring are Phase 2.
 *
 * This screen exists to allow local navigation testing in Phase 1.
 */
export default function RecordingScreen() {
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header
        className="px-4 py-4 flex items-center gap-3"
        style={{ backgroundColor: '#1e3a5f' }}
      >
        <button
          onClick={() => navigate(`/passage/${passageId}`)}
          className="text-blue-200 hover:text-white p-1 -ml-1 rounded"
          aria-label="Back to passage detail"
        >
          <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
          </svg>
        </button>
        <div>
          <p className="text-white font-bold text-base">Recording</p>
          <p className="text-blue-200 text-xs">{passage.passage_id}</p>
        </div>
      </header>

      <main className="px-4 py-8 max-w-lg mx-auto flex flex-col items-center gap-8">
        {/* Task prompt */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 w-full text-center">
          <p className="text-blue-900 font-medium text-base leading-relaxed">
            Listen to the passage. When you are ready, record your paraphrase in English.
          </p>
        </div>

        {/* Phase 1 placeholder — recording UI not yet built */}
        <div className="bg-white border-2 border-dashed border-gray-200 rounded-2xl p-10 w-full flex flex-col items-center gap-4 text-center">
          <div className="w-20 h-20 rounded-full flex items-center justify-center bg-gray-100">
            <svg className="w-10 h-10 text-gray-300" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2a4 4 0 014 4v6a4 4 0 01-8 0V6a4 4 0 014-4z" />
              <path d="M6 10a1 1 0 012 0 4 4 0 008 0 1 1 0 112 0 6 6 0 01-5 5.917V18h2a1 1 0 010 2H9a1 1 0 010-2h2v-2.083A6 6 0 016 10z" />
            </svg>
          </div>
          <p className="text-gray-400 text-sm font-medium">Recording — Phase 2</p>
          <p className="text-gray-300 text-xs max-w-xs">
            Web Audio API recording, Whisper transcription, and Claude scoring will be built in Phase 2.
          </p>
        </div>

        {/* Phase 1 skip: simulate submission for navigation testing */}
        <button
          onClick={() => navigate(`/feedback/${passageId}`)}
          className="w-full py-4 rounded-xl font-bold text-white text-base"
          style={{ backgroundColor: '#1e3a5f' }}
        >
          Simulate Submit (Phase 1 Only)
        </button>
        <p className="text-xs text-gray-400 text-center">
          This button is a Phase 1 navigation stub and will be replaced in Phase 2.
        </p>
      </main>
    </div>
  )
}
