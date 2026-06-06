import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import {
  collection, query, where, getDocs, orderBy, addDoc, serverTimestamp, deleteDoc, doc
} from 'firebase/firestore'
import { db, auth, storage } from '../services/firebase'
import { ref, getDownloadURL } from 'firebase/storage'
import { useAuth } from '../context/useAuth'

const BUNDLE_MAP = [
  { set: 1, day: 1, leg: 'COR-ECN-002', cor: 'COR-EDU-001', eso: 'EDU-001', q: 'Should standardized testing be eliminated as the main tool for academic assessment?' },
  { set: 1, day: 2, leg: 'COR-ECN-010', cor: 'COR-EDU-006', eso: 'EDU-006', q: 'Should financial literacy be a required subject in school curricula?' },
  { set: 1, day: 3, leg: 'COR-SCI-002', cor: 'COR-EDU-015', eso: 'EDU-015', q: 'Should governments provide financial incentives to address teacher shortages?' },
  { set: 1, day: 4, leg: 'COR-SCI-010', cor: 'COR-WRK-003', eso: 'WRK-003', q: 'Should workers have the legal right to disconnect from work communications outside working hours?' },
  { set: 1, day: 5, leg: 'COR-SCI-013', cor: 'COR-WRK-007', eso: 'WRK-007', q: 'Should a four-day work week be adopted as national labor policy?' },
  { set: 2, day: 1, leg: 'COR-BIO-008', cor: 'COR-ENV-008', eso: 'ENV-008', q: 'Should single-use plastics be banned?' },
  { set: 2, day: 2, leg: 'COR-BIO-011', cor: 'COR-ENV-015', eso: 'ENV-015', q: 'Should nuclear energy be expanded as part of climate policy?' },
  { set: 2, day: 3, leg: 'COR-ENV-001', cor: 'COR-HLT-005', eso: 'HLT-005', q: 'Should sugary drinks be taxed to discourage unhealthy consumption?' },
  { set: 2, day: 4, leg: 'COR-HLT-002', cor: 'COR-HLT-012', eso: 'HLT-012', q: 'Should vaccinations be mandatory for all schoolchildren?' },
  { set: 2, day: 5, leg: 'COR-HLT-009', cor: 'COR-HLT-022', eso: 'HLT-022', q: 'Should healthcare be provided universally to all citizens?' },
  { set: 3, day: 1, leg: 'COR-ECN-003', cor: 'COR-GOV-003', eso: 'GOV-003', q: 'Should voting be mandatory for all citizens?' },
  { set: 3, day: 2, leg: 'COR-SOC-003', cor: 'COR-GOV-012', eso: 'GOV-012', q: 'Should there be term limits for legislators?' },
  { set: 3, day: 3, leg: 'COR-SOC-005', cor: 'COR-INT-004', eso: 'INT-004', q: 'Should countries accept more refugees?' },
  { set: 3, day: 4, leg: 'COR-SOC-007', cor: 'COR-JUS-003', eso: 'JUS-003', q: 'Should the death penalty be abolished?' },
  { set: 3, day: 5, leg: 'COR-SOC-008', cor: 'COR-JUS-008', eso: 'JUS-008', q: 'Should marijuana possession be decriminalized?' },
  { set: 4, day: 1, leg: 'COR-PHY-003', cor: 'COR-ECN-008', eso: 'ECN-008', q: 'Should workers in app-based or platform jobs be classified as employees?' },
  { set: 4, day: 2, leg: 'COR-PHY-006', cor: 'COR-TEC-003', eso: 'TEC-003', q: 'Should social media have age restrictions for minors?' },
  { set: 4, day: 3, leg: 'COR-TEC-006', cor: 'COR-TEC-012', eso: 'TEC-012', q: 'Should AI-generated content be labeled as such?' },
  { set: 4, day: 4, leg: 'COR-TEC-007', cor: 'COR-TEC-018', eso: 'TEC-018', q: 'Should autonomous vehicles be allowed on public roads?' },
  { set: 4, day: 5, leg: 'COR-TEC-009', cor: 'COR-TEC-025', eso: 'TEC-025', q: 'Should genetic engineering of humans be permitted?' },
  { set: 5, day: 1, leg: 'COR-BIO-001', cor: 'COR-CUL-005', eso: 'CUL-005', q: 'Should cultural appropriation be regulated?' },
  { set: 5, day: 2, leg: 'COR-ECN-006', cor: 'COR-EDU-003', eso: 'EDU-003', q: 'Should college education be free for all students?' },
  { set: 5, day: 3, leg: 'COR-ENV-006', cor: 'COR-GOV-008', eso: 'GOV-008', q: 'Should campaign contributions be limited by law?' },
  { set: 5, day: 4, leg: 'COR-SCI-004', cor: 'COR-HLT-008', eso: 'HLT-008', q: 'Should organ donation be opt-out by default?' },
  { set: 5, day: 5, leg: 'COR-SOC-001', cor: 'COR-TEC-008', eso: 'TEC-008', q: 'Should facial recognition technology be banned in public spaces?' },
  { set: 6, day: 1, leg: 'COR-BIO-007', cor: 'COR-ENV-003', eso: 'ENV-003', q: 'Should carbon taxes be implemented to address climate change?' },
  { set: 6, day: 2, leg: 'COR-HLT-004', cor: 'COR-HLT-018', eso: 'HLT-018', q: 'Should processed foods carry warning labels?' },
  { set: 6, day: 3, leg: 'COR-PHY-007', cor: 'COR-INT-006', eso: 'INT-006', q: 'Should refugee integration programs be expanded?' },
  { set: 6, day: 4, leg: 'COR-SCI-008', cor: 'COR-INT-008', eso: 'INT-008', q: 'Should international trade agreements prioritize labor standards?' },
  { set: 6, day: 5, leg: 'COR-TEC-011', cor: 'COR-WRK-012', eso: 'WRK-012', q: 'Should governments raise the minimum wage to ensure a living wage?' },
  { set: 7, day: 1, leg: 'COR-BIO-006', cor: 'COR-EDU-012', eso: 'EDU-012', q: 'Should schools teach critical media literacy as a required subject?' },
  { set: 7, day: 2, leg: 'COR-ECN-005', cor: 'COR-GOV-018', eso: 'GOV-018', q: 'Should lobbying be more strictly regulated?' },
  { set: 7, day: 3, leg: 'COR-ENV-013', cor: 'COR-HLT-025', eso: 'HLT-025', q: 'Should alternative medicine be regulated for safety?' },
  { set: 7, day: 4, leg: 'COR-HLT-006', cor: 'COR-SOC-010', eso: 'SOC-010', q: 'Should social media platforms be required to moderate harmful content?' },
  { set: 7, day: 5, leg: 'COR-SCI-006', cor: 'COR-TEC-022', eso: 'TEC-022', q: 'Should data brokers be regulated to protect consumer privacy?' },
  { set: 8, day: 1, leg: 'COR-ECN-009', cor: 'COR-EDU-005', eso: 'EDU-005', q: 'Should vocational education be expanded in secondary schools?' },
  { set: 8, day: 2, leg: 'COR-ECN-015', cor: 'COR-EDU-018', eso: 'EDU-018', q: 'Should teacher salaries be significantly increased?' },
  { set: 8, day: 3, leg: 'COR-SCI-003', cor: 'COR-EDU-022', eso: 'EDU-022', q: 'Should class sizes be reduced in public schools?' },
  { set: 8, day: 4, leg: 'COR-SCI-009', cor: 'COR-WRK-008', eso: 'WRK-008', q: 'Should parental leave be significantly extended?' },
  { set: 8, day: 5, leg: 'COR-SCI-014', cor: 'COR-WRK-015', eso: 'WRK-015', q: 'Should the retirement age be raised?' },
  { set: 9, day: 1, leg: 'COR-BIO-002', cor: 'COR-ENV-012', eso: 'ENV-012', q: 'Should deforestation be banned globally?' },
  { set: 9, day: 2, leg: 'COR-BIO-003', cor: 'COR-ENV-018', eso: 'ENV-018', q: 'Should water usage be rationed during shortages?' },
  { set: 9, day: 3, leg: 'COR-ENV-007', cor: 'COR-HLT-015', eso: 'HLT-015', q: 'Should pharmaceutical advertising to consumers be restricted?' },
  { set: 9, day: 4, leg: 'COR-HLT-003', cor: 'COR-HLT-028', eso: 'HLT-028', q: 'Should mental health services be significantly expanded?' },
  { set: 9, day: 5, leg: 'COR-HLT-010', cor: 'COR-HLT-032', eso: 'HLT-032', q: 'Should end-of-life care decision-making be expanded for patients?' },
  { set: 10, day: 1, leg: 'COR-ECN-001', cor: 'COR-GOV-015', eso: 'GOV-015', q: 'Should the practice of manipulating electoral district boundaries for political advantage be prohibited?' },
  { set: 10, day: 2, leg: 'COR-SOC-002', cor: 'COR-GOV-022', eso: 'GOV-022', q: 'Should employees who report government or corporate wrongdoing receive stronger legal protections?' },
  { set: 10, day: 3, leg: 'COR-SOC-006', cor: 'COR-INT-012', eso: 'INT-012', q: 'Should sanctions be used as a foreign policy tool?' },
  { set: 10, day: 4, leg: 'COR-SOC-009', cor: 'COR-JUS-005', eso: 'JUS-005', q: 'Should defendants be released before trial based on risk assessments?' },
  { set: 10, day: 5, leg: 'COR-SOC-012', cor: 'COR-JUS-015', eso: 'JUS-015', q: 'Should restorative justice programs replace traditional incarceration?' },
  { set: 11, day: 1, leg: 'COR-PHY-001', cor: 'COR-ECN-012', eso: 'ECN-012', q: 'Should governments do more to protect consumers from high-interest lending?' },
  { set: 11, day: 2, leg: 'COR-PHY-012', cor: 'COR-ECN-018', eso: 'ECN-018', q: 'Should subscription pricing models be regulated to protect consumers?' },
  { set: 11, day: 3, leg: 'COR-TEC-002', cor: 'COR-TEC-015', eso: 'TEC-015', q: 'Should technology companies be required to give law enforcement access to encrypted data?' },
  { set: 11, day: 4, leg: 'COR-TEC-010', cor: 'COR-TEC-028', eso: 'TEC-028', q: 'Should space resources be privately owned?' },
  { set: 11, day: 5, leg: 'COR-TEC-014', cor: 'COR-TEC-032', eso: 'TEC-032', q: 'Should brain-computer interfaces be regulated?' },
  { set: 12, day: 1, leg: 'COR-BIO-013', cor: 'COR-CUL-012', eso: 'CUL-012', q: 'Should cultural heritage sites be protected from development?' },
  { set: 12, day: 2, leg: 'COR-ECN-004', cor: 'COR-EDU-025', eso: 'EDU-025', q: 'Should arts education be mandatory in all schools?' },
  { set: 12, day: 3, leg: 'COR-ENV-002', cor: 'COR-GOV-025', eso: 'GOV-025', q: 'Should political advertising be regulated?' },
  { set: 12, day: 4, leg: 'COR-PHY-015', cor: 'COR-HLT-020', eso: 'HLT-020', q: 'Should prescription drug prices be regulated by government?' },
  { set: 12, day: 5, leg: 'COR-SCI-007', cor: 'COR-TEC-035', eso: 'TEC-035', q: 'Should algorithmic hiring be regulated to prevent bias?' },
]

const SCORE_COLORS = {
  4: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200' },
  3: { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-200' },
  2: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
  1: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200' },
}

function formatDate(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  const now = new Date()
  const diff = Math.floor((now - d) / (1000 * 60 * 60 * 24))
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return `${diff} days ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function taskTypeLabel(taskType) {
  const labels = {
    paraphrase: 'Paraphrase',
    eso: 'ESO',
    extended_listening: 'Ext. Listening',
    narration: 'Narration',
    description: 'Description',
    instructions: 'Instructions',
  }
  return labels[taskType] || taskType
}


// Singleton audio manager — only one recording plays at a time
const audioManager = {
  current: null,
  stop() {
    if (this.current) {
      this.current.pause()
      this.current.currentTime = 0
      this.current = null
    }
  }
}

function AudioPlayer({ audioPath, playingId, setPlayingId, attemptId }) {
  const [url, setUrl] = useState(null)
  const [loading, setLoading] = useState(false)
  const [audioError, setAudioError] = useState(null)
  const audioRef = useRef(null)
  const playing = playingId === attemptId

  useEffect(() => {
    if (!playing && audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
  }, [playing])

  async function handlePlay() {
    if (playing) {
      setPlayingId(null)
      return
    }
    if (audioManager.current && audioManager.current !== audioRef.current) {
      audioManager.current.pause()
      audioManager.current.currentTime = 0
    }
    const audioEl = audioRef.current
    if (!audioEl) return

    // iOS requires src + load + play all within the same gesture handler
    try {
      setLoading(true)
      setAudioError(null)
      let downloadUrl = url
      if (!downloadUrl) {
        const storageRef = ref(storage, audioPath)
        downloadUrl = await getDownloadURL(storageRef)
        setUrl(downloadUrl)
      }
      audioEl.src = downloadUrl
      audioEl.load()
      setPlayingId(attemptId)
      audioManager.current = audioEl
      audioEl.onended = () => setPlayingId(null)
      await audioEl.play()
    } catch (err) {
      console.error('Audio play failed:', err)
      setAudioError(err.message || err.name || 'Playback error')
      setPlayingId(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <span>
      <audio ref={audioRef} playsInline preload="none" />
      {audioError && <p style={{color:'red',fontSize:'10px'}}>{audioError}</p>}
      <button
        onClick={handlePlay}
        disabled={loading}
        className="text-xs px-2 py-1 rounded-lg border font-semibold shrink-0"
        style={{
          borderColor: playing ? '#c0392b' : '#1e3a5f',
          color: playing ? '#c0392b' : '#1e3a5f',
          backgroundColor: 'white',
        }}
      >
        {loading ? 'Loading' : playing ? 'Stop' : 'Play'}
      </button>
    </span>
  )
}


function AttemptHistory({ b10Id, attempts, onBack, currentUser }) {
  const [playingId, setPlayingId] = useState(null)
  const [expandedAttemptId, setExpandedAttemptId] = useState(null)
  const [showScoringNotes, setShowScoringNotes] = useState({})
  const [showAssign, setShowAssign] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [assignError, setAssignError] = useState(null)
  const [assignSuccess, setAssignSuccess] = useState(null)
  const [selectedPassageId, setSelectedPassageId] = useState('')
  const [layerFilter, setLayerFilter] = useState('ALL')
  const [selectedBundle, setSelectedBundle] = useState('')
  const [framesWeekFilter, setFramesWeekFilter] = useState(null)
  const [scaffoldOpen, setScaffoldOpen] = useState(false)
  const [focusArea, setFocusArea] = useState('Holistic')
  const [primaryFrame, setPrimaryFrame] = useState('')
  const [secondaryFrame, setSecondaryFrame] = useState('')
  const [primaryStructure, setPrimaryStructure] = useState('')

  const totalAttempts = attempts.length
  const lastAttempt = attempts[0]
  const lastPractice = lastAttempt ? formatDate(lastAttempt.processedAt) : '—'

  const [assignablePassages, setAssignablePassages] = useState([])
  const [loadingPassages, setLoadingPassages] = useState(false)

  // Assignment history state
  const [assignmentHistory, setAssignmentHistory] = useState([])
  const [loadingAssignments, setLoadingAssignments] = useState(true)
  const [assignmentError, setAssignmentError] = useState(null)
  const [assignmentRefresh, setAssignmentRefresh] = useState(0)

  useEffect(() => {
    setLoadingAssignments(true)
    setAssignmentError(null)
    getDocs(
      query(collection(db, 'assignments'), where('studentId', '==', b10Id), orderBy('assignedAt', 'desc'))
    )
      .then(snap => {
        setAssignmentHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      })
      .catch(err => {
        setAssignmentError(err.message)
      })
      .finally(() => setLoadingAssignments(false))
  }, [b10Id, assignmentRefresh])

  const [selectedAssignmentIds, setSelectedAssignmentIds] = useState(new Set())

  function toggleAssignmentSelect(assignmentId) {
    setSelectedAssignmentIds(prev => {
      const next = new Set(prev)
      if (next.has(assignmentId)) next.delete(assignmentId)
      else next.add(assignmentId)
      return next
    })
  }

  async function handleDeleteAssignment(assignmentId) {
    if (!window.confirm('Remove this assignment?')) return
    try {
      await deleteDoc(doc(db, 'assignments', assignmentId))
      setAssignmentHistory(prev => prev.filter(a => a.id !== assignmentId))
      setSelectedAssignmentIds(prev => { const next = new Set(prev); next.delete(assignmentId); return next })
    } catch (err) {
      console.error('Failed to delete assignment:', err)
    }
  }

  async function handleDeleteSelected() {
    if (selectedAssignmentIds.size === 0) return
    if (!window.confirm(`Remove ${selectedAssignmentIds.size} selected assignment(s)?`)) return
    try {
      await Promise.all([...selectedAssignmentIds].map(id => deleteDoc(doc(db, 'assignments', id))))
      setAssignmentHistory(prev => prev.filter(a => !selectedAssignmentIds.has(a.id)))
      setSelectedAssignmentIds(new Set())
    } catch (err) {
      console.error('Failed to delete selected assignments:', err)
    }
  }

  useEffect(() => {
    if (!showAssign || assignablePassages.length > 0) return
    setLoadingPassages(true)
    getDocs(collection(db, 'passages'))
      .then(snap => {
        const list = snap.docs
          .map(d => d.data())
          .filter(p => p.status === 'active')
          .sort((a, b) => a.passageId.localeCompare(b.passageId))
        setAssignablePassages(list)
      })
      .catch(err => setAssignError('Failed to load passages: ' + err.message))
      .finally(() => setLoadingPassages(false))
  }, [showAssign])

  async function handleAssign() {
    setAssigning(true)
    setAssignError(null)
    setAssignSuccess(null)
    try {
      if (layerFilter === 'BUNDLE') {
        if (!selectedBundle) { setAssignError('Please select a bundle.'); setAssigning(false); return }
        const bundle = BUNDLE_MAP.find(b => `S${b.set}.${b.day}` === selectedBundle)
        if (!bundle) { setAssignError('Bundle not found.'); setAssigning(false); return }
        // Assign all 3 items
        await Promise.all([
          addDoc(collection(db, 'assignments'), {
            studentId: b10Id, assignmentType: 'main', assignedBy: currentUser.uid,
            passageIds: [bundle.leg], scaffoldConfig: null, assignedAt: serverTimestamp(),
            bundleId: selectedBundle,
          }),
          addDoc(collection(db, 'assignments'), {
            studentId: b10Id, assignmentType: 'main', assignedBy: currentUser.uid,
            passageIds: [bundle.cor], scaffoldConfig: null, assignedAt: serverTimestamp(),
            bundleId: selectedBundle,
          }),
          addDoc(collection(db, 'assignments'), {
            studentId: b10Id, assignmentType: 'main', assignedBy: currentUser.uid,
            passageIds: [bundle.eso], scaffoldConfig: null, assignedAt: serverTimestamp(),
            bundleId: selectedBundle,
          }),
        ])
        setAssignSuccess(`Assigned bundle ${selectedBundle} (3 passages) to ${b10Id}`)
        setSelectedBundle('')
        setShowAssign(false)
        setAssignmentRefresh(r => r + 1)
      } else {
        if (!selectedPassageId) { setAssignError('Please select a passage.'); setAssigning(false); return }
        const FOCUS_MAP = {
          'Holistic': 'holistic', 'Argument structure': 'argument_structure',
          'Discourse frame': 'discourse_frame', 'Grammar structure': 'grammar_structure',
          'Combined': 'combined'
        }
        const FRAME_MAP = {
          'Scale & Stakeholder': 'FRAME_01', 'Trade-offs & Constraints': 'FRAME_02',
          'Causal Systems': 'FRAME_03', 'Hypothetical & Conditional': 'FRAME_04',
          'Value-based Evaluation': 'FRAME_05', 'Synthesis & Judgment': 'FRAME_06'
        }
        const STRUCT_MAP = {
          'Conditional Structures': 'STRUCT_01', 'Concession & Contrast': 'STRUCT_02',
          'Relative Clauses': 'STRUCT_03', 'Modality & Hedging': 'STRUCT_04',
          'Nominalization': 'STRUCT_05', 'Passive & Reporting': 'STRUCT_06',
          'Parallelism': 'STRUCT_07'
        }
        const scaffoldConfig = layerFilter === 'ESO' && focusArea !== 'Holistic'
          ? {
              focusArea: FOCUS_MAP[focusArea] || 'holistic',
              primaryFrame: FRAME_MAP[primaryFrame] || null,
              secondaryFrame: FRAME_MAP[secondaryFrame] || null,
              primaryStructure: STRUCT_MAP[primaryStructure] || null,
              secondaryStructure: null,
              studentCueText: '',
            }
          : null
        await addDoc(collection(db, 'assignments'), {
          studentId:      b10Id,
          assignmentType: 'main',
          assignedBy:     currentUser.uid,
          passageIds:     [selectedPassageId],
          scaffoldConfig,
          assignedAt:     serverTimestamp(),
        })
        setAssignSuccess(`Assigned ${selectedPassageId} to ${b10Id}`)
        setSelectedPassageId('')
        setShowAssign(false)
        setAssignmentRefresh(r => r + 1)
        setScaffoldOpen(false)
        setFocusArea('Holistic')
        setPrimaryFrame('')
        setSecondaryFrame('')
        setPrimaryStructure('')
      }
    } catch (err) {
      setAssignError('Assignment failed: ' + err.message)
    } finally {
      setAssigning(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-blue-700 font-semibold self-start">
        ← Back
      </button>
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-xs text-blue-400 font-semibold uppercase tracking-wide mb-0.5">Student B10 ID</p>
          <p className="text-lg font-black text-gray-900 font-mono">{b10Id}</p>
        </div>
        <p className="text-xs font-bold text-green-600">Active</p>
      </div>
      <div className="flex border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
        <div className="flex-1 px-4 py-3 border-r border-gray-200 text-center">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-1">Attempts</p>
          <p className="text-xl font-black text-gray-900">{totalAttempts}</p>
        </div>
        <div className="flex-1 px-4 py-3 border-r border-gray-200 text-center">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-1">Last Practice</p>
          <p className="text-sm font-bold text-gray-900">{lastPractice}</p>
        </div>
        <div className="flex-1 px-4 py-3 text-center">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-1">Last Score</p>
          <p className="text-xl font-black text-gray-900">
            {lastAttempt ? `${lastAttempt.score}/${lastAttempt.taskFamily === 'LEVEL3' ? 4 : 3}` : '—'}
          </p>
        </div>
      </div>

      {/* Assign passage */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Assign Passage</p>
          <button
            onClick={() => { setShowAssign(!showAssign); setAssignError(null); setAssignSuccess(null) }}
            className="text-xs font-semibold text-blue-700 underline"
          >
            {showAssign ? 'Cancel' : '+ Assign'}
          </button>
        </div>
        {assignSuccess && <p className="text-green-600 text-sm mb-2">{assignSuccess}</p>}
        {showAssign && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1 mb-1">
              {['ALL','ORIENT','CORE','EXT','ESO','NAR','DES','INS','BUNDLE'].map(layer => (
                <button
                  key={layer}
                  onClick={() => { setLayerFilter(layer); setSelectedPassageId(''); setFramesWeekFilter(null) }}
                  className="text-xs px-2 py-1 rounded-full font-semibold border transition-colors"
                  style={{
                    backgroundColor: layerFilter === layer ? '#1e3a5f' : 'white',
                    color: layerFilter === layer ? 'white' : '#1e3a5f',
                    borderColor: '#1e3a5f',
                  }}
                  disabled={assigning}
                >
                  {layer}
                </button>
              ))}
              <button
                onClick={() => { setLayerFilter('FRAMES'); setSelectedPassageId(''); setFramesWeekFilter(null) }}
                className="text-xs px-2 py-1 rounded-full font-semibold border transition-colors"
                style={{
                  backgroundColor: layerFilter === 'FRAMES' ? '#0d9488' : 'white',
                  color: layerFilter === 'FRAMES' ? 'white' : '#0d9488',
                  borderColor: '#0d9488',
                }}
                disabled={assigning}
              >
                FRAMES
              </button>
              {layerFilter === 'FRAMES' && (
                <div className="flex flex-wrap gap-1 mt-1 w-full">
                  {[
                    { w: 'W1', label: 'Scale & Stakeholder' },
                    { w: 'W2', label: 'Trade-offs & Constraints' },
                    { w: 'W3', label: 'Causal Systems' },
                    { w: 'W4', label: 'Hypothetical & Conditional' },
                    { w: 'W5', label: 'Values, Heuristics & Bias' },
                    { w: 'W6', label: 'Synthesis & Judgment' },
                  ].map(({ w, label }) => (
                    <button
                      key={w}
                      onClick={() => { setFramesWeekFilter(framesWeekFilter === w ? null : w); setSelectedPassageId('') }}
                      className="text-xs px-2 py-1 rounded-full font-semibold border transition-colors"
                      style={{
                        backgroundColor: framesWeekFilter === w ? '#0d9488' : '#f0fdfa',
                        color: framesWeekFilter === w ? 'white' : '#0d9488',
                        borderColor: '#0d9488',
                      }}
                      disabled={assigning}
                      title={label}
                    >
                      {w} — {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {layerFilter === 'BUNDLE' ? (
              <select
                value={selectedBundle}
                onChange={e => setSelectedBundle(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={assigning}
              >
                <option value="">Select a bundle…</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(setNum => (
                  <optgroup key={setNum} label={`Set ${setNum}`}>
                    {BUNDLE_MAP.filter(b => b.set === setNum).map(b => (
                      <option key={`S${b.set}.${b.day}`} value={`S${b.set}.${b.day}`}>
                        S{b.set}.{b.day} — {b.q}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            ) : (
              <select
                value={selectedPassageId}
                onChange={e => setSelectedPassageId(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={assigning}
              >
                <option value="">Select a passage…</option>
                {loadingPassages
                  ? <option disabled>Loading passages…</option>
                  : assignablePassages
                      .filter(p => {
                        if (layerFilter === 'ALL') return true
                        if (layerFilter === 'FRAMES') {
                          if (!p.passageId?.startsWith('ESO-AES-')) return false
                          if (framesWeekFilter) {
                            const parts = p.passageId.split('-')
                            return parts[2] === framesWeekFilter
                          }
                          return true
                        }
                        const map = {
                          ORIENT: 'ORI', CORE: 'COR', EXT: 'EXT',
                          ESO: 'ESO', NAR: 'NAR', DES: 'DES', INS: 'INS'
                        }
                        const match = p.corpusType === map[layerFilter]
                        if (!match) return false
                        if (layerFilter === 'ESO' && p.passageId?.startsWith('ESO-AES-')) return false
                        return true
                      })
                      .map(p => (
                        <option key={p.passageId} value={p.passageId}>
                          {p.passageId} — {p.question ? p.question : p.domain || p.taskType}
                        </option>
                      ))
                }
              </select>
            )}
            {/* Scaffold config — ESO only */}
            {layerFilter === 'ESO' && selectedPassageId && (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setScaffoldOpen(!scaffoldOpen)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 text-left"
                  type="button"
                >
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Scaffold Focus (optional)</p>
                  <span className="text-gray-400 text-xs">{scaffoldOpen ? '▲' : '▼'}</span>
                </button>
                {scaffoldOpen && (
                  <div className="p-3 flex flex-col gap-3">
                    <div>
                      <p className="text-xs text-gray-400 font-semibold mb-2">What should Claude focus on?</p>
                      <div className="flex flex-wrap gap-1">
                        {['Holistic','Argument structure','Discourse frame','Grammar structure','Combined'].map(opt => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => {
                              setFocusArea(opt)
                              if (opt !== 'Discourse frame' && opt !== 'Combined') { setPrimaryFrame(''); setSecondaryFrame('') }
                              if (opt !== 'Grammar structure' && opt !== 'Combined') { setPrimaryStructure('') }
                            }}
                            className="text-xs px-2 py-1 rounded-full border font-semibold transition-colors"
                            style={{
                              backgroundColor: focusArea === opt ? '#1e3a5f' : 'white',
                              color: focusArea === opt ? 'white' : '#1e3a5f',
                              borderColor: '#1e3a5f',
                            }}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>

                    {focusArea === 'Argument structure' && (
                      <div className="bg-blue-50 rounded-lg px-3 py-2">
                        <p className="text-xs text-blue-700 font-semibold mb-1">PSU Arc</p>
                        <p className="text-xs text-blue-600">Claude will foreground the Point → Support → Universal analysis arc in feedback. No sub-selection needed.</p>
                      </div>
                    )}

                    {(focusArea === 'Discourse frame' || focusArea === 'Combined') && (
                      <>
                        <div>
                          <p className="text-xs text-gray-400 font-semibold mb-2">Primary discourse frame</p>
                          <div className="flex flex-wrap gap-1">
                            {['Scale & Stakeholder','Trade-offs & Constraints','Causal Systems','Hypothetical & Conditional','Value-based Evaluation','Synthesis & Judgment'].map(frame => (
                              <button
                                key={frame}
                                type="button"
                                onClick={() => setPrimaryFrame(primaryFrame === frame ? '' : frame)}
                                className="text-xs px-2 py-1 rounded-full border font-semibold transition-colors"
                                style={{
                                  backgroundColor: primaryFrame === frame ? '#c8a84b' : 'white',
                                  color: '#1e3a5f',
                                  borderColor: '#c8a84b',
                                }}
                              >
                                {frame}
                              </button>
                            ))}
                          </div>
                        </div>
                        {focusArea === 'Discourse frame' && (
                          <div>
                            <p className="text-xs text-gray-400 font-semibold mb-2">Secondary frame (optional)</p>
                            <div className="flex flex-wrap gap-1">
                              {['Scale & Stakeholder','Trade-offs & Constraints','Causal Systems','Hypothetical & Conditional','Value-based Evaluation','Synthesis & Judgment'].filter(f => f !== primaryFrame).map(frame => (
                                <button
                                  key={frame}
                                  type="button"
                                  onClick={() => setSecondaryFrame(secondaryFrame === frame ? '' : frame)}
                                  className="text-xs px-2 py-1 rounded-full border font-semibold transition-colors"
                                  style={{
                                    backgroundColor: secondaryFrame === frame ? '#7a9bbf' : 'white',
                                    color: secondaryFrame === frame ? 'white' : '#64748b',
                                    borderColor: '#94a3b8',
                                  }}
                                >
                                  {frame}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {(focusArea === 'Grammar structure' || focusArea === 'Combined') && (
                      <div>
                        <p className="text-xs text-gray-400 font-semibold mb-2">Grammar structure</p>
                        <div className="flex flex-wrap gap-1">
                          {['Conditional Structures','Concession & Contrast','Relative Clauses','Modality & Hedging','Nominalization','Passive & Reporting','Parallelism'].map(struct => (
                            <button
                              key={struct}
                              type="button"
                              onClick={() => setPrimaryStructure(primaryStructure === struct ? '' : struct)}
                              className="text-xs px-2 py-1 rounded-full border font-semibold transition-colors"
                              style={{
                                backgroundColor: primaryStructure === struct ? '#1e3a5f' : 'white',
                                color: primaryStructure === struct ? 'white' : '#64748b',
                                borderColor: '#64748b',
                              }}
                            >
                              {struct}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {focusArea !== 'Holistic' && (
                      <p className="text-xs text-blue-600 bg-blue-50 rounded px-2 py-1">
                        Scaffold is diagnostic only — score is always holistic.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            {assignError && <p className="text-red-600 text-sm">{assignError}</p>}
            <button
              onClick={handleAssign}
              disabled={assigning}
              className="w-full py-2 rounded-lg text-white text-sm font-semibold"
              style={{ backgroundColor: assigning ? '#7a9bbf' : '#1e3a5f' }}
            >
              {assigning ? 'Assigning…' : layerFilter === 'BUNDLE' ? 'Assign Bundle (3 passages)' : 'Confirm Assignment'}
            </button>
          </div>
        )}
      </div>

      {/* Assignment history */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Assigned Passages ({assignmentHistory.length})
          </p>
          {selectedAssignmentIds.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              className="text-xs font-semibold px-3 py-1 rounded-full border transition-colors"
              style={{ backgroundColor: '#fee2e2', color: '#b91c1c', borderColor: '#fca5a5' }}
            >
              Delete selected ({selectedAssignmentIds.size})
            </button>
          )}
        </div>
        {loadingAssignments ? (
          <div className="flex justify-center py-4">
            <div className="w-6 h-6 rounded-full border-4 border-blue-200 border-t-blue-700 animate-spin" />
          </div>
        ) : assignmentError ? (
          <p className="text-red-600 text-sm text-center py-4 break-all">{assignmentError}</p>
        ) : assignmentHistory.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-4">No passages assigned yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-gray-100">
            {assignmentHistory.map(assignment => {
              const attemptedPassageIds = new Set(attempts.map(a => a.passageId))
              const passageIds = assignment.passageIds || []
              const FRAME_SHORT = {
                FRAME_01: 'Scale', FRAME_02: 'Trade-offs', FRAME_03: 'Causal',
                FRAME_04: 'Conditional', FRAME_05: 'Values', FRAME_06: 'Synthesis'
              }
              const STRUCT_SHORT = {
                STRUCT_01: 'Conditional', STRUCT_02: 'Concession', STRUCT_03: 'Relative Clauses',
                STRUCT_04: 'Modality', STRUCT_05: 'Nominalization', STRUCT_06: 'Passive', STRUCT_07: 'Parallelism'
              }
              function getScaffoldBadge(sc) {
                if (!sc || sc.focusArea === 'holistic') return null
                if (sc.focusArea === 'argument_structure') return { label: 'ARG · PSU Arc', color: '#1e40af', text: '#fff' }
                if (sc.focusArea === 'discourse_frame') {
                  const frame = FRAME_SHORT[sc.primaryFrame] || 'Frame'
                  return { label: `Frames · ${frame}`, color: '#0d9488', text: '#fff' }
                }
                if (sc.focusArea === 'grammar_structure') {
                  const struct = STRUCT_SHORT[sc.primaryStructure] || 'Grammar'
                  return { label: `Grammar · ${struct}`, color: '#4338ca', text: '#fff' }
                }
                if (sc.focusArea === 'combined') {
                  const frame = FRAME_SHORT[sc.primaryFrame] || 'Frame'
                  const struct = STRUCT_SHORT[sc.primaryStructure] || 'Grammar'
                  return { label: `${frame} + ${struct}`, color: '#1e3a5f', text: '#fff' }
                }
                return null
              }
              const scaffoldBadge = assignment.scaffoldConfig
                ? getScaffoldBadge(assignment.scaffoldConfig)
                : null
              return passageIds.map(pid => {
                const attempted = attemptedPassageIds.has(pid)
                return (
                  <div key={assignment.id + pid} className="flex items-center justify-between py-3 gap-3">
                    <input
                      type="checkbox"
                      checked={selectedAssignmentIds.has(assignment.id)}
                      onChange={() => toggleAssignmentSelect(assignment.id)}
                      className="shrink-0 w-4 h-4 accent-blue-700 cursor-pointer"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 font-mono">{pid}</p>
                      <p className="text-xs text-gray-400 mt-0.5">Assigned {formatDate(assignment.assignedAt)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {scaffoldBadge && (
                        <span className="text-xs font-bold px-2 py-1 rounded-full shrink-0"
                          style={{ backgroundColor: scaffoldBadge.color, color: scaffoldBadge.text }}>
                          {scaffoldBadge.label}
                        </span>
                      )}
                      <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                        attempted
                          ? 'bg-green-100 text-green-700'
                          : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {attempted ? '✓ Attempted' : 'Pending'}
                      </span>
                      <button
                        onClick={() => handleDeleteAssignment(assignment.id)}
                        className="text-gray-300 hover:text-red-500 text-base leading-none px-1"
                        title="Remove assignment"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )
              })
            })}
          </div>
        )}
      </div>

      {/* Attempt history */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">
          Attempt History ({totalAttempts})
        </p>
        {attempts.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-4">No completed attempts found.</p>
        ) : (
          <div className="flex flex-col divide-y divide-gray-100">
            {attempts.map(attempt => {
              const colors = SCORE_COLORS[attempt.score] || SCORE_COLORS[1]
              const scoreMax = attempt.taskFamily === 'LEVEL3' ? 4 : 3
              const isExpanded = expandedAttemptId === attempt.id
              const scoringNotesOpen = showScoringNotes[attempt.id] || false
              return (
                <div key={attempt.id} className="flex flex-col border-b border-gray-100 last:border-0">
                  {/* Row header — tappable */}
                  <button
                    onClick={() => setExpandedAttemptId(isExpanded ? null : attempt.id)}
                    className="flex items-center justify-between py-3 gap-3 w-full text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">
                        {taskTypeLabel(attempt.taskType)} · {attempt.passageId}
                        <span className="ml-2 text-gray-300 text-xs">{isExpanded ? '▲' : '▼'}</span>
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{formatDate(attempt.processedAt)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {attempt.audioPath && (
                        <span onClick={e => e.stopPropagation()} className="flex items-center gap-1">
                          <AudioPlayer audioPath={attempt.audioPath} attemptId={attempt.id} playingId={playingId} setPlayingId={setPlayingId} />
                          {(() => {
                            const p = attempt.audioPath
                            if (p.endsWith('.mp3')) return <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ background: '#ccfbf1', color: '#0d9488' }}>All devices</span>
                            if (p.endsWith('.mp4')) return <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ background: '#ccfbf1', color: '#0d9488' }}>All devices</span>
                            if (p.endsWith('.webm')) return <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ background: '#f3f4f6', color: '#6b7280' }}>PC only</span>
                            return null
                          })()}
                        </span>
                      )}
                      <div className={`flex flex-col items-center justify-center w-12 h-12 rounded-full border-2 shrink-0 ${colors.bg} ${colors.border}`}>
                        <p className={`text-sm font-black leading-none ${colors.text}`}>{attempt.score}/{scoreMax}</p>
                        <p className={`text-xs font-bold leading-none mt-0.5 ${colors.text}`}>{attempt.score_label?.slice(0, 4)}</p>
                      </div>
                    </div>
                  </button>

                  {/* Expanded detail panel */}
                  {isExpanded && (
                    <div className="pb-4 flex flex-col gap-4">

                      {/* Transcript */}
                      {attempt.transcriptText && (
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Transcript</p>
                          <p className="text-sm text-gray-700 leading-relaxed">{attempt.transcriptText}</p>
                        </div>
                      )}

                      {/* Strengths */}
                      {attempt.strengths && (
                        <div className="bg-green-50 rounded-lg p-3">
                          <p className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-1">Strengths</p>
                          <p className="text-sm text-gray-700 leading-relaxed">{attempt.strengths}</p>
                        </div>
                      )}

                      {/* Gaps */}
                      {attempt.gaps && (
                        <div className="bg-yellow-50 rounded-lg p-3">
                          <p className="text-xs font-semibold text-yellow-600 uppercase tracking-wide mb-1">Gaps</p>
                          <p className="text-sm text-gray-700 leading-relaxed">{attempt.gaps}</p>
                        </div>
                      )}

                      {/* Language Feedback */}
                      {attempt.language_feedback && (
                        <div className="bg-blue-50 rounded-lg p-3">
                          <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1">Language Feedback</p>
                          <p className="text-sm text-gray-700 leading-relaxed">{attempt.language_feedback}</p>
                        </div>
                      )}

                      {/* Scoring Notes — collapsible */}
                      {attempt.monitor_notes && (
                        <div className="border border-gray-200 rounded-lg overflow-hidden">
                          <button
                            onClick={() => setShowScoringNotes(prev => ({ ...prev, [attempt.id]: !prev[attempt.id] }))}
                            className="w-full flex items-center justify-between px-3 py-2 bg-gray-100"
                          >
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Scoring Notes</p>
                            <span className="text-gray-400 text-xs">{scoringNotesOpen ? '▲' : '▼'}</span>
                          </button>
                          {scoringNotesOpen && (
                            <div className="px-3 py-3 bg-white">
                              <p className="text-xs text-gray-600 leading-relaxed font-mono">{attempt.monitor_notes}</p>
                            </div>
                          )}
                        </div>
                      )}

                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default function InstructorDashboardScreen() {
  const navigate = useNavigate()
  const { currentUser, claims } = useAuth()
  const [view, setView] = useState('roster')
  const [rosterLoading, setRosterLoading] = useState(true)
  const [rosterError, setRosterError] = useState(null)
  const [students, setStudents] = useState([])
  const [studentAttempts, setStudentAttempts] = useState({})
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [lookupId, setLookupId] = useState('')
  const [lookupSearching, setLookupSearching] = useState(false)
  const [lookupError, setLookupError] = useState(null)
  const [lookupResult, setLookupResult] = useState(null)

  async function handleSignOut() {
    await signOut(auth)
    window.location.href = '/b10_practice_platform/'
  }

  useEffect(() => {
    async function loadRoster() {
      setRosterLoading(true)
      setRosterError(null)
      try {
        const codesSnap = await getDocs(
          query(collection(db, 'accessCodes'), where('instructorUid', '==', currentUser.uid))
        )
        const codes = codesSnap.docs.map(d => d.data().code)
        if (codes.length === 0) { setStudents([]); setRosterLoading(false); return }
        const studentsSnap = await getDocs(
          query(collection(db, 'students'), where('accessCode', 'in', codes))
        )
        const studentList = studentsSnap.docs.map(d => d.data())
        setStudents(studentList)
        const attemptsMap = {}
        await Promise.all(studentList.map(async (student) => {
          const attSnap = await getDocs(
            query(collection(db, 'submissions'), where('b10Id', '==', student.b10Id), orderBy('createdAt', 'desc'))
          )
          attemptsMap[student.b10Id] = attSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(a => a.status === 'complete')
        }))
        setStudentAttempts(attemptsMap)
      } catch (err) {
        setRosterError('Failed to load roster: ' + err.message)
      } finally {
        setRosterLoading(false)
      }
    }
    loadRoster()
  }, [currentUser.uid])

  function handleStudentTap(student) {
    setSelectedStudent({ b10Id: student.b10Id, attempts: studentAttempts[student.b10Id] || [] })
    setView('detail')
  }

  async function handleLookup() {
    const id = lookupId.trim()
    if (!id) { setLookupError('Please enter a B10 ID.'); return }
    setLookupSearching(true)
    setLookupError(null)
    setLookupResult(null)
    try {
      // Confirm student exists via Cloud Function (works for all account types)
      const { getFunctions, httpsCallable } = await import('firebase/functions')
      const functions = getFunctions()
      const lookupStudent = httpsCallable(functions, 'lookupStudent')
      await lookupStudent({ b10Id: id })
      // Student confirmed — fetch any existing submissions
      const snap = await getDocs(
        query(collection(db, 'submissions'), where('b10Id', '==', id), orderBy('createdAt', 'desc'))
      )
      const attempts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(a => a.status === 'complete')
      setLookupResult({ b10Id: id, attempts })
    } catch (err) {
      if (err.message && err.message.includes('No student found')) {
        setLookupError(`No student found with B10 ID: ${id}`)
      } else {
        setLookupError('Lookup failed: ' + err.message)
      }
    } finally {
      setLookupSearching(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="px-4 py-4 flex items-center justify-between" style={{ backgroundColor: '#1e3a5f' }}>
        <div>
          <p className="text-white font-bold text-lg leading-tight">B10-PP</p>
          <p className="text-blue-200 text-xs">{claims?.b10Id} · {claims?.role}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs font-semibold px-2 py-1 rounded" style={{ backgroundColor: '#c8a84b', color: '#1e3a5f' }}>DASHBOARD</div>
          {claims?.role === 'admin' && (
            <button onClick={() => navigate('/b10_practice_platform/admin')} className="text-xs text-blue-200 underline">Admin</button>
          )}
          <button onClick={() => navigate('/b10_practice_platform/passages')} className="text-xs text-blue-200 underline">Library</button>
          <button onClick={handleSignOut} className="text-xs text-blue-200 underline">Sign out</button>
        </div>
      </header>

      <div className="flex border-b border-gray-200 bg-white">
        <button
          onClick={() => setView('roster')}
          className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-colors ${view === 'roster' || view === 'detail' ? 'border-blue-700 text-blue-700' : 'border-transparent text-gray-500'}`}
        >
          My Roster
        </button>
        <button
          onClick={() => { setView('lookup'); setLookupResult(null); setLookupError(null) }}
          className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-colors ${view === 'lookup' ? 'border-blue-700 text-blue-700' : 'border-transparent text-gray-500'}`}
        >
          Lookup
        </button>
      </div>

      <main className="px-4 py-6 max-w-2xl mx-auto flex flex-col gap-4">
        {view === 'roster' && (
          <>
            {rosterLoading && (
              <div className="flex justify-center py-12">
                <div className="w-8 h-8 rounded-full border-4 border-blue-200 border-t-blue-700 animate-spin" />
              </div>
            )}
            {rosterError && <p className="text-red-600 text-sm text-center py-4">{rosterError}</p>}
            {!rosterLoading && !rosterError && students.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <p className="font-semibold mb-1">No students enrolled yet.</p>
                <p className="text-sm">Share your access code to enroll students.</p>
              </div>
            )}
            {!rosterLoading && students.map(student => {
              const attempts = studentAttempts[student.b10Id] || []
              const lastAttempt = attempts[0]
              const colors = lastAttempt ? (SCORE_COLORS[lastAttempt.score] || SCORE_COLORS[1]) : null
              const scoreMax = lastAttempt?.taskFamily === 'LEVEL3' ? 4 : 3
              return (
                <button
                  key={student.b10Id}
                  onClick={() => handleStudentTap(student)}
                  className="w-full text-left bg-white rounded-xl border border-gray-200 shadow-sm p-4 active:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-gray-900 font-mono text-base">{student.b10Id}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-400">{attempts.length} attempt{attempts.length !== 1 ? 's' : ''}</span>
                        {lastAttempt && (
                          <>
                            <span className="text-xs text-gray-300">·</span>
                            <span className="text-xs text-gray-400">{formatDate(lastAttempt.processedAt)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    {lastAttempt ? (
                      <div className={`flex flex-col items-center justify-center w-12 h-12 rounded-full border-2 shrink-0 ${colors.bg} ${colors.border}`}>
                        <p className={`text-sm font-black leading-none ${colors.text}`}>{lastAttempt.score}/{scoreMax}</p>
                        <p className={`text-xs font-bold leading-none mt-0.5 ${colors.text}`}>{lastAttempt.score_label?.slice(0, 4)}</p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center w-12 h-12 rounded-full border-2 shrink-0 bg-gray-100 border-gray-200">
                        <p className="text-xs text-gray-400 font-semibold">New</p>
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </>
        )}

        {view === 'detail' && selectedStudent && (
          <AttemptHistory
            b10Id={selectedStudent.b10Id}
            attempts={selectedStudent.attempts}
            onBack={() => setView('roster')}
            currentUser={currentUser}
          />
        )}

        {view === 'lookup' && (
          <>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">Student Lookup</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={lookupId}
                  onChange={e => setLookupId(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLookup()}
                  placeholder="e.g., 26-001-1"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={lookupSearching}
                />
                <button
                  onClick={handleLookup}
                  disabled={lookupSearching}
                  className="px-4 py-2 rounded-lg text-white text-sm font-semibold"
                  style={{ backgroundColor: lookupSearching ? '#7a9bbf' : '#1e3a5f' }}
                >
                  {lookupSearching ? 'Searching…' : 'Look up'}
                </button>
              </div>
              {lookupError && <p className="text-red-600 text-sm mt-2">{lookupError}</p>}
            </div>
            {lookupResult && (
              <AttemptHistory
                b10Id={lookupResult.b10Id}
                attempts={lookupResult.attempts}
                onBack={() => setLookupResult(null)}
                currentUser={currentUser}
              />
            )}
          </>
        )}
      </main>
    </div>
  )
}
