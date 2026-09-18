// src/components/recorderUi.jsx
// Shared components for the spoken-response screens (InterviewRecorder,
// LarRecorder): the mic pre-flight check and layout. The playback and
// mic-check hooks are in hooks/audioPlayback.js.

export function MicCheck({ check }) {
  if (!check.testing) {
    return <div className="mb-4"><Button onClick={check.startTest}>Test my microphone</Button></div>
  }
  return (
    <>
      <p className="text-sm font-semibold mb-2">Microphone check — say a few words.</p>
      <LevelMeter level={check.level} />
      <p className="text-xs text-gray-500 mt-2 mb-4">
        {check.heard ? 'Your microphone is working.' : 'Waiting to hear you…'}
      </p>
      {check.error && <p className="text-red-600 text-sm mb-3">{check.error}</p>}
    </>
  )
}

export function LevelMeter({ level }) {
  const pct = Math.min(100, Math.round((level / 0.2) * 100))
  return (
    <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden" aria-label="microphone level">
      <div className="h-full bg-green-500 transition-[width] duration-75" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Center({ big, small }) {
  return (
    <div className="text-center py-10">
      <p className="text-xl font-semibold">{big}</p>
      {small && <p className="text-sm text-gray-500 mt-2">{small}</p>}
    </div>
  )
}

export function Button({ onClick, disabled, danger, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full py-3 rounded-lg text-white text-sm font-semibold disabled:opacity-40 ${danger ? 'bg-red-600' : ''}`}
      style={danger ? undefined : { backgroundColor: '#1e3a5f' }}
    >
      {children}
    </button>
  )
}

export function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="w-full max-w-2xl mx-auto bg-white rounded-2xl shadow-md p-6">{children}</div>
    </div>
  )
}
