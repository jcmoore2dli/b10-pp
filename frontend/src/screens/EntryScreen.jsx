import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { useAuth } from '../context/useAuth'
import { functions } from '../services/firebase'

/**
 * Screen 1 — Entry Screen
 * Spec §3.2, §4.5
 *
 * Collects access code, calls enrollStudent Cloud Function.
 * On success: claims are set, onEnter() triggers route to passages.
 * b10Id always comes from claims — never from user input.
 */
export default function EntryScreen({ onEnter }) {
  const { refreshClaims } = useAuth()
  const navigate = useNavigate()
  const [accessCode, setAccessCode] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    if (e?.preventDefault) e.preventDefault()
    setError(null)

    const code = accessCode.trim().toUpperCase()
    if (!code) {
      setError('Please enter your access code.')
      return
    }

    setLoading(true)
    try {
      const enrollStudent = httpsCallable(functions, 'enrollStudent')
      const result = await enrollStudent({ accessCode: code })

      if (result.data.success) {
        // Force token refresh so new claims are available immediately
        await refreshClaims()
        sessionStorage.setItem('b10pp_access_code', code)
        onEnter()
        navigate('/b10_practice_platform/passages')
      }
    } catch (err) {
      const msg = err?.message || 'Enrollment failed. Please check your access code.'
      if (msg.includes('not-found')) {
        setError('Access code not found. Please check with your instructor.')
      } else if (msg.includes('no longer active')) {
        setError('This access code is no longer active.')
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4 py-12">
      {/* Header */}
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold mb-2" style={{ color: '#1e3a5f' }}>
          B10 Practice Platform
        </h1>
        <p className="text-gray-500 text-base">ILR 2→2+ Listening Practice</p>
      </div>

      {/* Entry form */}
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white rounded-2xl shadow-md p-8 flex flex-col gap-5"
        noValidate
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="access-code" className="text-sm font-semibold text-gray-700">
            Access Code
          </label>
          <input
            id="access-code"
            type="text"
            value={accessCode}
            onChange={(e) => setAccessCode(e.target.value)}
            placeholder="e.g., 26-001"
            autoComplete="off"
            autoCapitalize="characters"
            className="border border-gray-300 rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={loading}
          />
          <p className="text-xs text-gray-400">Provided by your instructor</p>
        </div>

        {error && (
          <p role="alert" className="text-red-600 text-sm font-medium">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading}
          className="w-full py-3 rounded-xl text-white font-semibold text-base mt-1"
          style={{ backgroundColor: loading ? '#7a9bbf' : '#1e3a5f' }}
        >
          {loading ? 'Enrolling…' : 'Begin'}
        </button>
      </form>

      <p className="mt-8 text-xs text-gray-400 text-center max-w-xs">
        Your access code is provided by your instructor.
      </p>
    </div>
  )
}
