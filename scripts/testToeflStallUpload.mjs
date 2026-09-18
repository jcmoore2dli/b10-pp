// scripts/testToeflStallUpload.mjs
// frontend-toefl/src/lib/stallUpload.js against a fake UploadTask and a fake
// clock. No Firebase, no network.
import { uploadWithStallTimeout, UploadStalledError, UPLOAD_STALL_MS } from '../frontend-toefl/src/lib/stallUpload.js'

let passes = 0, failures = 0
const ok = (c, m) => { if (c) passes++; else { failures++; console.log('  FAIL:', m) } }
const tick = () => new Promise((r) => setImmediate(r))

function clock() {
  let now = 0, timers = [], id = 1
  return {
    setTimeout: (fn, ms) => { const t = { id: id++, at: now + ms, fn }; timers.push(t); return t.id },
    clearTimeout: (x) => { timers = timers.filter((t) => t.id !== x) },
    async advance(ms) {
      const target = now + ms
      for (;;) { timers.sort((a, b) => a.at - b.at); const t = timers[0]; if (!t || t.at > target) break; timers.shift(); now = t.at; t.fn(); await tick() }
      now = target; await tick()
    },
  }
}
function fakeTask(total = 1000) {
  const task = { cancelled: false, cancel() { this.cancelled = true }, on(_e, next, error, complete) { Object.assign(this, { next, error, complete }) } }
  task.progress = (b) => task.next({ bytesTransferred: b, totalBytes: total })
  return task
}
const settle = (p) => { const s = { v: 'pending' }; p.then(() => { s.v = 'resolved' }, (e) => { s.v = e }); return s }

console.log('1. completes: resolves, progress reported as a fraction')
{ const c = clock(), t = fakeTask(), seen = []
  const s = settle(uploadWithStallTimeout(() => t, { timers: c, onProgress: (f) => seen.push(f) }))
  t.progress(0); t.progress(500); t.progress(1000); t.complete(); await tick()
  ok(s.v === 'resolved', 'resolved'); ok(JSON.stringify(seen) === '[0,0.5,1]', `progress ${JSON.stringify(seen)}`) }

console.log('2. stalls: no bytes for stallMs -> UploadStalledError, task cancelled')
{ const c = clock(), t = fakeTask()
  const s = settle(uploadWithStallTimeout(() => t, { timers: c, stallMs: 60000 }))
  t.progress(100); await c.advance(59999)
  ok(s.v === 'pending', 'still pending at 59.999 s without progress')
  await c.advance(1); await tick()
  ok(s.v instanceof UploadStalledError && s.v.code === 'upload-stalled', `stalled error (got ${s.v})`)
  ok(t.cancelled, 'underlying task cancelled') }

console.log('3. slow but moving: never cut off, even well past stallMs in total')
{ const c = clock(), t = fakeTask(10000)
  const s = settle(uploadWithStallTimeout(() => t, { timers: c, stallMs: 60000 }))
  for (let b = 1000; b <= 10000; b += 1000) { await c.advance(50000); t.progress(b) }   // 500 s total, 50 s between chunks
  ok(s.v === 'pending', 'still pending after 500 s of slow progress')
  t.complete(); await tick()
  ok(s.v === 'resolved', 'resolved'); ok(!t.cancelled, 'never cancelled') }

console.log('4. a repeated snapshot with no new bytes does NOT reset the clock')
{ const c = clock(), t = fakeTask()
  const s = settle(uploadWithStallTimeout(() => t, { timers: c, stallMs: 60000 }))
  t.progress(200); await c.advance(30000); t.progress(200); await c.advance(30000); await tick()
  ok(s.v instanceof UploadStalledError, 'stalled despite a same-bytes snapshot') }

console.log('5. an upload error rejects with that error, and a late stall timer does nothing')
{ const c = clock(), t = fakeTask(), boom = Object.assign(new Error('x'), { code: 'storage/unauthorized' })
  const s = settle(uploadWithStallTimeout(() => t, { timers: c }))
  t.error(boom); await tick(); await c.advance(UPLOAD_STALL_MS * 2)
  ok(s.v === boom, 'rejected with the storage error'); ok(!t.cancelled, 'not cancelled after an error') }

console.log(`\n${passes} passed, ${failures} failed`)
console.log(failures ? 'STALL UPLOAD FAILED' : 'STALL UPLOAD PASSED — slow uploads survive, dead ones fail by name.')
process.exit(failures ? 1 : 0)
