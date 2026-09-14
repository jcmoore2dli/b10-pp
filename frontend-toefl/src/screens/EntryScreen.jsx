import { Link } from 'react-router-dom'
import { useAuth } from '../context/useAuth'

// Scaffold nav list — a click-through aid for verifying the route table,
// not the real entry UX. First-timer vs. returning branching lands here later.
const ROUTES = [
  { to: '/items', label: '/items' },
  { to: '/item/SAMPLE-ITEM-001', label: '/item/:itemId' },
  { to: '/results/SAMPLE-SUB-001', label: '/results/:submissionId' },
  { to: '/instructor', label: '/instructor (staff only)' },
  { to: '/admin', label: '/admin (admin only)' },
  { to: '/does-not-exist', label: 'catch-all → /' },
]

export default function EntryScreen() {
  const { currentUser, claims } = useAuth()

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4 py-12">
      <h1 className="text-2xl font-bold mb-6" style={{ color: '#1e3a5f' }}>
        TOEFL Prep
      </h1>
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-md p-6 text-sm">
        <p className="font-semibold text-gray-700 mb-3">Auth copy verification</p>
        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 font-mono text-xs">
          <dt className="text-gray-500">uid</dt>
          <dd>{currentUser?.uid ?? '—'}</dd>
          <dt className="text-gray-500">claims.role</dt>
          <dd>{claims?.role ?? <span className="text-red-600">undefined</span>}</dd>
          <dt className="text-gray-500">claims.b10Id</dt>
          <dd>{claims?.b10Id ?? <span className="text-red-600">undefined</span>}</dd>
        </dl>

        <p className="font-semibold text-gray-700 mt-6 mb-2">Route stubs</p>
        <ul className="flex flex-col gap-1">
          {ROUTES.map(({ to, label }) => (
            <li key={to}>
              <Link to={to} className="text-blue-600 underline font-mono text-xs">
                {label}
              </Link>
            </li>
          ))}
        </ul>

        <p className="text-gray-400 text-xs mt-4">
          Entry route placeholder — first-timer vs. returning branching lands here later.
        </p>
      </div>
    </div>
  )
}
