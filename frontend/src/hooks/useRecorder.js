import { useState, useRef } from 'react'

/**
 * useRecorder — Web Audio API / MediaRecorder hook
 *
 * Exposes:
 *   isRecording     {boolean}        — true while MediaRecorder is active
 *   startRecording()                 — requests mic permission, starts MediaRecorder
 *                                      returns { success: boolean, error: string|null }
 *   stopRecording()                  — stops MediaRecorder, returns Promise<Blob>
 *   error           {string|null}    — last permission or recording error
 */
export function useRecorder() {
  const [isRecording, setIsRecording] = useState(false)
  const [error, setError] = useState(null)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])

  async function startRecording() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // Negotiate best supported format — mp4 for iOS Safari, webm for Chrome
      const mimeType =
        MediaRecorder.isTypeSupported('audio/mp4;codecs=mp4a.40.2') ? 'audio/mp4;codecs=mp4a.40.2' :
        MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' :
        MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' :
        MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' :
        ''
      const mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mediaRecorder.start()
      setIsRecording(true)
      return { success: true, error: null }
    } catch (err) {
      const message =
        err.name === 'NotAllowedError'
          ? 'Microphone access was denied. Please allow microphone access and try again.'
          : 'Could not start recording. Please check your microphone and try again.'
      setError(message)
      return { success: false, error: message }
    }
  }

  function stopRecording() {
    return new Promise((resolve) => {
      const mediaRecorder = mediaRecorderRef.current
      if (!mediaRecorder) {
        resolve(null)
        return
      }

      mediaRecorder.onstop = () => {
        const rawMime = mediaRecorder.mimeType || 'audio/webm'
      const baseType = rawMime.split(';')[0]
      const blob = new Blob(chunksRef.current, { type: baseType })
        // Release mic tracks
        mediaRecorder.stream.getTracks().forEach((t) => t.stop())
        mediaRecorderRef.current = null
        chunksRef.current = []
        setIsRecording(false)
        resolve(blob)
      }

      mediaRecorder.stop()
    })
  }

  return { isRecording, startRecording, stopRecording, error }
}
