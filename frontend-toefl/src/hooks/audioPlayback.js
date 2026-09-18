// src/hooks/audioPlayback.js
// Playback and mic-check hooks for the spoken-response screens
// (InterviewRecorder, LarRecorder). The components that use them are in
// components/recorderUi.jsx; hooks live here so that file exports components
// only (React fast refresh).
//
// Two browser rules shape this file:
//   - iOS Safari plays audio only in response to a tap. unlock() must be
//     called inside a tap; it creates ONE <audio> element and ONE AudioContext,
//     which are then reused for every clip and tone, so later programmatic
//     plays are allowed.
//   - Chrome keeps an AudioContext created outside a tap suspended, so the mic
//     level meter would read zero forever. The meter therefore starts from the
//     "Test my microphone" tap, which also calls unlock().

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const LEVEL_THRESHOLD = 0.04   // RMS the meter must reach once ("say a few words")
const TONE_MS = 150

export function useAudioPlayer() {
  const elRef = useRef(null)
  const ctxRef = useRef(null)

  // Call inside a tap.
  const unlock = useCallback(() => {
    if (!elRef.current) elRef.current = new Audio()
    if (!ctxRef.current) ctxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    ctxRef.current.resume?.()
  }, [])

  // Plays one clip on the shared element; resolves when it ends. play() is
  // called synchronously, so the call can be made inside a tap.
  const play = useCallback((url) => {
    const el = elRef.current
    return new Promise((resolve, reject) => {
      el.onended = () => resolve()
      el.onerror = () => reject(new Error('audio playback failed'))
      el.src = url
      el.play().catch(reject)
    })
  }, [])

  // Stops the current clip. Its play() promise then never settles, so callers
  // that stop playback must not be awaiting it.
  const stop = useCallback(() => {
    const el = elRef.current
    if (!el) return
    el.onended = null; el.onerror = null
    el.pause()
  }, [])

  // A short tone; resolves once it has finished, so it is never in a recording
  // started afterwards.
  const tone = useCallback(async () => {
    const ctx = ctxRef.current
    if (!ctx) return
    const osc = ctx.createOscillator(), gain = ctx.createGain()
    osc.frequency.value = 880
    gain.gain.value = 0.15
    osc.connect(gain).connect(ctx.destination)
    osc.start(); osc.stop(ctx.currentTime + TONE_MS / 1000)
    await new Promise((r) => setTimeout(r, TONE_MS))
  }, [])

  useEffect(() => () => {
    elRef.current?.pause()
    ctxRef.current?.close?.()
  }, [])

  // One stable object: useMicCheck's effect depends on it, and a new object
  // per render would restart the mic check on every render.
  return useMemo(() => ({ unlock, play, stop, tone, ctxRef }), [unlock, play, stop, tone])
}

// Live level meter for the pre-flight check. Runs only while `active` and
// only after startTest() (a tap).
export function useMicCheck(player, active) {
  const [testing, setTesting] = useState(false)
  const [level, setLevel] = useState(0)
  const [heard, setHeard] = useState(false)
  const [error, setError] = useState(null)

  const startTest = useCallback(() => {
    player.unlock()
    setError(null)
    setTesting(true)
  }, [player])

  useEffect(() => {
    if (!active || !testing) return
    let stream = null, raf = null, stopped = false
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return }
        const ctx = player.ctxRef.current
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 1024
        ctx.createMediaStreamSource(stream).connect(analyser)
        const buf = new Float32Array(analyser.fftSize)
        const loop = () => {
          analyser.getFloatTimeDomainData(buf)
          const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length)
          setLevel(rms)
          if (rms > LEVEL_THRESHOLD) setHeard(true)
          raf = requestAnimationFrame(loop)
        }
        loop()
      } catch (err) {
        if (!stopped) setError(err?.name === 'NotAllowedError'
          ? 'Microphone access was denied. Please allow microphone access and reload the page.'
          : 'Could not access your microphone. Please check it and reload the page.')
      }
    })()
    return () => {
      stopped = true
      if (raf) cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [active, testing, player])

  return { testing, level, heard, error, startTest }
}
