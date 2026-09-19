// One-line summaries of a toeflSubmissions document for the instructor
// lookup. Reads exactly what functions/toeflScoring.js writes per task type,
// and never invents an aggregate where the scoring specs forbid one: INT and
// LAR show per-question / per-utterance scores, no average.
//
//   AP AT LTC RDL LCR LTA  perQuestionResults[].isCorrect  "3/5 correct"
//   CTW                    perGapResults[].isCorrect       "8/10 gaps"
//   BAS                    orderCorrect                    "Correct order"
//   EM DISC                layerA.score (0-5)              "Score 4/5 (provisional)"
//   INT                    layerA[] per question           "Q1 4 · Q2 3"
//   LAR                    perUtteranceResults[].layerA    "Bands 4, 3, 2"

const STATUS_LABELS = {
  queued: 'Queued for scoring',
  scoring: 'Scoring…',
  error: 'Scoring failed',
}

function countCorrect(rows) {
  return rows.filter((r) => r && r.isCorrect === true).length
}

export function summarizeSubmission(sub) {
  if (!sub) return '—'
  const status = sub.scoringStatus
  if (status !== 'scored') return STATUS_LABELS[status] || 'Not scored'

  if (Array.isArray(sub.perQuestionResults)) {
    return `${countCorrect(sub.perQuestionResults)}/${sub.perQuestionResults.length} correct`
  }
  if (Array.isArray(sub.perGapResults)) {
    return `${countCorrect(sub.perGapResults)}/${sub.perGapResults.length} gaps`
  }
  if (typeof sub.orderCorrect === 'boolean') {
    return sub.orderCorrect ? 'Correct order' : 'Incorrect order'
  }
  if (Array.isArray(sub.perUtteranceResults)) {
    const bands = sub.perUtteranceResults.map((u) => u?.layerA?.score ?? '?')
    return `Bands ${bands.join(', ')}`
  }
  if (Array.isArray(sub.layerA)) {
    return sub.layerA.map((a, i) => `Q${(a?.questionIndex ?? i) + 1} ${a?.score ?? '?'}`).join(' · ')
  }
  if (sub.layerA && typeof sub.layerA.score === 'number') {
    const provisional = sub.status?.provisional ? ' (provisional)' : ''
    return `Score ${sub.layerA.score}/5${provisional}`
  }
  return 'Scored'
}

// "Active" | "Frozen" | "Expired" for a toeflEnrollment document.
export function enrollmentStatus(e, now = new Date()) {
  if (!e) return 'Not enrolled'
  if (e.frozen) return 'Frozen'
  const exp = e.expiresAt && typeof e.expiresAt.toDate === 'function' ? e.expiresAt.toDate() : null
  if (exp && exp <= now) return 'Expired'
  return 'Active'
}

export function normalizeStudentId(raw) {
  return String(raw || '').trim().toUpperCase().replace(/\s/g, '')
}
