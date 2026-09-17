// src/lib/larComparison.js
// Turns one LAR utterance's comparer output into rows for a word-by-word
// display: "reference word / what you said", one row per word.
//
// Why token-by-token and not two paragraphs (JC 2026-09-17): the scored
// submission carries `referenceText` in its natural form ("The well-known
// scientist published her findings last year.") and `matchedTranscript` in the
// comparer's normalised form ("the well known scientist published her findings
// last year") — lower case, no punctuation, hyphens split. Shown as two
// paragraphs, a flawless repetition would still look different in three
// cosmetic ways. `diffResult` already holds the aligned token pairs the
// comparer actually scored, so a row-per-word view shows a perfect answer as
// every word matched, with nothing cosmetic to explain.
//
// The rows therefore use the scored (normalised) word forms. `referenceText`
// stays available for the prompt line above the rows, where its natural
// punctuation belongs.

export const MATCHED = 'matched'        // said as written
export const SUBSTITUTED = 'substituted' // a different word in its place
export const MISSING = 'missing'         // in the reference, not said
export const EXTRA = 'extra'             // said, not in the reference
export const MOVED = 'moved'             // right words, wrong order (one transposition)

const STATUS_BY_OP = {
  MATCH: MATCHED,
  SUB: SUBSTITUTED,
  DEL: MISSING,
  INS: EXTRA,
  TRANSPOSITION: MOVED,
}

/**
 * @param {object} entry one perUtteranceResults entry (data model v1.17)
 * @returns {{referenceText: string, rows: Array, counts: object, perfect: boolean}}
 *   rows: [{status, reference, spoken, referenceIndex, spokenIndex, startMs, endMs}]
 *         reference is null for EXTRA, spoken is null for MISSING.
 *   perfect: every row matched — the display has no difference to explain.
 */
export function buildLarComparison(entry) {
  const diffResult = Array.isArray(entry?.diffResult) ? entry.diffResult : []
  const rows = diffResult.map((d) => {
    const status = STATUS_BY_OP[d.op]
    if (!status) throw new Error(`unknown diff op: ${d.op}`)
    return {
      status,
      reference: d.target ?? null,
      spoken: d.hyp ?? null,
      referenceIndex: d.targetIndex ?? null,
      spokenIndex: d.hypIndex ?? null,
      startMs: d.hypStartMs ?? null,
      endMs: d.hypEndMs ?? null,
    }
  })
  const counts = { matched: 0, substituted: 0, missing: 0, extra: 0, moved: 0 }
  for (const r of rows) counts[r.status] += 1
  return {
    referenceText: entry?.referenceText ?? '',
    rows,
    counts,
    perfect: rows.length > 0 && rows.every((r) => r.status === MATCHED),
  }
}

/** One plain line for a student: what to work on, or nothing to fix. */
export function summariseLarComparison(comparison) {
  const { counts, perfect } = comparison
  if (perfect) return 'Repeated exactly.'
  const parts = []
  if (counts.missing) parts.push(`${counts.missing} word${counts.missing > 1 ? 's' : ''} missed`)
  if (counts.substituted) parts.push(`${counts.substituted} word${counts.substituted > 1 ? 's' : ''} changed`)
  if (counts.extra) parts.push(`${counts.extra} extra word${counts.extra > 1 ? 's' : ''}`)
  if (counts.moved) parts.push('words out of order')
  return parts.length ? `${parts.join(', ')}.` : 'Repeated with minor differences.'
}
