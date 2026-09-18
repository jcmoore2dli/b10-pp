// src/lib/stallUpload.js
// Upload with a STALL timeout, not a total timeout.
//
// JC's iPhone test (2026-09-18): a 790 KB LAR recording took a minute or more
// to upload over a weak connection, and the screen showed "Saving…" with no
// sign of life. uploadBytes gives no progress and, on network failure, retries
// silently for up to 10 minutes before rejecting. So:
//
//   - progress is reported (the screen shows a percentage), and
//   - the upload fails only when NO bytes have moved for stallMs. A slow upload
//     that keeps moving is never cut off; a dead one surfaces as a named error
//     with Retry, instead of spinning for ten minutes.
//
// No Firebase import here, so this stays testable in Node: the caller passes
// startUpload, a function returning a Firebase UploadTask
// (() => uploadBytesResumable(ref, blob, metadata)).

export const UPLOAD_STALL_MS = 60000

export class UploadStalledError extends Error {
  constructor(stallMs) {
    super(`upload made no progress for ${Math.round(stallMs / 1000)} seconds`)
    this.name = 'UploadStalledError'
    this.code = 'upload-stalled'
  }
}

/**
 * @param {() => UploadTask} startUpload
 * @param {{ stallMs?: number, onProgress?: (fraction: number) => void, timers?: {setTimeout, clearTimeout} }} opts
 * @returns {Promise<void>} resolves when the upload completes
 */
export function uploadWithStallTimeout(startUpload, { stallMs = UPLOAD_STALL_MS, onProgress, timers } = {}) {
  const T = timers ?? { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: (id) => globalThis.clearTimeout(id) }
  return new Promise((resolve, reject) => {
    let settled = false
    let lastBytes = -1
    let timer = null
    const task = startUpload()

    const finish = (fn, arg) => {
      if (settled) return
      settled = true
      T.clearTimeout(timer)
      fn(arg)
    }
    const arm = () => {
      T.clearTimeout(timer)
      timer = T.setTimeout(() => {
        try { task.cancel() } catch { /* already finished */ }
        finish(reject, new UploadStalledError(stallMs))
      }, stallMs)
    }

    arm()
    task.on(
      'state_changed',
      (snap) => {
        if (snap.bytesTransferred > lastBytes) {
          lastBytes = snap.bytesTransferred
          arm()   // bytes moved: the clock starts over
          if (snap.totalBytes > 0) onProgress?.(snap.bytesTransferred / snap.totalBytes)
        }
      },
      (err) => finish(reject, err),
      () => finish(resolve)
    )
  })
}
