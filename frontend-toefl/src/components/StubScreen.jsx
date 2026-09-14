import { Link } from 'react-router-dom'

// Shared placeholder shell for the scaffold's route stubs.
// Real screens replace these per their own scheduled build days.
export default function StubScreen({ title, route, note }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-md p-6">
        <p className="font-mono text-xs text-gray-400 mb-1">{route}</p>
        <h1 className="text-xl font-bold mb-3" style={{ color: '#1e3a5f' }}>{title}</h1>
        <p className="text-sm text-gray-600">{note}</p>
        <Link to="/" className="text-blue-600 underline text-xs mt-5 inline-block">← entry</Link>
      </div>
    </div>
  )
}
