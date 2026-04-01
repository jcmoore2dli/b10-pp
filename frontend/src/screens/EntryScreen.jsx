import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * Screen 1 — Entry Screen
 * Spec §3.2, §4.5
 *
 * Collects:
 *   - Access code (instructor-issued routing key)
 *   - Student name or ID
 *
 * Phase 1: No real access code validation — any non-empty code routes to
 * the passage menu with full passage library. Placeholder behavior only.
 */
export default function EntryScreen() {
  const navigate = useNavigate()
  const [accessCode, setAccessCode] = useState('')
  const [studentId, setStudentId] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    setError('')

    const code = accessCode.trim().toUpperCase()
    const name = studentId.trim()

    if (!code) {
      setError('Please enter your access code.')
      return
    }
    if (!name) {
      setError('Please enter your name or student ID.')
      return
    }

    // Phase 1: store in sessionStorage as placeholder; no real validation
    sessionStorage.setItem('b10pp_access_code', code)
    sessionStorage.setItem('b10pp_student_id', name)

    navigate('/passages')
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4 py-12">
      {/* Header */}
      <div className="text-center mb-10">
        <div
          className="inline-block px-3 py-1 rounded-full text-xs font-semibold tracking-widest mb-4"
          style={{ backgroundColor: '#1e3a5f', color: '#c8a84b' }}
        >
          DLIELC
        </div>
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

        <div className="flex flex-col gap-1">
          <label htmlFor="student-id" className="text-sm font-semibold text-gray-700">
            Name or Student ID
          </label>
          <input
            id="student-id"
            type="text"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            placeholder="e.g., Smith, John or 123456"
            autoComplete="name"
            className="border border-gray-300 rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {error && (
          <p role="alert" className="text-red-600 text-sm font-medium">
            {error}
          </p>
        )}

        <button
          type="submit"
          className="w-full py-3 rounded-xl text-white font-semibold text-base mt-1"
          style={{ backgroundColor: '#1e3a5f' }}
        >
          Begin
        </button>
      </form>

      <p className="mt-8 text-xs text-gray-400 text-center max-w-xs">
        No account or password required. Your access code is provided by your instructor.
      </p>
    </div>
  )
}
