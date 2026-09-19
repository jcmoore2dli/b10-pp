import { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthProvider'
import { useAuth } from './context/useAuth'
import LoginScreen from './screens/LoginScreen'
import EntryScreen from './screens/EntryScreen'
import PassageMenuScreen from './screens/PassageMenuScreen'
import PassageDetailScreen from './screens/PassageDetailScreen'
import RecordingScreen from './screens/RecordingScreen'
import FeedbackScreen from './screens/FeedbackScreen'
import AdminScreen from './screens/AdminScreen'
import InstructorDashboardScreen from './screens/InstructorDashboardScreen'

function AppInner() {
  const { currentUser, claims } = useAuth()
  const [entered, setEntered] = useState(false)

  if (!currentUser) return <LoginScreen />

  const isInstructorOrAdmin = claims?.role === 'instructor' || claims?.role === 'admin'

  // Auto-expiry: students lose access 2 years after enrollment year
  // e.g. 26-xxx expires when current year becomes 28
  if (claims?.b10Id && claims?.role === 'student') {
    const enrollYear = parseInt('20' + claims.b10Id.slice(0, 2), 10)
    const currentYear = new Date().getFullYear()
    if (currentYear >= enrollYear + 2) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
          <div className="bg-white rounded-2xl shadow p-8 max-w-sm w-full text-center">
            <p className="text-2xl mb-3">🔒</p>
            <h2 className="text-lg font-bold text-gray-800 mb-2">Account Expired</h2>
            <p className="text-sm text-gray-500">Your B10-PP account ({claims.b10Id}) is no longer active. Please contact your instructor if you believe this is an error.</p>
          </div>
        </div>
      )
    }
  }

  return (
    <Routes>
      <Route path="/b10_practice_platform/" element={
        claims?.b10Id || entered
          ? <Navigate to="/b10_practice_platform/passages" replace />
          : <EntryScreen onEnter={() => setEntered(true)} />
      } />
      <Route path="/b10_practice_platform/passages" element={
        claims?.b10Id || entered
          ? <PassageMenuScreen />
          : <Navigate to="/b10_practice_platform/" replace />
      } />
      <Route path="/b10_practice_platform/passage/:passageId" element={<PassageDetailScreen />} />
      <Route path="/b10_practice_platform/record/:passageId" element={<RecordingScreen />} />
      <Route path="/b10_practice_platform/feedback/:passageId" element={<FeedbackScreen />} />
      <Route path="/b10_practice_platform/admin" element={
        claims?.role === 'admin'
          ? <AdminScreen />
          : <Navigate to="/b10_practice_platform/passages" replace />
      } />
      <Route path="/b10_practice_platform/instructor" element={
        isInstructorOrAdmin
          ? <InstructorDashboardScreen />
          : <Navigate to="/b10_practice_platform/passages" replace />
      } />
      <Route path="*" element={<Navigate to="/b10_practice_platform/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </BrowserRouter>
  )
}
