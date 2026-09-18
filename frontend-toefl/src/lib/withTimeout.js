// src/lib/withTimeout.js
// Bound a single network step, and name it in the error.
//
// Firestore writes resolve only when the server acknowledges them. On a dead
// connection a write is queued locally and its promise simply never settles,
// so an unbounded await leaves the screen on "Submitting…" forever. This turns
// that into an error the screen can show, naming the step.
//
// It does NOT cancel the underlying operation (Firestore offers no way to):
// a queued write may still land later. Callers must be safe to retry — the
// submit paths are, because they look for an existing submission for the
// attempt first, and Firestore's local cache includes pending writes.

export const STEP_TIMEOUT_MS = 30000

export class StepTimeoutError extends Error {
  constructor(step, ms) {
    super(`${step} got no response for ${Math.round(ms / 1000)} seconds`)
    this.name = 'StepTimeoutError'
    this.code = 'step-timeout'
    this.step = step
  }
}

export function withTimeout(promise, step, { ms = STEP_TIMEOUT_MS, timers } = {}) {
  const T = timers ?? { setTimeout: (fn, t) => globalThis.setTimeout(fn, t), clearTimeout: (id) => globalThis.clearTimeout(id) }
  let timer
  const timeout = new Promise((_, reject) => {
    timer = T.setTimeout(() => reject(new StepTimeoutError(step, ms)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => T.clearTimeout(timer))
}
