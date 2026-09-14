import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthProvider'
import { useAuth } from './context/useAuth'
import LoginScreen from './screens/LoginScreen'
import EntryScreen from './screens/EntryScreen'
import ItemMenuScreen from './screens/ItemMenuScreen'
import ItemScreen from './screens/ItemScreen'
import ResultsScreen from './screens/ResultsScreen'
import InstructorScreen from './screens/InstructorScreen'
import AdminScreen from './screens/AdminScreen'

function AppInner() {
  const { currentUser, claims } = useAuth()

  // Same shape as B10-PP's App.jsx: login gate sits ahead of the router.
  if (!currentUser) return <LoginScreen />

  const isStaff = claims?.role === 'instructor' || claims?.role === 'admin'

  return (
    <Routes>
      <Route path="/" element={<EntryScreen />} />
      <Route path="/items" element={<ItemMenuScreen />} />
      <Route path="/item/:itemId" element={<ItemScreen />} />
      <Route path="/results/:submissionId" element={<ResultsScreen />} />
      <Route path="/instructor" element={
        isStaff ? <InstructorScreen /> : <Navigate to="/" replace />
      } />
      <Route path="/admin" element={
        claims?.role === 'admin' ? <AdminScreen /> : <Navigate to="/" replace />
      } />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter basename="/toefl">
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </BrowserRouter>
  )
}
