import { useRef, useState, useEffect } from 'react'

/**
 * AudioPlayer — B10-PP passage audio player
 *
 * Spec §6.5:
 * - Play, Pause, Replay controls only
 * - No seek bar
 * - No playback speed control
 * - No autoplay
 * - Student must press Play deliberately
 */
export default function AudioPlayer({ audioSrc, onPlayStart, onEnded }) {
  const audioRef = useRef(null)
  const [state, setState] = useState('idle') // idle | playing | paused | ended | error
  const [hasPlayed, setHasPlayed] = useState(false)

  useEffect(() => {
    // Reset when audio source changes
    setState('idle')
    setHasPlayed(false)
  }, [audioSrc])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleEnded = () => {
      setState('ended')
      if (onEnded) onEnded()
    }
    const handleError = () => setState('error')
    const handlePause = () => {
      if (audio.ended) return
      setState('paused')
    }
    const handlePlay = () => setState('playing')

    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('error', handleError)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('play', handlePlay)

    return () => {
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('error', handleError)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('play', handlePlay)
    }
  }, [onEnded])

  function handlePlay() {
    const audio = audioRef.current
    if (!audio) return
    audio.play()
    if (!hasPlayed) {
      setHasPlayed(true)
      if (onPlayStart) onPlayStart()
    }
  }

  function handlePause() {
    audioRef.current?.pause()
  }

  function handleReplay() {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = 0
    audio.play()
    if (!hasPlayed) {
      setHasPlayed(true)
      if (onPlayStart) onPlayStart()
    }
  }

  const isPlaying = state === 'playing'
  const canReplay = hasPlayed || state === 'ended'

  return (
    <div className="flex flex-col items-center gap-4 p-6 bg-white rounded-xl shadow-sm border border-gray-200">
      {/* Hidden native audio element — no controls exposed */}
      <audio ref={audioRef} src={audioSrc} preload="metadata" />

      {/* Status indicator */}
      <div className="text-sm text-gray-500 h-5">
        {state === 'idle' && 'Press Play to listen'}
        {state === 'playing' && (
          <span className="flex items-center gap-1 text-green-700 font-medium">
            <span className="inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            Playing…
          </span>
        )}
        {state === 'paused' && 'Paused'}
        {state === 'ended' && 'Finished — you may replay or begin the task'}
        {state === 'error' && (
          <span className="text-red-600">Audio unavailable — check back later</span>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        {/* Play / Pause toggle */}
        {isPlaying ? (
          <button
            onClick={handlePause}
            className="flex items-center gap-2 px-6 py-3 bg-navy text-white rounded-lg font-semibold text-base"
            style={{ backgroundColor: '#1e3a5f' }}
            aria-label="Pause"
          >
            <PauseIcon />
            Pause
          </button>
        ) : (
          <button
            onClick={handlePlay}
            disabled={state === 'error'}
            className="flex items-center gap-2 px-6 py-3 text-white rounded-lg font-semibold text-base disabled:opacity-50"
            style={{ backgroundColor: '#1e3a5f' }}
            aria-label="Play"
          >
            <PlayIcon />
            Play
          </button>
        )}

        {/* Replay — always shown after first play */}
        <button
          onClick={handleReplay}
          disabled={!canReplay || state === 'error'}
          className="flex items-center gap-2 px-5 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium text-base disabled:opacity-30"
          aria-label="Replay from beginning"
        >
          <ReplayIcon />
          Replay
        </button>
      </div>
    </div>
  )
}

function PlayIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M5.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75A.75.75 0 007.25 3h-1.5zM12.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-1.5z" />
    </svg>
  )
}

function ReplayIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M7.793 2.232a.75.75 0 01-.025 1.06L6.053 5h2.947a7.5 7.5 0 110 15H6a.75.75 0 010-1.5h3a6 6 0 100-12H6.053l1.715 1.708a.75.75 0 11-1.036 1.084l-3-2.986a.75.75 0 010-1.084l3-2.986a.75.75 0 011.061.025z"
        clipRule="evenodd"
      />
    </svg>
  )
}
