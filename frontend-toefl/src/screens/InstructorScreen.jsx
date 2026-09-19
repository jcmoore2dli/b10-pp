import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, setDoc, where,
} from 'firebase/firestore'
import { db } from '../services/firebase'
import { useAuth } from '../context/useAuth'
import { enrollmentStatus, normalizeStudentId, summarizeSubmission } from '../lib/submissionSummary'

// TOEFL instructor screen: its own screen inside frontend-toefl, NOT B10-PP's
// instructor dashboard. Mirrors B10-PP's Lookup tab, plus a roster with both
// add AND remove (B10-PP has no remove; JC, 2026-09-19).
//
//   - Look up ANY TOEFL student by ID (cross-class tracking, substitute
//     coverage): enrollment status, attempts, submissions and scores.
//   - Add the student to, or remove them from, MY roster:
//     toeflRosters/{myId}/students/{studentId}.
//   - My roster: live list, each row opens the same detail view.
//
// Reads only TOEFL collections. The rules (isToeflStaff, canManageToeflRoster)
// are the enforcement; B10-PP instructors never reach this screen (App.jsx
// routes on isToeflStaffClaims).

const NAVY = '#1e3a5f'

const STATUS_STYLE = {
  Active: 'text-green-700',
  Frozen: 'text-red-700 font-semibold',
  Expired: 'text-gray-500',
}

function fmtDateTime(ts) {
  if (!ts || typeof ts.toDate !== 'function') return '—'
  return ts.toDate().toISOString().slice(0, 16).replace('T', ' ')
}

function fmtDate(ts) {
  return fmtDateTime(ts).slice(0, 10)
}

function Section({ title, children, right }) {
  return (
    <section className="bg-white rounded-2xl shadow-md p-6">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-lg font-bold" style={{ color: NAVY }}>{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

// ── Student detail: enrollment + activity ────────────────────────────────────
function useStudentActivity(studentId) {
  const [state, setState] = useState({ loading: true, attempts: [], submissions: [], error: null })

  useEffect(() => {
    if (!studentId) return
    let cancelled = false
    setState({ loading: true, attempts: [], submissions: [], error: null })
    const byStudent = (name) => getDocs(query(collection(db, name), where('studentId', '==', studentId)))
    Promise.all([byStudent('toeflAttempts'), byStudent('toeflSubmissions')])
      .then(([a, s]) => {
        if (cancelled) return
        setState({
          loading: false,
          attempts: a.docs.map((d) => ({ id: d.id, ...d.data() })),
          submissions: s.docs.map((d) => ({ id: d.id, ...d.data() })),
          error: null,
        })
      })
      .catch((err) => { if (!cancelled) setState({ loading: false, attempts: [], submissions: [], error: err.message }) })
    return () => { cancelled = true }
  }, [studentId])

  return state
}

// One row per attempt, newest first, joined to its submission(s) by attemptId.
// Submissions whose attempt is missing still get a row, so nothing is hidden.
function activityRows(attempts, submissions) {
  const subsByAttempt = new Map()
  for (const s of submissions) {
    const list = subsByAttempt.get(s.attemptId) || []
    list.push(s)
    subsByAttempt.set(s.attemptId, list)
  }
  const rows = attempts.map((a) => ({ attempt: a, subs: subsByAttempt.get(a.id) || [] }))
  const known = new Set(attempts.map((a) => a.id))
  for (const s of submissions) {
    if (!known.has(s.attemptId)) rows.push({ attempt: null, subs: [s] })
  }
  const when = (r) => (r.attempt?.startedAt?.toMillis?.() ?? r.subs[0]?.scoredAt?.toMillis?.() ?? 0)
  return rows.sort((x, y) => when(y) - when(x))
}

function StudentDetail({ studentId, enrollment }) {
  const { loading, attempts, submissions, error } = useStudentActivity(studentId)
  const status = enrollmentStatus(enrollment)
  const rows = activityRows(attempts, submissions)
  const scored = submissions.filter((s) => s.scoringStatus === 'scored').length

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-gray-500">Student</dt><dd className="font-mono">{studentId}</dd>
        <dt className="text-gray-500">Status</dt><dd className={STATUS_STYLE[status]}>{status}</dd>
        <dt className="text-gray-500">Enrolled</dt><dd>{fmtDate(enrollment.enrolledAt)}</dd>
        <dt className="text-gray-500">Expires</dt><dd>{fmtDate(enrollment.expiresAt)}</dd>
        <dt className="text-gray-500">Code instructor</dt><dd>{enrollment.instructorId || <span className="text-gray-400">self-study</span>}</dd>
        <dt className="text-gray-500">Activity</dt>
        <dd>{loading ? 'Loading…' : `${attempts.length} attempt(s), ${submissions.length} submission(s), ${scored} scored`}</dd>
      </dl>

      {error && <p className="text-sm text-red-600">Could not load activity: {error}</p>}

      {!loading && !error && (rows.length === 0 ? (
        <p className="text-sm text-gray-500">No TOEFL activity yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="py-2 pr-3">Started</th>
                <th className="py-2 pr-3">Item</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Result</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ attempt, subs }, i) => {
                const sub = subs[subs.length - 1]
                return (
                  <tr key={attempt?.id || sub?.id || i} className="border-b last:border-0 align-top">
                    <td className="py-2 pr-3 whitespace-nowrap">{fmtDateTime(attempt?.startedAt)}</td>
                    <td className="py-2 pr-3 font-mono">{attempt?.itemId || '—'}</td>
                    <td className="py-2 pr-3">{attempt?.taskType || sub?.taskType || '—'}</td>
                    <td className="py-2 pr-3">
                      {sub ? summarizeSubmission(sub)
                        : attempt?.completedAt ? 'Completed, no submission' : 'In progress / not submitted'}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {sub && <Link to={`/results/${sub.id}`} className="text-xs underline text-blue-700">View</Link>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

// ── Roster add/remove button ─────────────────────────────────────────────────
function RosterToggle({ myId, studentId, onRoster }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const ref = doc(db, 'toeflRosters', myId, 'students', studentId)

  async function toggle() {
    if (onRoster && !window.confirm(`Remove ${studentId} from your roster? Their TOEFL data is not affected.`)) return
    setBusy(true)
    setError(null)
    try {
      if (onRoster) await deleteDoc(ref)
      else await setDoc(ref, { addedAt: serverTimestamp(), addedBy: myId })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button
        onClick={toggle}
        disabled={busy}
        className={`text-xs px-3 py-1 rounded-lg font-semibold disabled:opacity-50 ${onRoster ? 'border border-red-300 text-red-700' : 'text-white'}`}
        style={onRoster ? {} : { backgroundColor: NAVY }}
      >
        {busy ? '…' : onRoster ? 'Remove from my roster' : 'Add to my roster'}
      </button>
      {error && <span className="text-xs text-red-600 mt-1">{error}</span>}
    </span>
  )
}

// ── Lookup ───────────────────────────────────────────────────────────────────
function Lookup({ myId, rosterIds, selected, onSelect }) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  async function lookUp(e) {
    e?.preventDefault()
    const id = normalizeStudentId(input)
    if (!id) return
    setBusy(true)
    setMessage(null)
    try {
      const snap = await getDoc(doc(db, 'toeflEnrollment', id))
      if (!snap.exists()) {
        setMessage(`No TOEFL student with ID ${id}.`)
        onSelect(null)
      } else {
        onSelect({ id, enrollment: snap.data() })
      }
    } catch (err) {
      setMessage(`Lookup failed: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Look up a TOEFL student">
      <form onSubmit={lookUp} className="flex gap-2 mb-3">
        <input
          placeholder="Student ID, e.g. T26-001"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="px-4 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-50"
          style={{ backgroundColor: NAVY }}
        >
          {busy ? '…' : 'Look up'}
        </button>
      </form>
      {message && <p className="text-sm text-gray-600 mb-3">{message}</p>}
      {selected && (
        <div className="border-t pt-4">
          <div className="flex justify-end mb-2">
            <RosterToggle myId={myId} studentId={selected.id} onRoster={rosterIds.has(selected.id)} />
          </div>
          <StudentDetail key={selected.id} studentId={selected.id} enrollment={selected.enrollment} />
        </div>
      )}
    </Section>
  )
}

// ── My roster ────────────────────────────────────────────────────────────────
function useMyRoster(myId) {
  const [entries, setEntries] = useState([])
  const [error, setError] = useState(null)
  useEffect(() => {
    if (!myId) return
    return onSnapshot(
      collection(db, 'toeflRosters', myId, 'students'),
      (snap) => {
        setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.id.localeCompare(b.id)))
        setError(null)
      },
      (err) => setError(err.message),
    )
  }, [myId])
  return [entries, error]
}

// Live enrollments, for roster status. TOEFL staff may list them.
function useEnrollments() {
  const [byId, setById] = useState(new Map())
  useEffect(() => onSnapshot(
    collection(db, 'toeflEnrollment'),
    (snap) => setById(new Map(snap.docs.map((d) => [d.id, d.data()]))),
    () => {},
  ), [])
  return byId
}

function Roster({ myId, entries, error, enrollments, onOpen }) {
  return (
    <Section title={`My roster (${entries.length})`}>
      {error && <p className="text-sm text-red-600 mb-3">Could not load roster: {error}</p>}
      {entries.length === 0 ? (
        <p className="text-sm text-gray-500">No students yet. Look one up above and add them.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="py-2 pr-3">Student</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Added</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((r) => {
                const enrollment = enrollments.get(r.id)
                const status = enrollmentStatus(enrollment)
                return (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-mono">{r.id}</td>
                    <td className={`py-2 pr-3 ${STATUS_STYLE[status] || 'text-gray-500'}`}>{status}</td>
                    <td className="py-2 pr-3">{fmtDate(r.addedAt)}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {enrollment && (
                        <button onClick={() => onOpen({ id: r.id, enrollment })} className="text-xs underline text-blue-700 mr-3">
                          View
                        </button>
                      )}
                      <RosterToggle myId={myId} studentId={r.id} onRoster />
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

export default function InstructorScreen() {
  const { currentUser, claims } = useAuth()
  // Roster key: the staff member's TOEFL ID (T26-INS-1, or ADMIN001 for the
  // admin). The rules require addedBy to equal the same value.
  const myId = claims?.b10Id || currentUser?.uid
  const [entries, rosterError] = useMyRoster(myId)
  const enrollments = useEnrollments()
  const [selected, setSelected] = useState(null)
  const rosterIds = new Set(entries.map((e) => e.id))

  function open(student) {
    setSelected(student)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-3xl mx-auto flex flex-col gap-6">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-bold" style={{ color: NAVY }}>TOEFL instructor</h1>
          <span className="text-xs text-gray-500">
            <span className="font-mono">{myId}</span>
            {' · '}
            {claims?.role === 'admin' && <><Link to="/admin" className="text-blue-600 underline">admin</Link>{' · '}</>}
            <Link to="/" className="text-blue-600 underline">entry</Link>
          </span>
        </div>
        <Lookup myId={myId} rosterIds={rosterIds} selected={selected} onSelect={setSelected} />
        <Roster myId={myId} entries={entries} error={rosterError} enrollments={enrollments} onOpen={open} />
      </div>
    </div>
  )
}
