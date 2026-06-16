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
