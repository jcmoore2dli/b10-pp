"use strict";

// TOEFL staff, identical to isToeflStaff() in firebase/firestore.rules and
// firebase/storage.rules: admins, and instructors whose b10Id is a TOEFL
// instructor ID (T26-INS-1, T27-INS-4, ...). B10-PP instructors (26-INS-*)
// share the "instructor" role but are not TOEFL staff. Keep the pattern in
// step with the rules.
const TOEFL_INSTRUCTOR_ID_PATTERN = /^T[0-9]{2}-INS-[0-9]+$/;

function isToeflStaffToken(token) {
  if (!token) return false;
  if (token.role === "admin") return true;
  return token.role === "instructor" &&
    typeof token.b10Id === "string" && TOEFL_INSTRUCTOR_ID_PATTERN.test(token.b10Id);
}

module.exports = { TOEFL_INSTRUCTOR_ID_PATTERN, isToeflStaffToken };
