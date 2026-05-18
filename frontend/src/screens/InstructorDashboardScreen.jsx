import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore'
import { db, auth } from '../services/firebase'
import { useAuth } from '../context/useAuth'

/**
 * InstructorDashboardScreen
 * Route: /b10_practice_platform/instructor
 * Access: instructor + admin
 *
 * Phase 1 (Week 4):
 *   - Student lookup by b10Id
 *   - Attempt history (score, score_label, taskType, passageId, processedAt)
 *   - Stats row (total attempts, last practice)
 *
 * Phase 2 (Week 4 continued):
 *   - Assign passage to student
 */

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

export default function InstructorDashboardScreen() {
  const navigate = useNavigate()
  const { currentUser, claims } = useAuth()

  const [lookupId, setLookupId] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const [studentData, setStudentData] = useState(null)   // { b10Id, attempts[] }

  async function handleSignOut() {
    await signOut(auth)
    window.location.href = '/b10_practice_platform/'
  }

  async function handleLookup() {
    const id = lookupId.trim()
    if (!id) {
      setSearchError('Please enter a B10 ID.')
      return
    }
    setSearching(true)
    setSearchError(null)
    setStudentData(null)

    try {
      const q = query(
        collection(db, 'submissions'),
        where('b10Id', '==', id),
        orderBy('createdAt', 'desc')
      )
      const snap = await getDocs(q)

      if (snap.empty) {
        setSearchError(`No submissions found for B10 ID: ${id}`)
        setSearching(false)
        return
      }

      const attempts = snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(a => a.status === 'complete')

      setStudentData({ b10Id: id, attempts })
    } catch (err) {
      setSearchError('Lookup failed: ' + err.message)
    } finally {
      setSearching(false)
    }
  }

  const totalAttempts = studentData?.attempts?.length || 0
  const lastAttempt = studentData?.attempts?.[0]
  const lastPractice = lastAttempt ? formatDate(lastAttempt.processedAt) : '—'

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header
        className="px-4 py-4 flex items-center justify-between"
        style={{ backgroundColor: '#1e3a5f' }}
      >
        <div>
          <p className="text-white font-bold text-lg leading-tight">B10-PP</p>
          <p className="text-blue-200 text-xs">{claims?.b10Id} · {claims?.role}</p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="text-xs font-semibold px-2 py-1 rounded"
            style={{ backgroundColor: '#c8a84b', color: '#1e3a5f' }}
          >
            DASHBOARD
          </div>
          {claims?.role === 'admin' && (
            <button
              onClick={() => navigate('/b10_practice_platform/admin')}
              className="text-xs text-blue-200 underline"
            >
              Admin
            </button>
          )}
          <button
            onClick={() => navigate('/b10_practice_platform/passages')}
            className="text-xs text-blue-200 underline"
          >
            Library
          </button>
          <button
            onClick={handleSignOut}
            className="text-xs text-blue-200 underline"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="px-4 py-6 max-w-2xl mx-auto flex flex-col gap-6">

        {/* Lookup card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">
            Student Lookup
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={lookupId}
              onChange={e => setLookupId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLookup()}
              placeholder="e.g., 26-001-1"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={searching}
            />
            <button
              onClick={handleLookup}
              disabled={searching}
              className="px-4 py-2 rounded-lg text-white text-sm font-semibold"
              style={{ backgroundColor: searching ? '#7a9bbf' : '#1e3a5f' }}
            >
              {searching ? 'Searching…' : 'Look up'}
            </button>
          </div>
          {searchError && (
            <p className="text-red-600 text-sm mt-2">{searchError}</p>
          )}
        </div>

        {/* Student results */}
        {studentData && (
          <>
            {/* Found banner */}
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-xs text-blue-400 font-semibold uppercase tracking-wide mb-0.5">
                  Student B10 ID
                </p>
                <p className="text-lg font-black text-gray-900 font-mono">
                  {studentData.b10Id}
                </p>
              </div>
              <p className="text-xs font-bold text-green-600">Found</p>
            </div>

            {/* Stats row */}
            <div className="flex border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
              <div className="flex-1 px-4 py-3 border-r border-gray-200 text-center">
                <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-1">
                  Attempts
                </p>
                <p className="text-xl font-black text-gray-900">{totalAttempts}</p>
              </div>
              <div className="flex-1 px-4 py-3 border-r border-gray-200 text-center">
                <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-1">
                  Last Practice
                </p>
                <p className="text-sm font-bold text-gray-900">{lastPractice}</p>
              </div>
              <div className="flex-1 px-4 py-3 text-center">
                <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-1">
                  Last Score
                </p>
                <p className="text-xl font-black text-gray-900">
                  {lastAttempt ? `${lastAttempt.score}/${lastAttempt.taskFamily === 'LEVEL3' ? 4 : 3}` : '—'}
                </p>
              </div>
            </div>

            {/* Attempt history */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">
                Attempt History ({totalAttempts})
              </p>
              {studentData.attempts.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-4">
                  No completed attempts found.
                </p>
              ) : (
                <div className="flex flex-col divide-y divide-gray-100">
                  {studentData.attempts.map(attempt => {
                    const colors = SCORE_COLORS[attempt.score] || SCORE_COLORS[1]
                    const scoreMax = attempt.taskFamily === 'LEVEL3' ? 4 : 3
                    return (
                      <div key={attempt.id} className="flex items-center justify-between py-3 gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900">
                            {taskTypeLabel(attempt.taskType)} · {attempt.passageId}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {formatDate(attempt.processedAt)}
                          </p>
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
          </>
        )}

      </main>
    </div>
  )
}
