// TOEFL account expiry, derived from the ID the same way the server does
// (functions/toeflAccounts.js expiryFor): T26-xxx expires 2028-01-01 UTC.
// This only chooses which message to show. The rules enforce expiry from
// toeflEnrollment.expiresAt, and toeflExpirySweep disables the login.
const TOEFL_ID_PATTERN = /^T(\d{2})-(\d{3})$/
const EXPIRY_YEARS = 2

export function toeflExpiryDate(b10Id) {
  const m = TOEFL_ID_PATTERN.exec(b10Id || '')
  if (!m) return null
  return new Date(Date.UTC(2000 + parseInt(m[1], 10) + EXPIRY_YEARS, 0, 1))
}

export function isToeflIdExpired(b10Id, now = new Date()) {
  const expiry = toeflExpiryDate(b10Id)
  return expiry !== null && now >= expiry
}

// TOEFL staff, mirroring isToeflStaff() in firebase/firestore.rules and
// functions/lib/toeflStaff.js: admins, and instructors whose ID is a TOEFL
// instructor ID (T26-INS-1). B10-PP instructors (26-INS-*) share the
// "instructor" role but are not TOEFL staff, so the app treats them like any
// other account without TOEFL access.
const TOEFL_INSTRUCTOR_ID_PATTERN = /^T[0-9]{2}-INS-[0-9]+$/

export function isToeflStaffClaims(claims) {
  if (!claims) return false
  if (claims.role === 'admin') return true
  return claims.role === 'instructor' && TOEFL_INSTRUCTOR_ID_PATTERN.test(claims.b10Id || '')
}
