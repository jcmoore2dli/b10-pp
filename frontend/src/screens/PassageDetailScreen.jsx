import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import AudioPlayer from '../components/AudioPlayer'
import { getPassageById } from '../data/passages'

/**
 * Screen 3 — Passage Detail
 * Spec §3.4, §6.5
 *
 * - Displays passage metadata (ID, domain, layer, tier)
 * - Audio player: Play / Pause / Replay — no seek bar, no autoplay
 * - "Begin Task" button activates after student has engaged with audio
 * - Passage text NOT shown at any point during this screen
 */
export default function PassageDetailScreen() {
  const { passageId } = useParams()
  const navigate = useNavigate()
  const passage = getPassageById(passageId)

  // "Begin Task" unlocks after the student presses Play at least once
  const [hasEngaged, setHasEngaged] = useState(false)

  if (!passage) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-red-600 font-semibold mb-2">Passage not found.</p>
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

  function handleBeginTask() {
    navigate(`/record/${passage.passage_id}`)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header
        className="px-4 py-4 flex items-center gap-3"
        style={{ backgroundColor: '#1e3a5f' }}
      >
        <button
          onClick={() => navigate('/passages')}
          className="text-blue-200 hover:text-white p-1 -ml-1 rounded"
          aria-label="Return to passage menu"
        >
          <BackIcon />
        </button>
        <div>
          <p className="text-white font-bold text-base leading-tight">Passage Detail</p>
          <p className="text-blue-200 text-xs">Task: Oral Paraphrase</p>
        </div>
      </header>

      <main className="px-4 py-6 max-w-lg mx-auto flex flex-col gap-6">
        {/* Passage metadata card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <p className="text-xs font-mono text-gray-400 mb-1">{passage.passage_id}</p>
          <h2 className="text-xl font-bold text-gray-900 mb-3">{passage.domain}</h2>

          <div className="flex flex-wrap gap-2">
            <MetaBadge label="Layer" value={passage.layer} />
            {passage.layer === 'CORE' && passage.tier && (
              <MetaBadge label="Tier" value={passage.tier} />
            )}
            {passage.layer === 'EXT' && passage.ext_band && (
              <>
                <MetaBadge label="Band" value={passage.ext_band} />
                {passage.pil_level && <MetaBadge label="PIL" value={passage.pil_level} />}
              </>
            )}
            <MetaBadge label="Cluster" value={passage.domain_cluster} />
          </div>
        </div>

        {/* Instructions */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
          <p className="text-sm text-blue-800 leading-relaxed">
            Listen to the passage. You may replay it as many times as you need before beginning.
            When you are ready, press <strong>Begin Task</strong> to record your paraphrase.
          </p>
          <p className="text-xs text-blue-600 mt-2">
            The passage text will not be shown until after you submit your response.
          </p>
        </div>

        {/* Audio Player */}
        <AudioPlayer
          audioSrc={passage.audio_path}
          onPlayStart={() => setHasEngaged(true)}
        />

        {/* Begin Task button */}
        <button
          onClick={handleBeginTask}
          disabled={!hasEngaged}
          className="w-full py-4 rounded-xl text-white font-bold text-lg disabled:opacity-40 transition-opacity"
          style={{ backgroundColor: hasEngaged ? '#1e3a5f' : '#9ca3af' }}
        >
          Begin Task
        </button>

        {!hasEngaged && (
          <p className="text-center text-xs text-gray-400 -mt-4">
            Play the audio above to enable this button
          </p>
        )}
      </main>
    </div>
  )
}

function MetaBadge({ label, value }) {
  return (
    <div className="flex items-center gap-1 bg-gray-100 rounded-lg px-3 py-1">
      <span className="text-xs text-gray-400 font-medium">{label}:</span>
      <span className="text-xs text-gray-700 font-semibold">{value}</span>
    </div>
  )
}

function BackIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
        clipRule="evenodd"
      />
    </svg>
  )
}
