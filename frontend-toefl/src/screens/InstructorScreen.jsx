import StubScreen from '../components/StubScreen'

// New TOEFL-specific screen inside frontend-toefl — NOT B10-PP's existing
// instructor dashboard, which lives in a different app bundle and knows
// nothing about toeflAttempts/toeflItems.
export default function InstructorScreen() {
  return (
    <StubScreen
      route="/instructor"
      title="Instructor view"
      note="Placeholder. Roster, attempt drill-down and flag queue are Week 3."
    />
  )
}
