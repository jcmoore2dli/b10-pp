// Pure logic from frontend-toefl/src/lib, run under mocha as ES modules.
// No Firebase, no emulator: these functions only transform documents/claims.
//   npm run test:toefl-frontend
import assert from 'node:assert'
import { summarizeSubmission, enrollmentStatus, normalizeStudentId } from '../../frontend-toefl/src/lib/submissionSummary.js'
import { isToeflStaffClaims, isToeflIdExpired, toeflExpiryDate } from '../../frontend-toefl/src/lib/toeflAccess.js'

const ts = (iso) => ({ toDate: () => new Date(iso), toMillis: () => Date.parse(iso) })

describe('summarizeSubmission: one line per scoring shape', () => {
  it('unscored states', () => {
    assert.strictEqual(summarizeSubmission({ scoringStatus: 'queued' }), 'Queued for scoring')
    assert.strictEqual(summarizeSubmission({ scoringStatus: 'scoring' }), 'Scoring…')
    assert.strictEqual(summarizeSubmission({ scoringStatus: 'error' }), 'Scoring failed')
    assert.strictEqual(summarizeSubmission({}), 'Not scored')
    assert.strictEqual(summarizeSubmission(null), '—')
  })

  it('MCQ types: perQuestionResults', () => {
    const sub = { scoringStatus: 'scored', perQuestionResults: [{ isCorrect: true }, { isCorrect: false }, { isCorrect: true }] }
    assert.strictEqual(summarizeSubmission(sub), '2/3 correct')
  })

  it('CTW: perGapResults', () => {
    const gaps = Array.from({ length: 10 }, (_, i) => ({ isCorrect: i < 8 }))
    assert.strictEqual(summarizeSubmission({ scoringStatus: 'scored', perGapResults: gaps }), '8/10 gaps')
  })

  it('BAS: orderCorrect', () => {
    assert.strictEqual(summarizeSubmission({ scoringStatus: 'scored', orderCorrect: true }), 'Correct order')
    assert.strictEqual(summarizeSubmission({ scoringStatus: 'scored', orderCorrect: false }), 'Incorrect order')
  })

  it('EM/DISC: single layerA score, provisional flag', () => {
    assert.strictEqual(summarizeSubmission({ scoringStatus: 'scored', layerA: { score: 4 }, status: { provisional: true } }), 'Score 4/5 (provisional)')
    assert.strictEqual(summarizeSubmission({ scoringStatus: 'scored', layerA: { score: 0 } }), 'Score 0/5')
  })

  it('INT: per question, 0-based questionIndex, no average', () => {
    const sub = { scoringStatus: 'scored', layerA: [{ questionIndex: 0, score: 4 }, { questionIndex: 1, score: 0 }, { questionIndex: 2, score: 3 }] }
    assert.strictEqual(summarizeSubmission(sub), 'Q1 4 · Q2 0 · Q3 3')
  })

  it('LAR: per utterance bands, no average', () => {
    const sub = { scoringStatus: 'scored', perUtteranceResults: [{ layerA: { score: 4 } }, { layerA: { score: 3 } }, { layerA: { score: 2 } }] }
    assert.strictEqual(summarizeSubmission(sub), 'Bands 4, 3, 2')
  })
})

describe('enrollmentStatus', () => {
  const now = new Date('2027-06-01T00:00:00Z')
  it('Active / Frozen / Expired / Not enrolled', () => {
    assert.strictEqual(enrollmentStatus({ frozen: false, expiresAt: ts('2028-01-01T00:00:00Z') }, now), 'Active')
    assert.strictEqual(enrollmentStatus({}, now), 'Active') // 26-022-style legacy doc
    assert.strictEqual(enrollmentStatus({ frozen: true, expiresAt: ts('2028-01-01T00:00:00Z') }, now), 'Frozen')
    assert.strictEqual(enrollmentStatus({ expiresAt: ts('2027-01-01T00:00:00Z') }, now), 'Expired')
    assert.strictEqual(enrollmentStatus(undefined, now), 'Not enrolled')
  })
})

describe('normalizeStudentId', () => {
  it('trims, uppercases, drops spaces', () => {
    assert.strictEqual(normalizeStudentId('  t26 -001 '), 'T26-001')
    assert.strictEqual(normalizeStudentId(null), '')
  })
})

describe('isToeflStaffClaims: same cases as the rules and functions/lib/toeflStaff.js', () => {
  it('admins and T##-INS-# instructors only', () => {
    const yes = [{ role: 'admin' }, { role: 'instructor', b10Id: 'T26-INS-1' }, { role: 'instructor', b10Id: 'T27-INS-12' }]
    const no = [
      { role: 'instructor', b10Id: '26-INS-200' }, { role: 'instructor' }, { role: 'instructor', b10Id: 'T26-INS-X' },
      { role: 'instructor', b10Id: 'XT26-INS-1' }, { role: 'instructor', b10Id: 'T26-INS-1-2' },
      { role: 'student', b10Id: 'T26-INS-1' }, {}, null,
    ]
    for (const c of yes) assert.strictEqual(isToeflStaffClaims(c), true, JSON.stringify(c))
    for (const c of no) assert.strictEqual(isToeflStaffClaims(c), false, JSON.stringify(c))
  })
})

describe('toeflExpiryDate / isToeflIdExpired: same rule as the server (Jan 1 of ID year + 2)', () => {
  it('T26 expires 2028-01-01; B10-PP IDs have no ID-based expiry', () => {
    assert.strictEqual(toeflExpiryDate('T26-001').toISOString(), '2028-01-01T00:00:00.000Z')
    assert.strictEqual(toeflExpiryDate('26-022'), null)
    assert.strictEqual(isToeflIdExpired('T26-001', new Date('2027-12-31T23:59:59Z')), false)
    assert.strictEqual(isToeflIdExpired('T26-001', new Date('2028-01-01T00:00:00Z')), true)
    assert.strictEqual(isToeflIdExpired('26-022'), false)
  })
})
