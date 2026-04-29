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

function AppInner() {
  const { currentUser } = useAuth()
  const [entered, setEntered] = useState(false)

  if (!currentUser) return <LoginScreen />

  return (
    <Routes>
      <Route path="/b10_practice_platform/" element={
        <EntryScreen onEnter={() => setEntered(true)} />
      } />
      <Route path="/b10_practice_platform/passages" element={
        entered ? <PassageMenuScreen /> : <Navigate to="/b10_practice_platform/" replace />
      } />
      <Route path="/b10_practice_platform/passage/:passageId" element={<PassageDetailScreen />} />
      <Route path="/b10_practice_platform/record/:passageId" element={<RecordingScreen />} />
      <Route path="/b10_practice_platform/feedback/:passageId" element={<FeedbackScreen />} />
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
