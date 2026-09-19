"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// TOEFL accounts: self-registration with a per-student TOEFL access code.
//
// Modelled on B10-PP's createStudentAccount (index.js) but fully separate: it
// reads and writes only toeflAccessCodes and toeflEnrollment, never B10-PP's
// accessCodes, students, users or rosters. TOEFL and B10-PP still share one
// Auth pool, so TOEFL IDs live in their own namespace (T26-001, T27-001, ...)
// and can never collide with a B10-PP login (26-001@b10pp.local).
//
// Differences from createStudentAccount, on purpose:
//   - The code is consumed (active: false, redeemedAt, redeemedUid) in the
//     same transaction that creates the enrollment document.
//   - Every code problem (unknown, inactive, already used, malformed) returns
//     the same error, so the callable cannot be used to probe which codes exist.
//   - If any step after the Auth account is created fails, the Auth account is
//     deleted again, so a failed sign-up never leaves an orphan login or burns
//     the code.
// ─────────────────────────────────────────────────────────────────────────────

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");

// T + two-digit year + three-digit number, e.g. T26-001.
const TOEFL_ID_PATTERN = /^T(\d{2})-(\d{3})$/;

// Accounts expire on January 1 of (enrollment year + 2): T26 on 2028-01-01.
const EXPIRY_YEARS = 2;

const CODE_UNAVAILABLE = "Invalid or unavailable access code.";

function normalizeCode(raw) {
  return String(raw).trim().toUpperCase().replace(/\s/g, "");
}

// Same transformation as frontend-toefl's LoginScreen toSyntheticEmail().
function toSyntheticEmail(id) {
  return id.toLowerCase().replace(/[^a-z0-9-]/g, "-") + "@b10pp.local";
}

function expiryFor(id) {
  const [, yy] = id.match(TOEFL_ID_PATTERN);
  const enrollYear = 2000 + parseInt(yy, 10);
  return Timestamp.fromDate(new Date(Date.UTC(enrollYear + EXPIRY_YEARS, 0, 1)));
}

// Public (no auth required): the caller has no account yet.
// Input: { accessCode: string, password: string }
// Returns: { success: true, b10Id: string }
exports.createToeflStudentAccount = onCall(async (request) => {
  const { accessCode, password } = request.data || {};
  if (typeof accessCode !== "string" || typeof password !== "string" || !accessCode || !password) {
    throw new HttpsError("invalid-argument", "accessCode and password are required.");
  }
  if (password.length < 6) {
    throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");
  }

  const code = normalizeCode(accessCode);
  if (!TOEFL_ID_PATTERN.test(code)) {
    throw new HttpsError("not-found", CODE_UNAVAILABLE);
  }

  const db = admin.firestore();
  const codeRef = db.collection("toeflAccessCodes").doc(code);
  const enrollmentRef = db.collection("toeflEnrollment").doc(code);

  // Cheap pre-check before creating anything. The transaction below re-checks,
  // so this is an optimisation, not the guard.
  const codeSnap = await codeRef.get();
  if (!codeSnap.exists || codeSnap.data().active !== true || codeSnap.data().redeemedAt) {
    throw new HttpsError("not-found", CODE_UNAVAILABLE);
  }

  // One code, one login: the ID is the code, so a second sign-up with the same
  // code fails here on the email even if it raced past the pre-check.
  let uid;
  try {
    const user = await admin.auth().createUser({ email: toSyntheticEmail(code), password });
    uid = user.uid;
  } catch (err) {
    if (err.code === "auth/email-already-exists") {
      throw new HttpsError("not-found", CODE_UNAVAILABLE);
    }
    if (err.code === "auth/invalid-password") {
      throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");
    }
    logger.error("createToeflStudentAccount: createUser failed", { code, error: err.message });
    throw new HttpsError("internal", "Account creation failed.");
  }

  try {
    await admin.auth().setCustomUserClaims(uid, { b10Id: code, role: "student" });

    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(codeRef);
      if (!fresh.exists || fresh.data().active !== true || fresh.data().redeemedAt) {
        throw new HttpsError("not-found", CODE_UNAVAILABLE);
      }
      const data = fresh.data();
      tx.update(codeRef, {
        active: false,
        redeemedAt: FieldValue.serverTimestamp(),
        redeemedUid: uid,
      });
      // create(), not set(): an existing enrollment for this ID aborts.
      tx.create(enrollmentRef, {
        b10Id: code,
        uid,
        accessCode: code,
        instructorUid: data.instructorUid || null,
        frozen: false,
        expiresAt: expiryFor(code),
        enrolledAt: FieldValue.serverTimestamp(),
        enrolledBy: "createToeflStudentAccount",
      });
    });
  } catch (err) {
    // Roll back the login so the failure leaves nothing behind.
    await admin.auth().deleteUser(uid).catch((delErr) =>
      logger.error("createToeflStudentAccount: rollback deleteUser failed", { code, uid, error: delErr.message }));
    if (err instanceof HttpsError) throw err;
    logger.error("createToeflStudentAccount: enrollment failed", { code, uid, error: err.message });
    throw new HttpsError("internal", "Account creation failed.");
  }

  logger.info("createToeflStudentAccount: complete", { uid, b10Id: code });
  return { success: true, b10Id: code };
});

// Exposed for tests.
exports._internal = { normalizeCode, toSyntheticEmail, expiryFor, TOEFL_ID_PATTERN };
