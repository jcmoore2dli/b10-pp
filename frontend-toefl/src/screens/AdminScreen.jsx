import StubScreen from '../components/StubScreen'

// New TOEFL-specific screen inside frontend-toefl, following B10-PP's admin
// screen as a UX reference only — not a shared file.
export default function AdminScreen() {
  return (
    <StubScreen
      route="/admin"
      title="Admin view"
      note="Placeholder."
    />
  )
}
