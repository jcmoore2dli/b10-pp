import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import {
  collection, query, where, getDocs, orderBy
} from 'firebase/firestore'
import { db, auth } from '../services/firebase'
import { useAuth } from '../context/useAuth'

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

function AttemptHistory({ b10Id, attempts, onBack }) {
  const totalAttempts = attempts.length
  const lastAttempt = attempts[0]
  const lastPractice = lastAttempt ? formatDate(lastAttempt.processedAt) : '—'

  return (
    <div className="flex flex-col gap-6">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-blue-700 font-semibold self-start"
      >
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
              return (
                <div key={attempt.id} className="flex items-center justify-between py-3 gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">
                      {taskTypeLabel(attempt.taskType)} · {attempt.passageId}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{formatDate(attempt.processedAt)}</p>
                  </div>
                  <div className={`flex flex-col items-center justify-center w-12 h-12 rounded-full border-2 shrink-0 ${colors.bg} ${colors.border}`}>
                    <p className={`text-sm font-black leading-none ${colors.text}`}>
                      {attempt.score}/{scoreMax}
                    </p>
                    <p className={`text-xs font-bold leading-none mt-0.5 ${colors.text}`}>
                      {attempt.score_label?.slice(0, 4)}
                    </p>
                  </div>
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
        if (codes.length === 0) {
          setStudents([])
          setRosterLoading(false)
          return
        }
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
      const snap = await getDocs(
        query(collection(db, 'submissions'), where('b10Id', '==', id), orderBy('createdAt', 'desc'))
      )
      if (snap.empty) { setLookupError(`No submissions found for B10 ID: ${id}`); return }
      const attempts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(a => a.status === 'complete')
      setLookupResult({ b10Id: id, attempts })
    } catch (err) {
      setLookupError('Lookup failed: ' + err.message)
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
          <div className="text-xs font-semibold px-2 py-1 rounded" style={{ backgroundColor: '#c8a84b', color: '#1e3a5f' }}>
            DASHBOARD
          </div>
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
          <AttemptHistory b10Id={selectedStudent.b10Id} attempts={selectedStudent.attempts} onBack={() => setView('roster')} />
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
              <AttemptHistory b10Id={lookupResult.b10Id} attempts={lookupResult.attempts} onBack={() => setLookupResult(null)} />
            )}
          </>
        )}
      </main>
    </div>
  )
}
