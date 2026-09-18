// scripts/testToeflWithTimeout.mjs
// frontend-toefl/src/lib/withTimeout.js with a fake clock. No Firebase.
import { withTimeout, StepTimeoutError, STEP_TIMEOUT_MS } from '../frontend-toefl/src/lib/withTimeout.js'

let passes = 0, failures = 0
const ok = (c, m) => { if (c) passes++; else { failures++; console.log('  FAIL:', m) } }
const tick = () => new Promise((r) => setImmediate(r))
function clock() {
  let now = 0, timers = [], id = 1
  return {
    active: () => timers.length,
    setTimeout: (fn, ms) => { const t = { id: id++, at: now + ms, fn }; timers.push(t); return t.id },
    clearTimeout: (x) => { timers = timers.filter((t) => t.id !== x) },
    async advance(ms) { const target = now + ms; for (;;) { timers.sort((a, b) => a.at - b.at); const t = timers[0]; if (!t || t.at > target) break; timers.shift(); now = t.at; t.fn(); await tick() } now = target; await tick() },
  }
}
const settle = (p) => { const s = { v: 'pending' }; p.then((x) => { s.v = { ok: x } }, (e) => { s.v = e }); return s }

console.log('1. a settling step passes its value through and clears its timer')
{ const c = clock(); const s = settle(withTimeout(Promise.resolve(42), 'Creating the submission', { timers: c })); await tick(); await tick()
  ok(s.v && s.v.ok === 42, 'value passed through'); ok(c.active() === 0, 'timer cleared') }

console.log('2. a step that never settles rejects at the limit, naming the step')
{ const c = clock(); const s = settle(withTimeout(new Promise(() => {}), 'Creating the submission', { timers: c, ms: 30000 }))
  await c.advance(29999); ok(s.v === 'pending', 'pending at 29.999 s')
  await c.advance(1); await tick()
  ok(s.v instanceof StepTimeoutError && s.v.code === 'step-timeout', 'StepTimeoutError')
  ok(s.v.message === 'Creating the submission got no response for 30 seconds', `message names the step: "${s.v.message}"`)
  ok(s.v.step === 'Creating the submission', 'step recorded') }

console.log('3. a failing step rejects with its own error, not a timeout')
{ const c = clock(), boom = new Error('permission-denied'); const s = settle(withTimeout(Promise.reject(boom), 'X', { timers: c })); await tick(); await tick()
  ok(s.v === boom, 'original error'); ok(c.active() === 0, 'timer cleared') }

console.log('4. default limit is 30 s')
ok(STEP_TIMEOUT_MS === 30000, 'STEP_TIMEOUT_MS 30000')

console.log(`\n${passes} passed, ${failures} failed`)
console.log(failures ? 'WITH TIMEOUT FAILED' : 'WITH TIMEOUT PASSED — hung steps fail by name, real errors pass through.')
process.exit(failures ? 1 : 0)
