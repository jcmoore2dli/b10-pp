import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

/**
 * Screen 1 — Entry Screen
 * Spec §3.2, §4.5
 *
 * Collects:
 *   - Access code (instructor-issued routing key)
 *
 * Phase 2A: b10Id comes from auth claims — student never types their own ID.
 * Access code stored in sessionStorage for passage routing.
 * Real access code validation deferred to Week 2 (enrollment flow).
 */
export default function EntryScreen({ onEnter }) {
  const { claims } = useAuth()
  const navigate = useNavigate()
  const [accessCode, setAccessCode] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(e) {
    if (e?.preventDefault) e.preventDefault()
    setError('')
    const code = accessCode.trim().toUpperCase()
    if (!code) {
      setError('Please enter your access code.')
      return
    }
    sessionStorage.setItem('b10pp_access_code', code)
    onEnter()
    navigate('/b10_practice_platform/passages')
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
            placeholder="e.g., ALPHA03"
            autoComplete="off"
            autoCapitalize="characters"
            className="border border-gray-300 rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
          className="w-full py-3 rounded-xl text-white font-semibold text-base mt-1"
          style={{ backgroundColor: '#1e3a5f' }}
        >
          Begin
        </button>
      </form>

      <p className="mt-8 text-xs text-gray-400 text-center max-w-xs">
        Your access code is provided by your instructor.
      </p>
    </div>
  )
}
