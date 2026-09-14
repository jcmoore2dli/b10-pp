// src/lib/shuffle.js
// Fisher–Yates option shuffle for MCQ delivery.
//
// Data model v1.15, "Answer-key and permutation":
//   · the shuffle operates on optionIds, never on source array position
//   · questions[n].locked === true skips the shuffle entirely
//   · one base seed per attempt; each question's order derives from
//     `seed:questionIndex`, so the whole delivery is reconstructable from
//     the single optionShuffleSeed stored on toeflAttempts (v1.15 makes
//     this derivation explicit, not just an implementation choice)

export const DISPLAY_LABELS = ['A', 'B', 'C', 'D']

// Returns: string, always exactly 8 chars.
// crypto.randomUUID() over Math.random().toString(36) deliberately: the latter
// can yield a 1-char seed (Math.random() === 0.5 → "0.i") or, vanishingly but
// silently, an empty one. The seed is the forensic record used to reconstruct a
// flagged delivery, so it may as well be sound.
export function makeShuffleSeed() {
  return crypto.randomUUID().slice(0, 8)
}

// mulberry32 — small deterministic PRNG. Same seed, same sequence, any browser.
// Takes: number (32-bit int). Returns: () => float in [0, 1)
function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// FNV-1a. Takes: string. Returns: number (uint32).
// Requires a string — uses .length and .charCodeAt().
function hashSeed(seed) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// Takes: (array, string). Returns: new array, same length.
// Module-private — buildDisplayOrder is the only caller, which is what
// guarantees hashSeed() always receives a string (see the template literal
// below).
function seededShuffle(values, seed) {
  const rand = mulberry32(hashSeed(seed))
  const out = [...values]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// The only function callers should use.
// Takes: (question object, string seed). Returns: array of optionId strings.
//
// locked is tested FIRST and short-circuits before any shuffling happens.
// Getting this backwards scrambles an R6 sentence-insertion item into
// nonsense, so the ordering of these two lines is load-bearing.
//
// Note: a question with no `locked` field gets shuffled, per the spec's stated
// default of false (v1.15 line 78). That is the less safe direction — an item
// that should be locked but lost the field scrambles silently — but it is what
// the spec says, so it is what this does.
export function buildDisplayOrder(question, seed) {
  const optionIds = question.options.map((o) => o.optionId)
  if (question.locked === true) return optionIds // stored order, untouched
  return seededShuffle(optionIds, `${seed}:${question.questionIndex}`)
}

// Convenience for callers that hold a v1.15 displayOrder array.
// Takes: (displayOrder array, number). Returns: array of optionId strings.
export function orderForQuestion(displayOrder, questionIndex) {
  const entry = displayOrder?.find((d) => d.questionIndex === questionIndex)
  return entry?.order ?? []
}
