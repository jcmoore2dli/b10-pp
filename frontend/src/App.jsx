import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import EntryScreen from './screens/EntryScreen'
import PassageMenuScreen from './screens/PassageMenuScreen'
import PassageDetailScreen from './screens/PassageDetailScreen'
import RecordingScreen from './screens/RecordingScreen'
import FeedbackScreen from './screens/FeedbackScreen'

/**
 * B10 Practice Platform — App Router
 *
 * Route structure:
 *   /                       → Entry Screen (access code + student ID)
 *   /passages               → Passage Menu (assigned set + browse library)
 *   /passage/:passageId     → Passage Detail (audio player + Begin Task)
 *   /record/:passageId      → Recording Screen (stub in Phase 1)
 *   /feedback/:passageId    → Feedback Screen (stub in Phase 1)
 *
 * Base path: /b10_practice_platform/ (GitHub Pages deployment)
 */
export default function App() {
  return (
    <BrowserRouter basename="/b10_practice_platform">
      <Routes>
        <Route path="/" element={<EntryScreen />} />
        <Route path="/passages" element={<PassageMenuScreen />} />
        <Route path="/passage/:passageId" element={<PassageDetailScreen />} />
        <Route path="/record/:passageId" element={<RecordingScreen />} />
        <Route path="/feedback/:passageId" element={<FeedbackScreen />} />
        {/* Catch-all → entry */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
