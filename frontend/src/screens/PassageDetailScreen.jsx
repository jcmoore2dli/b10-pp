import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import AudioPlayer from '../components/AudioPlayer'
import { db } from '../services/firebase'
import { doc, getDoc } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import { storage } from '../services/firebase'

/**
 * Screen 3 — Passage Detail
 * Spec §3.4, §6.5
 *
 * - Fetches passage from Firestore by document ID
 * - Displays passage metadata (ID, domain, layer, tier)
 * - Audio player: Play / Pause / Replay — no seek bar, no autoplay
 * - "Begin Task" button activates after student has engaged with audio
 * - Passage text NOT shown at any point during this screen
 */
export default function PassageDetailScreen() {
  const { passageId } = useParams()
  const navigate = useNavigate()
  const [passage, setPassage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [audioUrl, setAudioUrl] = useState(null)
  const [hasEngaged, setHasEngaged] = useState(false)

  useEffect(() => {
    async function loadPassage() {
      setLoading(true)
      try {
        const docSnap = await getDoc(doc(db, 'passages', passageId))
        if (docSnap.exists()) {
          const d = docSnap.data()
          // Normalize Firestore fields to UI shape
          const normalized = {
            passage_id:     d.passageId || passageId,
            domain:         d.domain || passageId,
            layer:          d.corpusType === 'COR' ? 'CORE' : d.corpusType === 'EXT' ? 'EXT' : d.corpusType === 'ESO' ? 'ESO' : 'ORIENT',
            tier:           d.tier != null ? `Tier ${d.tier}` : null,
            domain_cluster: d.domain || '',
            question:       d.question || null,
            task_type:      (d.taskType || 'PARAPHRASE').toLowerCase(),
            ext_band:       d.ext_band || null,
            pil:            d.pil || null,
            audioPath:      d.audioPath || null,
            passageText:    d.passageText || '',
            esoQuestionId:  d.esoQuestionId || null,
            set:            d.set || null,
          }
          setPassage(normalized)
          // Fetch audio URL from Firebase Storage
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
        setLoading(false)
      }
    }
    loadPassage()
  }, [passageId])

  if (loading) {
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
          <button
            onClick={() => navigate('/b10_practice_platform/passages')}
            className="text-blue-700 underline text-sm"
          >
            Return to passage menu
          </button>
        </div>
      </div>
    )
  }

  function handleBeginTask() {
    navigate(`/b10_practice_platform/record/${passage.passage_id}`)
  }

  const isEso = passage.task_type === 'eso'

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header
        className="px-4 py-4 flex items-center gap-3"
        style={{ backgroundColor: '#1e3a5f' }}
      >
        <button
          onClick={() => navigate('/b10_practice_platform/passages')}
          className="text-blue-200 hover:text-white p-1 -ml-1 rounded"
          aria-label="Return to passage menu"
        >
          <BackIcon />
        </button>
        <div>
          <p className="text-white font-bold text-base leading-tight">Passage Detail</p>
          <p className="text-blue-200 text-xs">Task: {isEso ? 'Extended Supported Opinion' : passage.layer === 'EXT' ? 'Extended Listening' : 'Oral Paraphrase'}</p>
        </div>
      </header>

      <main className="px-4 py-6 max-w-lg mx-auto flex flex-col gap-6">
        {/* Passage metadata card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <p className="text-xs font-mono text-gray-400 mb-1">{passage.passage_id}</p>
          <h2 className="text-xl font-bold text-gray-900 mb-3">{passage.layer === 'ESO' && passage.question ? passage.question : passage.domain}</h2>
          <div className="flex flex-wrap gap-2">
            <MetaBadge label="Layer" value={passage.layer} />
            {passage.layer === 'CORE' && passage.tier && (
              <MetaBadge label="Tier" value={passage.tier} />
            )}
            {passage.layer === 'EXT' && passage.ext_band && (
              <>
                <MetaBadge label="Band" value={passage.ext_band} />
                {passage.pil && <MetaBadge label="PIL" value={passage.pil} />}
              </>
            )}
            <MetaBadge label="Cluster" value={passage.domain_cluster} />
          </div>
        </div>

        {/* Instructions */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
          {isEso ? (
            <p className="text-sm text-blue-800 leading-relaxed font-semibold">
              {passage.prompt_description}
            </p>
          ) : (
            <>
              <p className="text-sm text-blue-800 leading-relaxed">
                Listen to the passage. You may replay it as many times as you need before beginning.
                When you are ready, press <strong>Begin Task</strong> to record your paraphrase.
              </p>
              <p className="text-xs text-blue-600 mt-2">
                The passage text will not be shown until after you submit your response.
              </p>
            </>
          )}
        </div>

        {/* Audio Player */}
        {!isEso && (
          <AudioPlayer
            audioSrc={audioUrl}
            onPlayStart={() => setHasEngaged(true)}
          />
        )}

        {/* Begin Task button */}
        <button
          onClick={handleBeginTask}
          disabled={!isEso && !hasEngaged}
          className="w-full py-4 rounded-xl text-white font-bold text-lg disabled:opacity-40 transition-opacity"
          style={{ backgroundColor: (isEso || hasEngaged) ? '#1e3a5f' : '#9ca3af' }}
        >
          Begin Task
        </button>

        {!hasEngaged && !isEso && (
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
