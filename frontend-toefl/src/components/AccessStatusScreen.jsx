import { signOut } from 'firebase/auth'
import { auth } from '../services/firebase'

const COPY = {
  expired: {
    title: 'Account expired',
    body: (id) => `Your TOEFL account (${id}) has reached the end of its access period.`,
  },
  inactive: {
    title: 'TOEFL access is not active',
    body: (id) => `Your account (${id}) does not currently have access to TOEFL Prep. It may not be enrolled yet, or its access may have been paused or ended.`,
  },
}

// Shown instead of the app when a signed-in student has no TOEFL access.
// Wording is deliberately neutral: it does not say whether an account was
// frozen, so a shared login gives nothing away.
export default function AccessStatusScreen({ status, b10Id }) {
  const copy = COPY[status]
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="bg-white rounded-2xl shadow p-8 max-w-sm w-full text-center">
        <p className="text-2xl mb-3" aria-hidden="true">🔒</p>
        <h1 className="text-lg font-bold mb-2" style={{ color: '#1e3a5f' }}>{copy.title}</h1>
        <p className="text-sm text-gray-600">{copy.body(b10Id || 'unknown')}</p>
        <p className="text-sm text-gray-600 mt-2">Please contact your instructor or the TOEFL administrator if you believe this is an error.</p>
        <button
          onClick={() => signOut(auth)}
          className="mt-6 w-full py-2 rounded-xl text-white font-semibold text-sm"
          style={{ backgroundColor: '#1e3a5f' }}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
