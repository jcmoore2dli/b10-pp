import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  collection, doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../services/firebase'
import { useAuth } from '../context/useAuth'

// TOEFL admin screen. Its own screen inside frontend-toefl, following B10-PP's
// AdminScreen as a UX reference only: it reads and writes TOEFL's collections
// (toeflAccessCodes, toeflEnrollment) and never B10-PP's.
//
//   1. Create per-student access codes: T + year + number (T26-001). The code
//      becomes the student's ID when they register.
//   1b. Create TOEFL instructor accounts (T26-INS-1) via
//      createToeflInstructorAccount.
//   2. List codes, and deactivate unused ones (unused codes are the ones a
//      guesser could redeem, so don't leave them lying around).
//   3. List enrolled students and freeze/unfreeze them. Freezing goes through
//      the setToeflFreeze function, which also disables T-account logins.

const NAVY = '#1e3a5f'

function currentYearCode() {
  return `T${String(new Date().getFullYear()).slice(-2)}`
}

function fmtDate(ts) {
  if (!ts) return '—'
  const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts)
  return d.toISOString().slice(0, 10)
}

function Section({ title, children }) {
  return (
    <section className="bg-white rounded-2xl shadow-md p-6">
      <h2 className="text-lg font-bold mb-4" style={{ color: NAVY }}>{title}</h2>
      {children}
    </section>
  )
}

// ── 1. Create a code ─────────────────────────────────────────────────────────
function CreateCode({ adminId }) {
  const prefix = currentYearCode()
  const [number, setNumber] = useState('')
  const [instructorId, setInstructorId] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  const digits = number.trim()
  const valid = /^\d{1,3}$/.test(digits) && Number(digits) > 0
  const code = valid ? `${prefix}-${digits.padStart(3, '0')}` : null

  async function create() {
    if (!code) return
    setBusy(true)
    setMessage(null)
    try {
      const ref = doc(db, 'toeflAccessCodes', code)
      if ((await getDoc(ref)).exists()) {
        setMessage({ ok: false, text: `${code} already exists.` })
        return
      }
      const instr = instructorId.trim().toUpperCase()
      await setDoc(ref, {
        code,
        active: true,
        instructorId: instr || null,
        createdAt: serverTimestamp(),
        createdBy: adminId,
      })
      setMessage({ ok: true, text: `Created ${code}${instr ? ` (instructor ${instr})` : ' (self-study)'}.` })
      setNumber('')
    } catch (err) {
      setMessage({ ok: false, text: `Could not create ${code}: ${err.message}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Create an access code">
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-gray-700">Code number</span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-gray-500">{prefix}-</span>
            <input
              inputMode="numeric"
              placeholder="001"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              className="w-24 border border-gray-300 rounded-lg px-3 py-2 font-mono"
              disabled={busy}
            />
          </div>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-gray-700">Instructor ID (optional)</span>
          <input
            placeholder="Leave blank for self-study"
            value={instructorId}
            onChange={(e) => setInstructorId(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2"
            disabled={busy}
          />
        </label>
        <button
          onClick={create}
          disabled={!valid || busy}
          className="py-2 rounded-xl text-white font-semibold text-sm disabled:opacity-50"
          style={{ backgroundColor: NAVY }}
        >
          {busy ? 'Creating…' : code ? `Create ${code}` : 'Create code'}
        </button>
        {message && (
          <p role="status" className={`text-sm ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.text}</p>
        )}
        <p className="text-xs text-gray-500">
          Create a code shortly before handing it to the student, and deactivate any that go unused.
        </p>
      </div>
    </Section>
  )
}

// ── 1b. Create a TOEFL instructor ────────────────────────────────────────────
// Calls createToeflInstructorAccount. The server builds the ID from the
// current year (America/Chicago), so the prefix shown here is a preview; the
// ID in the success message is the real one.
function CreateInstructor() {
  const prefix = `${currentYearCode()}-INS-`
  const [number, setNumber] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  const digits = number.trim()
  const validNumber = /^\d{1,3}$/.test(digits) && Number(digits) >= 1
  const ready = validNumber && password.length >= 6 && password === confirm

  async function create() {
    if (!ready) return
    setBusy(true)
    setMessage(null)
    try {
      const fn = httpsCallable(functions, 'createToeflInstructorAccount')
      const res = await fn({ number: Number(digits), password })
      setMessage({ ok: true, text: `Created ${res.data.b10Id}. They sign in with that ID and this password.` })
      setNumber('')
      setPassword('')
      setConfirm('')
    } catch (err) {
      setMessage({ ok: false, text: err.message || 'Could not create the instructor.' })
    } finally {
      setBusy(false)
    }
  }

  const hint = !validNumber && digits ? 'Use a number from 1 to 999.'
    : password && password.length < 6 ? 'Password must be at least 6 characters.'
    : confirm && password !== confirm ? 'Passwords do not match.'
    : null

  return (
    <Section title="Create a TOEFL instructor">
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-gray-700">Instructor number</span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-gray-500">{prefix}</span>
            <input
              inputMode="numeric"
              placeholder="1"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              className="w-24 border border-gray-300 rounded-lg px-3 py-2 font-mono"
              disabled={busy}
            />
          </div>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-gray-700">Password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2"
            disabled={busy}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-gray-700">Confirm password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2"
            disabled={busy}
          />
        </label>
        {hint && <p className="text-xs text-gray-500">{hint}</p>}
        <button
          onClick={create}
          disabled={!ready || busy}
          className="py-2 rounded-xl text-white font-semibold text-sm disabled:opacity-50"
          style={{ backgroundColor: NAVY }}
        >
          {busy ? 'Creating…' : validNumber ? `Create ${prefix}${Number(digits)}` : 'Create instructor'}
        </button>
        {message && (
          <p role="status" className={`text-sm ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.text}</p>
        )}
        <p className="text-xs text-gray-500">
          TOEFL instructors can look up any TOEFL student and manage their own roster. They also have
          B10-PP instructor access, because they carry the same instructor role.
        </p>
      </div>
    </Section>
  )
}

// ── 2. Codes ─────────────────────────────────────────────────────────────────
function codeStatus(c) {
  if (c.redeemedAt) return 'Used'
  return c.active ? 'Unused' : 'Deactivated'
}

function CodeList({ codes, error }) {
  const [busy, setBusy] = useState(null)
  const [message, setMessage] = useState(null)

  async function setActive(c, active) {
    setBusy(c.id)
    setMessage(null)
    try {
      await updateDoc(doc(db, 'toeflAccessCodes', c.id), active
        ? { active: true, reactivatedAt: serverTimestamp() }
        : { active: false, deactivatedAt: serverTimestamp() })
    } catch (err) {
      setMessage(`Could not update ${c.id}: ${err.message}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Section title={`Access codes (${codes.length})`}>
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      {message && <p className="text-sm text-red-600 mb-3">{message}</p>}
      {codes.length === 0 ? (
        <p className="text-sm text-gray-500">No codes yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="py-2 pr-3">Code</th>
                <th className="py-2 pr-3">Instructor</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => {
                const status = codeStatus(c)
                return (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-mono">{c.id}</td>
                    <td className="py-2 pr-3">{c.instructorId || <span className="text-gray-400">self-study</span>}</td>
                    <td className="py-2 pr-3">{status}</td>
                    <td className="py-2 text-right">
                      {status !== 'Used' && (
                        <button
                          onClick={() => setActive(c, status === 'Deactivated')}
                          disabled={busy === c.id}
                          className="text-xs underline text-blue-700 disabled:opacity-50"
                        >
                          {status === 'Unused' ? 'Deactivate' : 'Reactivate'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

// ── 3. Enrolled students ─────────────────────────────────────────────────────
function enrollmentStatus(e, now) {
  if (e.frozen) return 'Frozen'
  const exp = e.expiresAt && typeof e.expiresAt.toDate === 'function' ? e.expiresAt.toDate() : null
  if (exp && exp <= now) return 'Expired'
  return 'Active'
}

const STATUS_STYLE = {
  Active: 'text-green-700',
  Frozen: 'text-red-700 font-semibold',
  Expired: 'text-gray-500',
}

function EnrollmentList({ enrollments, error }) {
  const [busy, setBusy] = useState(null)
  const [message, setMessage] = useState(null)
  const [filter, setFilter] = useState('')
  const now = useMemo(() => new Date(), [enrollments])

  const shown = enrollments.filter((e) => e.id.toUpperCase().includes(filter.trim().toUpperCase()))

  async function toggle(e) {
    const frozen = !e.frozen
    if (frozen && !window.confirm(`Freeze ${e.id}? They lose TOEFL access immediately${/^T\d{2}-\d{3}$/.test(e.id) ? ' and cannot sign in' : ''}.`)) return
    setBusy(e.id)
    setMessage(null)
    try {
      const setToeflFreeze = httpsCallable(functions, 'setToeflFreeze')
      const res = await setToeflFreeze({ b10Id: e.id, frozen })
      setMessage({
        ok: true,
        text: `${e.id} ${frozen ? 'frozen' : 'unfrozen'}.` +
          (res.data.loginDisabled ? ' Login disabled.' : frozen ? ' Login unchanged (B10-PP account).' : ''),
      })
    } catch (err) {
      setMessage({ ok: false, text: `${e.id}: ${err.message}` })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Section title={`Enrolled students (${enrollments.length})`}>
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      <input
        placeholder="Filter by ID"
        value={filter}
        onChange={(ev) => setFilter(ev.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
      />
      {message && (
        <p role="status" className={`text-sm mb-3 ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.text}</p>
      )}
      {shown.length === 0 ? (
        <p className="text-sm text-gray-500">{enrollments.length === 0 ? 'No enrolled students yet.' : 'No match.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="py-2 pr-3">ID</th>
                <th className="py-2 pr-3">Instructor</th>
                <th className="py-2 pr-3">Enrolled</th>
                <th className="py-2 pr-3">Expires</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => {
                const status = enrollmentStatus(e, now)
                return (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-mono">{e.id}</td>
                    <td className="py-2 pr-3">{e.instructorId || <span className="text-gray-400">—</span>}</td>
                    <td className="py-2 pr-3">{fmtDate(e.enrolledAt)}</td>
                    <td className="py-2 pr-3">{fmtDate(e.expiresAt)}</td>
                    <td className={`py-2 pr-3 ${STATUS_STYLE[status]}`}>{status}</td>
                    <td className="py-2 text-right">
                      <label className="inline-flex items-center gap-1 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(e.frozen)}
                          onChange={() => toggle(e)}
                          disabled={busy === e.id}
                        />
                        Frozen
                      </label>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

// Live list of a collection, sorted by document ID.
function useCollection(name) {
  const [rows, setRows] = useState([])
  const [error, setError] = useState(null)
  useEffect(() => onSnapshot(
    collection(db, name),
    (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.id.localeCompare(b.id)))
      setError(null)
    },
    (err) => setError(`Could not load ${name}: ${err.message}`),
  ), [name])
  return [rows, error]
}

export default function AdminScreen() {
  const { currentUser, claims } = useAuth()
  const [codes, codesError] = useCollection('toeflAccessCodes')
  const [enrollments, enrollmentsError] = useCollection('toeflEnrollment')

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-bold" style={{ color: NAVY }}>TOEFL admin</h1>
          <Link to="/" className="text-blue-600 underline text-xs">← entry</Link>
        </div>
        <CreateCode adminId={claims?.b10Id || currentUser?.uid} />
        <CreateInstructor />
        <EnrollmentList enrollments={enrollments} error={enrollmentsError} />
        <CodeList codes={codes} error={codesError} />
      </div>
    </div>
  )
}
