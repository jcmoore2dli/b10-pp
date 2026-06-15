import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, doc, setDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
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
  const [preloadBundles, setPreloadBundles] = useState(false)
  const [preloadFrames, setPreloadFrames] = useState(false)
  const [linkedInstrB10Id, setLinkedInstrB10Id] = useState('')

  // Instructor account creation
  const [instrB10Id, setInstrB10Id] = useState('')
  const [instrPassword, setInstrPassword] = useState('')
  const [instrGroupId, setInstrGroupId] = useState('DLIELC')
  const [instrLoading, setInstrLoading] = useState(false)
  const [instrError, setInstrError] = useState(null)
  const [instrSuccess, setInstrSuccess] = useState(null)


  // Bulk Roster Setup
  const [rosterInstrB10Id, setRosterInstrB10Id] = useState('')
  const [rosterStudentList, setRosterStudentList] = useState('')
  const [rosterPreload, setRosterPreload] = useState(true)
  const [rosterPreloadFrames, setRosterPreloadFrames] = useState(false)
  const [rosterExpiry, setRosterExpiry] = useState('')
  const [rosterLoading, setRosterLoading] = useState(false)
  const [rosterError, setRosterError] = useState(null)
  const [rosterResults, setRosterResults] = useState(null)

  async function handleBulkRosterSetup() {
    setRosterError(null)
    setRosterResults(null)
    const studentB10Ids = rosterStudentList
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
    if (!rosterInstrB10Id.trim()) {
      setRosterError('Instructor B10 ID is required.')
      return
    }
    if (studentB10Ids.length === 0) {
      setRosterError('Enter at least one student B10 ID.')
      return
    }
    setRosterLoading(true)
    try {
      const functions = getFunctions()
      const adminBulkRosterSetup = httpsCallable(functions, 'adminBulkRosterSetup')
      const result = await adminBulkRosterSetup({
        instructorB10Id: rosterInstrB10Id.trim(),
        studentB10Ids,
        preloadBundles: rosterPreload,
        preloadFrames: rosterPreloadFrames,
        expiryDate: rosterExpiry.trim() || null,
      })
      setRosterResults(result.data)
    } catch (err) {
      setRosterError(err.message || 'Bulk roster setup failed.')
    } finally {
      setRosterLoading(false)
    }
  }
  async function handleCreateInstructor() {
    setInstrError(null)
    setInstrSuccess(null)
    if (!instrB10Id || !instrPassword) {
      setInstrError('Please enter a B10 ID and password.')
      return
    }
    if (instrPassword.length < 6) {
      setInstrError('Password must be at least 6 characters.')
      return
    }
    setInstrLoading(true)
    try {
      const functions = getFunctions()
      const createInstructorAccount = httpsCallable(functions, 'createInstructorAccount')
      const result = await createInstructorAccount({
        b10Id:    instrB10Id.trim(),
        password: instrPassword,
        groupId:  instrGroupId.trim(),
      })
      setInstrSuccess(`Instructor account created: ${result.data.b10Id}`)
      setInstrB10Id('')
      setInstrPassword('')
    } catch (err) {
      setInstrError(err.message || 'Failed to create instructor account.')
    } finally {
      setInstrLoading(false)
    }
  }

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
        code:              fullCode,
        groupId:           groupId.trim(),
        instructorUid:     currentUser.uid,
        linkedInstrB10Id:  linkedInstrB10Id.trim() || null,
        preloadBundles,
        preloadFrames,
        enrolledCount:     0,
        active,
        createdAt:         serverTimestamp(),
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

          {/* Pre-load CORE bundles toggle */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Pre-load CORE Bundle Sequence
              </p>
              <p className="text-xs text-gray-400">Students auto-receive 60 bundles on enrollment</p>
            </div>
            <button
              onClick={() => setPreloadBundles(!preloadBundles)}
              className={`w-12 h-6 rounded-full transition-colors relative ${
                preloadBundles ? 'bg-blue-600' : 'bg-gray-300'
              }`}
              disabled={loading}
            >
              <span
                className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  preloadBundles ? 'translate-x-7' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Pre-load Frames Practice toggle */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Pre-load Frames Practice (W1-W6)
              </p>
              <p className="text-xs text-gray-400">Students auto-receive 6 weekly Frames sets on enrollment</p>
            </div>
            <button
              onClick={() => setPreloadFrames(!preloadFrames)}
              className={`w-12 h-6 rounded-full transition-colors relative ${
                preloadFrames ? 'bg-teal-600' : 'bg-gray-300'
              }`}
              disabled={loading}
            >
              <span
                className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  preloadFrames ? 'translate-x-7' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Linked instructor B10 ID (required for preload) */}
          {preloadBundles && (
            <div className="flex flex-col gap-1 mb-4">
              <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Linked Instructor B10 ID
              </label>
              <input
                type="text"
                value={linkedInstrB10Id}
                onChange={(e) => setLinkedInstrB10Id(e.target.value)}
                placeholder="e.g. 26-INS-2"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={loading}
              />
              <p className="text-xs text-gray-400">Student will be added to this instructor's roster</p>
            </div>
          )}

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

        {/* Create Instructor Account */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">
            Create Instructor Account
          </p>
          <div className="flex flex-col gap-1 mb-4">
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">B10 ID</label>
            <input type="text" value={instrB10Id} onChange={(e) => setInstrB10Id(e.target.value)}
              placeholder="e.g. 26-INS-1"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={instrLoading} />
          </div>
          <div className="flex flex-col gap-1 mb-4">
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Password</label>
            <input type="password" value={instrPassword} onChange={(e) => setInstrPassword(e.target.value)}
              placeholder="Min 6 characters"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={instrLoading} />
          </div>
          <div className="flex flex-col gap-1 mb-5">
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Group ID</label>
            <input type="text" value={instrGroupId} onChange={(e) => setInstrGroupId(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={instrLoading} />
          </div>
          {instrError && <p className="text-red-600 text-sm font-medium mb-3">{instrError}</p>}
          {instrSuccess && <p className="text-green-600 text-sm font-medium mb-3">{instrSuccess}</p>}
          <button onClick={handleCreateInstructor} disabled={instrLoading}
            className="w-full py-3 rounded-xl text-white font-semibold text-base"
            style={{ backgroundColor: instrLoading ? '#7a9bbf' : '#1e5c3a' }}>
            {instrLoading ? 'Creating…' : 'Create Instructor Account'}
          </button>
        </div>


        {/* Bulk Roster Setup */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">
            Bulk Roster Setup
          </p>

          <div className="flex flex-col gap-1 mb-4">
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Instructor B10 ID
            </label>
            <input
              type="text"
              value={rosterInstrB10Id}
              onChange={(e) => setRosterInstrB10Id(e.target.value)}
              placeholder="e.g. 26-INS-2"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={rosterLoading}
            />
          </div>

          <div className="flex flex-col gap-1 mb-4">
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Student B10 IDs (one per line)
            </label>
            <textarea
              value={rosterStudentList}
              onChange={(e) => setRosterStudentList(e.target.value)}
              placeholder={"26-001-1\n26-001-2\n26-001-3"}
              rows={6}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              disabled={rosterLoading}
            />
            <p className="text-xs text-gray-400">
              {rosterStudentList.split('\n').filter(s => s.trim()).length} student(s) entered
            </p>
          </div>

          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Pre-load CORE Bundle Sequence
              </p>
              <p className="text-xs text-gray-400">Assigns all 60 bundles (S1.1–S12.5) in order</p>
            </div>
            <button
              onClick={() => setRosterPreload(!rosterPreload)}
              className={`w-12 h-6 rounded-full transition-colors relative ${
                rosterPreload ? 'bg-blue-600' : 'bg-gray-300'
              }`}
              disabled={rosterLoading}
            >
              <span
                className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  rosterPreload ? 'translate-x-7' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Pre-load Frames Practice (W1-W6)
              </p>
              <p className="text-xs text-gray-400">Assigns 6 weekly Frames sets</p>
            </div>
            <button
              onClick={() => setRosterPreloadFrames(!rosterPreloadFrames)}
              className={`w-12 h-6 rounded-full transition-colors relative ${
                rosterPreloadFrames ? 'bg-teal-600' : 'bg-gray-300'
              }`}
              disabled={rosterLoading}
            >
              <span
                className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  rosterPreloadFrames ? 'translate-x-7' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="flex flex-col gap-1 mb-5">
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Expiry Date (optional)
            </label>
            <input
              type="date"
              value={rosterExpiry}
              onChange={(e) => setRosterExpiry(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={rosterLoading}
            />
            <p className="text-xs text-gray-400">Leave blank for no expiry</p>
          </div>

          {rosterError && (
            <p className="text-red-600 text-sm font-medium mb-3">{rosterError}</p>
          )}

          {rosterResults && (
            <div className="mb-4 bg-gray-50 border border-gray-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                Results — {rosterResults.successCount} ok · {rosterResults.errorCount} failed
              </p>
              <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                {rosterResults.results.map((r) => (
                  <div key={r.b10Id} className="flex items-center justify-between text-xs font-mono">
                    <span className="text-gray-700">{r.b10Id}</span>
                    {r.status === 'ok' ? (
                      <span className="text-green-600 font-semibold">
                        ✓{r.assignmentsCreated > 0 ? ` · ${r.assignmentsCreated} assignments` : ''}
                      </span>
                    ) : (
                      <span className="text-red-500" title={r.error}>✗ {r.error}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={handleBulkRosterSetup}
            disabled={rosterLoading}
            className="w-full py-3 rounded-xl text-white font-semibold text-base"
            style={{ backgroundColor: rosterLoading ? '#7a9bbf' : '#5b3a8f' }}
          >
            {rosterLoading ? 'Setting up roster…' : 'Set Up Roster'}
          </button>
        </div>

      </main>
    </div>
  )
}
