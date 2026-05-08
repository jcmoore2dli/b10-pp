import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, doc, setDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../context/useAuth'

/**
 * AdminScreen — Access Code Management
 * Admin-only. Not student-facing.
 *
 * Creates new access codes in /accessCodes.
 * instructorUid auto-populated from signed-in admin's UID.
 * groupId defaults to "DLIELC".
 * active defaults to true.
 */

function getCurrentYearCode() {
  const yr = new Date().getFullYear().toString().slice(-2)
  return yr
}

export default function AdminScreen() {
  const navigate = useNavigate()
  const { currentUser, claims } = useAuth()

  const yearPrefix = getCurrentYearCode()
  const [codeNumber, setCodeNumber] = useState('001')
  const [groupId, setGroupId] = useState('DLIELC')
  const [active, setActive] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  const fullCode = `${yearPrefix}-${codeNumber.padStart(3, '0')}`

  async function handleCreate() {
    setError(null)
    setSuccess(null)

    if (!codeNumber || codeNumber.trim() === '') {
      setError('Please enter a code number.')
      return
    }

    setLoading(true)
    try {
      // Check if code already exists
      const existing = await getDocs(
        query(collection(db, 'accessCodes'), where('code', '==', fullCode))
      )
      if (!existing.empty) {
        setError(`Code ${fullCode} already exists.`)
        setLoading(false)
        return
      }

      await setDoc(doc(db, 'accessCodes', fullCode), {
        code:           fullCode,
        groupId:        groupId.trim(),
        instructorUid:  currentUser.uid,
        enrolledCount:  0,
        active,
        createdAt:      serverTimestamp(),
      })

      setSuccess(`Access code ${fullCode} created successfully.`)
      setCodeNumber('')
    } catch (err) {
      setError('Failed to create access code: ' + err.message)
    } finally {
      setLoading(false)
    }
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
          <p className="text-blue-200 text-xs">Admin · {claims?.b10Id}</p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="text-xs font-semibold px-2 py-1 rounded"
            style={{ backgroundColor: '#c8a84b', color: '#1e3a5f' }}
          >
            ADMIN
          </div>
          <button
            onClick={() => navigate('/b10_practice_platform/passages')}
            className="text-xs text-blue-200 underline"
          >
            Back
          </button>
        </div>
      </header>

      <main className="px-4 py-6 max-w-lg mx-auto flex flex-col gap-6">

        {/* Create Access Code */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">
            Create Access Code
          </p>

          {/* Code preview */}
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 mb-4 text-center">
            <p className="text-xs text-blue-400 uppercase tracking-wide font-semibold mb-1">
              Code Preview
            </p>
            <p className="text-2xl font-black text-blue-800 font-mono">{fullCode}</p>
          </div>

          {/* Code number input */}
          <div className="flex flex-col gap-1 mb-4">
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Code Number
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono text-gray-400">{yearPrefix}-</span>
              <input
                type="text"
                value={codeNumber}
                onChange={(e) => setCodeNumber(e.target.value.replace(/\D/g, '').slice(0, 3))}
                placeholder="001"
                maxLength={3}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono w-24 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={loading}
              />
            </div>
            <p className="text-xs text-gray-400">3-digit number, e.g. 001, 002</p>
          </div>

          {/* Group ID */}
          <div className="flex flex-col gap-1 mb-4">
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Group ID
            </label>
            <input
              type="text"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            />
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Active</p>
              <p className="text-xs text-gray-400">Students can enroll with this code</p>
            </div>
            <button
              onClick={() => setActive(!active)}
              className={`w-12 h-6 rounded-full transition-colors relative ${
                active ? 'bg-blue-600' : 'bg-gray-300'
              }`}
              disabled={loading}
            >
              <span
                className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  active ? 'translate-x-7' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Instructor UID (read-only display) */}
          <div className="flex flex-col gap-1 mb-5">
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Instructor UID
            </label>
            <p className="text-xs font-mono text-gray-400 bg-gray-50 rounded px-3 py-2 border border-gray-200">
              {currentUser?.uid}
            </p>
            <p className="text-xs text-gray-400">Auto-set from signed-in account</p>
          </div>

          {/* Error / success */}
          {error && (
            <p className="text-red-600 text-sm font-medium mb-3">{error}</p>
          )}
          {success && (
            <p className="text-green-600 text-sm font-medium mb-3">{success}</p>
          )}

          {/* Submit */}
          <button
            onClick={handleCreate}
            disabled={loading}
            className="w-full py-3 rounded-xl text-white font-semibold text-base"
            style={{ backgroundColor: loading ? '#7a9bbf' : '#1e3a5f' }}
          >
            {loading ? 'Creating…' : 'Create Access Code'}
          </button>
        </div>

      </main>
    </div>
  )
}
