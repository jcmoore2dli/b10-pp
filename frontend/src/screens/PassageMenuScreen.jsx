import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth, db } from '../services/firebase'
import { useAuth } from '../context/useAuth'
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore'
import { ref, getDownloadURL } from 'firebase/storage'
import { storage } from '../services/firebase'
import { useRef } from 'react'

// Normalize Firestore passage doc to UI shape
function normalizePassage(doc) {
  const d = doc.data ? doc.data() : doc
  const id = d.passageId || doc.id
  return {
    passage_id:     id,
    domain:         d.domain || id,
    layer:          d.corpusType === 'COR' ? 'CORE' : d.corpusType === 'EXT' ? 'EXT' : d.corpusType === 'ESO' ? 'ESO' : d.corpusType === 'NAR' ? 'NAR' : d.corpusType === 'DES' ? 'DES' : d.corpusType === 'INS' ? 'INS' : 'ORIENT',
    tier:           d.tier != null ? `Tier ${d.tier}` : null,
    domain_cluster: d.corpusType === 'NAR' ? (d.category || d.domain || '') : d.domain || '',
    question:       d.question || null,
    set:            d.set || null,
    taskType:       d.taskType || 'PARAPHRASE',
    passageText:    d.passageText || '',
    audioPath:      d.audioPath || null,
    esoQuestionId:  d.esoQuestionId || null,
    ext_band:       d.ext_band || null,
    pil_level:      d.pil || null,
  }
}

/**
 * Screen 2 — Passage Menu
 * Spec §3.3, §5
 *
 * Two views:
 *   - Assigned Set (top / primary): passages tied to access code
 *   - Browse Library (secondary): full corpus
 *
 * Phase 1: No real access code routing — Assigned Set is a hardcoded
 * placeholder set of 3 passages. Browse library shows all passages.
 * Completion status is not tracked yet (Phase 2).
 */

const DOMAIN_CLUSTER_LABELS = {
  'EDU': 'Education',
  'WRK': 'Labor & Work',
  'ECN': 'Economics',
  'GOV': 'Governance',
  'HLT': 'Health & Medicine',
  'TEC': 'Technology',
  'ENV': 'Environment',
  'JUS': 'Justice & Rights',
  'INT': 'International',
  'CUL': 'Culture',
  'SOC': 'Social Systems',
  'SCI': 'Science',
  'BIO': 'Biology',
  'PHY': 'Physics',
}

const LAYER_ORDER = ['ORIENT', 'CORE', 'EXT', 'ESO', 'NAR', 'DES', 'INS']



export default function PassageMenuScreen() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState(() => sessionStorage.getItem('b10pp_active_tab') || 'assigned')
  const [clusterFilter, setClusterFilter] = useState('ALL')
  const [layerFilter, setLayerFilter] = useState('ALL')

  const { claims } = useAuth()
  const b10Id = claims?.b10Id || '—'
  const accessCode = sessionStorage.getItem('b10pp_access_code') || '—'
  const [assignedPassages, setAssignedPassages] = useState([])
  const [allPassages, setAllPassages] = useState([])
  const [passagesLoading, setPassagesLoading] = useState(true)
  const [mySubmissions, setMySubmissions] = useState([])
  const [submissionsLoading, setSubmissionsLoading] = useState(true)

  useEffect(() => {
    async function loadAssigned() {
      if (!b10Id || b10Id === '—') return
      try {
        const snap = await getDocs(
          query(collection(db, 'assignments'), where('studentId', '==', b10Id))
        )
        const passageIds = snap.docs.flatMap(d => d.data().passageIds || [])
        const unique = [...new Set(passageIds)]
        // Fetch passage docs from Firestore by document ID
        const { doc, getDoc } = await import('firebase/firestore')
        const assignedDocs = await Promise.all(
          unique.map(async (id) => {
            try {
              const docSnap = await getDoc(doc(db, 'passages', id))
              if (docSnap.exists()) return normalizePassage(docSnap)
              return null
            } catch { return null }
          })
        )
        setAssignedPassages(assignedDocs.filter(Boolean))
      } catch (err) {
        console.error('Failed to load assignments:', err)
      }
    }
    loadAssigned()
  }, [b10Id])

  useEffect(() => {
    async function loadAllPassages() {
      setPassagesLoading(true)
      try {
        const snap = await getDocs(
          collection(db, 'passages')
        )
        const normalized = snap.docs.map(doc => normalizePassage(doc))
        setAllPassages(normalized)
      } catch (err) {
        console.error('Failed to load passages:', err)
      } finally {
        setPassagesLoading(false)
      }
    }
    loadAllPassages()
  }, [])

  useEffect(() => {
    async function loadSubmissions() {
      if (!b10Id || b10Id === '—') return
      setSubmissionsLoading(true)
      try {
        const snap = await getDocs(
          query(collection(db, 'submissions'), where('b10Id', '==', b10Id), orderBy('createdAt', 'desc'))
        )
        const complete = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(s => s.status === 'complete')
        setMySubmissions(complete)
      } catch (err) {
        console.error('Failed to load submissions:', err)
      } finally {
        setSubmissionsLoading(false)
      }
    }
    loadSubmissions()
  }, [b10Id])

  async function handleSignOut() {
    sessionStorage.clear()
    await signOut(auth)
    window.location.href = '/b10_practice_platform/'
  }



  const browsePassages = allPassages.filter((p) => {
    if (clusterFilter !== 'ALL' && p.domain_cluster !== clusterFilter) return false
    if (layerFilter !== 'ALL' && p.layer !== layerFilter) return false
    return true
  })

  function handleSelectPassage(passage) {
    sessionStorage.setItem('b10pp_active_tab', activeTab)
    navigate(`/b10_practice_platform/passage/${passage.passage_id}`)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header
        className="px-4 py-4 flex items-center justify-between"
        style={{ backgroundColor: '#1e3a5f' }}
      >
        <div>
          <p className="text-white font-bold text-lg leading-tight">B10-PP</p>
          <p className="text-blue-200 text-xs">{b10Id} · {accessCode}</p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="text-xs font-semibold px-2 py-1 rounded"
            style={{ backgroundColor: '#c8a84b', color: '#1e3a5f' }}
          >
            PASSAGE MENU
          </div>
          {claims?.role === 'admin' && (
            <button
              onClick={() => navigate('/b10_practice_platform/admin')}
              className="text-xs text-blue-200 underline"
            >
              Admin
            </button>
         )}
          {(claims?.role === 'admin' || claims?.role === 'instructor') && (
            <button
              onClick={() => navigate('/b10_practice_platform/instructor')}
              className="text-xs text-blue-200 underline"
            >
              Dashboard
            </button>
          )}
            <button
              onClick={handleSignOut}
              className="text-xs text-blue-200 underline"
            >
              Sign out
            </button>
        </div>
      </header>

      {/* Tab switcher */}
      <div className="flex border-b border-gray-200 bg-white">
        <button
          onClick={() => setActiveTab('assigned')}
          className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'assigned'
              ? 'border-blue-700 text-blue-700'
              : 'border-transparent text-gray-500'
          }`}
        >
          Assigned Set
        </button>
        <button
          onClick={() => setActiveTab('browse')}
          className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'browse'
              ? 'border-blue-700 text-blue-700'
              : 'border-transparent text-gray-500'
          }`}
        >
          Browse Library
        </button>
        <button
          onClick={() => setActiveTab('progress')}
          className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'progress'
              ? 'border-blue-700 text-blue-700'
              : 'border-transparent text-gray-500'
          }`}
        >
          My Progress
        </button>
      </div>

      <main className="px-4 py-4 max-w-2xl mx-auto">
        {activeTab === 'assigned' && (
          <AssignedSetView passages={assignedPassages} onSelect={handleSelectPassage} />
        )}
        {activeTab === 'progress' && (
          <MyProgressView submissions={mySubmissions} loading={submissionsLoading} />
        )}
        {activeTab === 'browse' && (
          <BrowseLibraryView
            passages={browsePassages}
            clusterFilter={clusterFilter}
            layerFilter={layerFilter}
            onClusterFilter={setClusterFilter}
            onLayerFilter={setLayerFilter}
            onSelect={handleSelectPassage}
          />
        )}
      </main>
    </div>
  )
}

function AssignedSetView({ passages, onSelect }) {
  if (passages.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        No passages assigned. Browse the library for independent practice.
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-1">
        {passages.length} passage{passages.length !== 1 ? 's' : ''} assigned
      </p>
      {passages.map((p) => (
        <PassageCard key={p.passage_id} passage={p} onSelect={onSelect} status="not_started" />
      ))}
    </div>
  )
}

function BrowseLibraryView({ passages, clusterFilter, layerFilter, onClusterFilter, onLayerFilter, onSelect }) {
  return (
    <div>
      {/* Filters */}
      <div className="flex gap-2 flex-wrap mb-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">Domain</label>
          <select
            value={clusterFilter}
            onChange={(e) => onClusterFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="ALL">All domains</option>
            {Object.entries(DOMAIN_CLUSTER_LABELS).map(([code, label]) => (
              <option key={code} value={code}>{code} — {label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">Layer</label>
          <select
            value={layerFilter}
            onChange={(e) => onLayerFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="ALL">All layers</option>
            {LAYER_ORDER.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>
      </div>

      {passages.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No passages match these filters.</div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-1">
            {passages.length} passage{passages.length !== 1 ? 's' : ''}
          </p>
          {passages.map((p) => (
            <PassageCard key={p.passage_id} passage={p} onSelect={onSelect} status="not_started" />
          ))}
        </div>
      )}
    </div>
  )
}

function PassageCard({ passage, onSelect, status }) {
  const statusConfig = {
    not_started: { label: 'Not Started', color: 'text-gray-400', dot: 'bg-gray-300' },
    in_progress: { label: 'In Progress', color: 'text-yellow-600', dot: 'bg-yellow-400' },
    completed: { label: 'Completed', color: 'text-green-600', dot: 'bg-green-500' },
  }
  const s = statusConfig[status] || statusConfig.not_started

  return (
    <button
      onClick={() => onSelect(passage)}
      className="w-full text-left bg-white rounded-xl border border-gray-200 p-4 shadow-sm active:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-mono text-gray-400 mb-1">{passage.passage_id}</p>
          <p className="font-semibold text-gray-900 text-sm leading-snug">{(['ESO','NAR','DES','INS'].includes(passage.layer) && passage.question) ? passage.question : passage.domain}</p>
          <div className="flex flex-wrap gap-1 mt-2">
            <LayerBadge layer={passage.layer} />
            {passage.layer === 'CORE' && passage.tier && (
              <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                {passage.tier}
              </span>
            )}
            {passage.layer === 'EXT' && passage.ext_band && (
              <>
                <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                  {passage.ext_band}
                </span>
                {passage.pil_level && (
                  <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                    {passage.pil_level}
                  </span>
                )}
              </>
            )}
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
              {passage.domain_cluster}
            </span>
          </div>
        </div>
        <div className={`flex items-center gap-1 text-xs font-medium shrink-0 ${s.color}`}>
          <span className={`inline-block w-2 h-2 rounded-full ${s.dot}`} />
          {s.label}
        </div>
      </div>
    </button>
  )
}

const SCORE_COLORS = {
  4: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200' },
  3: { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-200' },
  2: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
  1: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200' },
}
function formatDate(ts) {
  if (!ts) return "—"
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  const now = new Date()
  const diff = Math.floor((now - d) / (1000 * 60 * 60 * 24))
  if (diff === 0) return "Today"
  if (diff === 1) return "Yesterday"
  if (diff < 7) return `${diff} days ago`
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}
function taskTypeLabel(taskType) {
  const labels = { paraphrase: "Paraphrase", eso: "ESO", extended_listening: "Ext. Listening", narration: "Narration", description: "Description", instructions: "Instructions" }
  return labels[taskType] || taskType
}
const studentAudioManager = { current: null, stop() { if (this.current) { this.current.pause(); this.current.currentTime = 0; this.current = null } } }
function StudentAudioPlayer({ audioPath, playingId, setPlayingId, attemptId }) {
  const [url, setUrl] = useState(null)
  const [loading, setLoading] = useState(false)
  const audioRef = useRef(null)
  const playing = playingId === attemptId
  useEffect(() => {
    if (!playing && audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0 }
  }, [playing])
  async function handlePlay() {
    if (playing) { setPlayingId(null); return }
    if (studentAudioManager.current && studentAudioManager.current !== audioRef.current) { studentAudioManager.current.pause(); studentAudioManager.current.currentTime = 0 }
    const audioEl = audioRef.current
    if (!audioEl) return
    try {
      setLoading(true)
      let downloadUrl = url
      if (!downloadUrl) { const storageRef = ref(storage, audioPath); downloadUrl = await getDownloadURL(storageRef); setUrl(downloadUrl) }
      audioEl.src = downloadUrl; audioEl.load(); setPlayingId(attemptId); studentAudioManager.current = audioEl
      audioEl.onended = () => setPlayingId(null)
      await audioEl.play()
    } catch (err) { setPlayingId(null) } finally { setLoading(false) }
  }
  return (
    <span>
      <audio ref={audioRef} playsInline preload="none" />
      <button onClick={handlePlay} disabled={loading} className="text-xs px-2 py-1 rounded-lg border font-semibold shrink-0" style={{ borderColor: playing ? "#c0392b" : "#1e3a5f", color: playing ? "#c0392b" : "#1e3a5f", backgroundColor: "white" }}>
        {loading ? "Loading" : playing ? "Stop" : "Play"}
      </button>
    </span>
  )
}
function MyProgressView({ submissions, loading }) {
  const [expandedId, setExpandedId] = useState(null)
  const [playingId, setPlayingId] = useState(null)
  if (loading) return <div className="flex justify-center py-12"><div className="w-8 h-8 rounded-full border-4 border-blue-200 border-t-blue-700 animate-spin" /></div>
  if (submissions.length === 0) return (
    <div className="text-center py-12 text-gray-400">
      <p className="font-semibold mb-1">No completed attempts yet.</p>
      <p className="text-sm">Complete a passage to see your progress here.</p>
    </div>
  )
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold">{submissions.length} completed attempt{submissions.length !== 1 ? "s" : ""}</p>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex flex-col">
          {submissions.map(attempt => {
            const colors = SCORE_COLORS[attempt.score] || SCORE_COLORS[1]
            const scoreMax = attempt.taskFamily === "LEVEL3" ? 4 : 3
            const isExpanded = expandedId === attempt.id
            return (
              <div key={attempt.id} className="flex flex-col border-b border-gray-100 last:border-0">
                <button onClick={() => setExpandedId(isExpanded ? null : attempt.id)} className="flex items-center justify-between py-3 gap-3 w-full text-left">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{taskTypeLabel(attempt.taskType)} · {attempt.passageId}<span className="ml-2 text-gray-300 text-xs">{isExpanded ? "▲" : "▼"}</span></p>
                    <p className="text-xs text-gray-400 mt-0.5">{formatDate(attempt.processedAt)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {attempt.audioPath && <span onClick={e => e.stopPropagation()}><StudentAudioPlayer audioPath={attempt.audioPath} attemptId={attempt.id} playingId={playingId} setPlayingId={setPlayingId} /></span>}
                    <div className={`flex flex-col items-center justify-center w-12 h-12 rounded-full border-2 shrink-0 ${colors.bg} ${colors.border}`}>
                      <p className={`text-sm font-black leading-none ${colors.text}`}>{attempt.score}/{scoreMax}</p>
                      <p className={`text-xs font-bold leading-none mt-0.5 ${colors.text}`}>{attempt.score_label?.slice(0, 4)}</p>
                    </div>
                  </div>
                </button>
                {isExpanded && (
                  <div className="pb-4 flex flex-col gap-4">
                    {attempt.transcriptText && <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Your Response</p><p className="text-sm text-gray-700 leading-relaxed">{attempt.transcriptText}</p></div>}
                    {attempt.strengths && <div className="bg-green-50 rounded-lg p-3"><p className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-1">Strengths</p><p className="text-sm text-gray-700 leading-relaxed">{attempt.strengths}</p></div>}
                    {attempt.gaps && <div className="bg-yellow-50 rounded-lg p-3"><p className="text-xs font-semibold text-yellow-600 uppercase tracking-wide mb-1">Areas to Improve</p><p className="text-sm text-gray-700 leading-relaxed">{attempt.gaps}</p></div>}
                    {attempt.language_feedback && <div className="bg-blue-50 rounded-lg p-3"><p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1">Language Feedback</p><p className="text-sm text-gray-700 leading-relaxed">{attempt.language_feedback}</p></div>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
function LayerBadge({ layer }) {
  const config = {
    ORIENT: 'bg-green-50 text-green-700',
    CORE: 'bg-blue-50 text-blue-700',
    EXT: 'bg-purple-50 text-purple-700',
    ESO: 'bg-yellow-50 text-yellow-700',
    NAR: 'bg-orange-50 text-orange-700',
    DES: 'bg-teal-50 text-teal-700',
    INS: 'bg-rose-50 text-rose-700',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${config[layer] || 'bg-gray-100 text-gray-600'}`}>
      {layer}
    </span>
  )
}
