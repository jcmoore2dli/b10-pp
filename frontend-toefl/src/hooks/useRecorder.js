// src/hooks/useRecorder.js
// React wrapper around lib/recorder.js. Everything that matters is there; this
// file only keeps one recorder per mounted screen, mirrors its state for
// rendering, and disposes of it on unmount, which releases the microphone even
// if the student navigates away mid-recording.
//
// const rec = useRecorder({ maxDurationMs: 45000, minDurationMs: 1000, onAutoStop })
//   rec.state            'idle' | 'starting' | 'recording' | 'paused' | 'stopping'
//   rec.isRecording      true while 'recording' or 'paused'
//   rec.error            last start error, as a student-facing message
//   rec.hasRecording     a finished recording is kept (upload it, then discard)
//   await rec.start()    -> { success, error }
//   rec.pause() / rec.resume()   -> boolean (false if not possible right now)
//   await rec.stop()     -> { blob, mimeType, durationMs, sizeBytes, empty, tooShort } | null
//   rec.getRecordedMs()  recorded time so far, paused stretches excluded
//   rec.getRecording()   the kept recording, for an upload retry
//   rec.discard()        drop the kept recording after a successful upload
//
// maxDurationMs: null means no auto-stop. onAutoStop(result) fires when the cap
// ends the recording; a Stop tap racing it gets the same result.

import { useEffect, useRef, useState } from 'react'
import { createRecorder } from '../lib/recorder'

export function useRecorder({ maxDurationMs = 45000, minDurationMs = 1000, onAutoStop } = {}) {
  const [snap, setSnap] = useState({ state: 'idle', error: null, hasRecording: false })
  const onAutoStopRef = useRef(onAutoStop)
  onAutoStopRef.current = onAutoStop   // always call the latest callback

  const recRef = useRef(null)
  if (recRef.current === null) {
    recRef.current = createRecorder({
      maxDurationMs,
      minDurationMs,
      onAutoStop: (result) => onAutoStopRef.current?.(result),
      onChange: setSnap,
    })
  }
  const rec = recRef.current

  useEffect(() => () => rec.dispose(), [rec])

  return {
    ...snap,
    isRecording: snap.state === 'recording' || snap.state === 'paused',
    start: rec.start,
    pause: rec.pause,
    resume: rec.resume,
    stop: rec.stop,
    discard: rec.discard,
    getRecordedMs: rec.getRecordedMs,
    getRecording: rec.getRecording,
    isSupported: rec.isSupported,
    pauseSupported: rec.pauseSupported,
  }
}
