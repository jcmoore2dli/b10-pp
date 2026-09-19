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
//   - Failed code attempts are rate-limited per IP and globally (see below);
//     the 1,000-code yearly space is small enough to be worth guarding.
// ─────────────────────────────────────────────────────────────────────────────

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const crypto = require("crypto");

// T + two-digit year + three-digit number, e.g. T26-001.
const TOEFL_ID_PATTERN = /^T(\d{2})-(\d{3})$/;

// Accounts expire on January 1 of (enrollment year + 2): T26 on 2028-01-01.
const EXPIRY_YEARS = 2;

const CODE_UNAVAILABLE = "Invalid or unavailable access code.";
const TOO_MANY = "Too many attempts. Please try again later.";

// Failed-code throttle. Only FAILED code attempts count, so a whole class
// registering from one shared classroom IP is never slowed down; only wrong,
// used or inactive codes do. Two caps per clock hour: per IP (hashed, never
// stored raw), and across all IPs, which is what stops a guesser who rotates
// addresses. Counters live in toeflSignupThrottle (no client access: no match
// block in firestore.rules); the daily expiry sweep deletes old ones.
const FAILS_PER_IP_PER_HOUR = 10;
const FAILS_GLOBAL_PER_HOUR = 30;
const THROTTLE = "toeflSignupThrottle";

// Overridable clock, for tests only.
let now = () => new Date();

function hourKey(d) {
  return d.toISOString().slice(0, 13).replace(/[-T]/g, ""); // e.g. 2026091914
}

function clientIp(rawRequest) {
  const fwd = rawRequest && rawRequest.headers && rawRequest.headers["x-forwarded-for"];
  const ip = (rawRequest && rawRequest.ip) || (fwd && String(fwd).split(",")[0].trim());
  return ip || "unknown";
}

function throttleRefs(db, rawRequest) {
  const hour = hourKey(now());
  const ipHash = crypto.createHash("sha256").update(clientIp(rawRequest)).digest("hex").slice(0, 32);
  return {
    ip: db.collection(THROTTLE).doc(`ip_${ipHash}_${hour}`),
    global: db.collection(THROTTLE).doc(`global_${hour}`),
  };
}

async function assertNotThrottled(refs) {
  const [ipSnap, globalSnap] = await Promise.all([refs.ip.get(), refs.global.get()]);
  const ipFails = ipSnap.exists ? ipSnap.data().fails || 0 : 0;
  const globalFails = globalSnap.exists ? globalSnap.data().fails || 0 : 0;
  if (ipFails >= FAILS_PER_IP_PER_HOUR || globalFails >= FAILS_GLOBAL_PER_HOUR) {
    logger.warn("createToeflStudentAccount: throttled", { ipFails, globalFails });
    throw new HttpsError("resource-exhausted", TOO_MANY);
  }
}

async function recordFailure(refs) {
  const bump = { fails: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() };
  await Promise.all([refs.ip.set(bump, { merge: true }), refs.global.set(bump, { merge: true })])
    .catch((err) => logger.error("createToeflStudentAccount: throttle write failed", { error: err.message }));
}

// Builds the uniform code error (callers throw it), after counting the
// failure against the throttle.
async function codeUnavailable(refs) {
  await recordFailure(refs);
  return new HttpsError("not-found", CODE_UNAVAILABLE);
}

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

  const db = admin.firestore();
  const refs = throttleRefs(db, request.rawRequest);
  await assertNotThrottled(refs);

  const code = normalizeCode(accessCode);
  if (!TOEFL_ID_PATTERN.test(code)) {
    throw await codeUnavailable(refs);
  }

  const codeRef = db.collection("toeflAccessCodes").doc(code);
  const enrollmentRef = db.collection("toeflEnrollment").doc(code);

  // Cheap pre-check before creating anything. The transaction below re-checks,
  // so this is an optimisation, not the guard.
  const codeSnap = await codeRef.get();
  if (!codeSnap.exists || codeSnap.data().active !== true || codeSnap.data().redeemedAt) {
    throw await codeUnavailable(refs);
  }

  // One code, one login: the ID is the code, so a second sign-up with the same
  // code fails here on the email even if it raced past the pre-check.
  let uid;
  try {
    const user = await admin.auth().createUser({ email: toSyntheticEmail(code), password });
    uid = user.uid;
  } catch (err) {
    if (err.code === "auth/email-already-exists") {
      throw await codeUnavailable(refs);
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
        instructorId: data.instructorId || null,
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
    if (err instanceof HttpsError && err.code === "not-found") throw await codeUnavailable(refs);
    if (err instanceof HttpsError) throw err;
    logger.error("createToeflStudentAccount: enrollment failed", { code, uid, error: err.message });
    throw new HttpsError("internal", "Account creation failed.");
  }

  logger.info("createToeflStudentAccount: complete", { uid, b10Id: code });
  return { success: true, b10Id: code };
});

// ─────────────────────────────────────────────────────────────────────────────
// Login control for T accounts, shared by freeze and the expiry sweep.
//
// Only T accounts (TOEFL-only logins) are ever disabled in Auth. A B10-PP
// student who is also TOEFL-enrolled (e.g. 26-022) keeps their login: for
// them, freezing and expiry act only through the enrollment document, which
// the rules already enforce, so their B10-PP access is never touched.
// Disabling blocks new sign-ins; revoking refresh tokens stops an open
// session from renewing (the current ID token lapses within the hour, and
// the rules refuse TOEFL data meanwhile).
// ─────────────────────────────────────────────────────────────────────────────
function isToeflOnlyAccount(b10Id) {
  return TOEFL_ID_PATTERN.test(b10Id);
}

async function uidFor(b10Id, enrollment) {
  if (enrollment.uid) return enrollment.uid;
  const user = await admin.auth().getUserByEmail(toSyntheticEmail(b10Id));
  return user.uid;
}

async function disableLogin(uid) {
  await admin.auth().updateUser(uid, { disabled: true });
  await admin.auth().revokeRefreshTokens(uid);
}

function isExpired(enrollment, at) {
  return Boolean(enrollment.expiresAt) && enrollment.expiresAt.toMillis() <= at.getTime();
}

// Admin only. Input: { b10Id: string, frozen: boolean }
// Returns: { success: true, b10Id, frozen, loginDisabled }
exports.setToeflFreeze = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  if (request.auth.token.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin role required.");
  }
  const { b10Id, frozen } = request.data || {};
  if (typeof b10Id !== "string" || !b10Id || typeof frozen !== "boolean") {
    throw new HttpsError("invalid-argument", "b10Id (string) and frozen (boolean) are required.");
  }

  const ref = admin.firestore().collection("toeflEnrollment").doc(b10Id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", `No TOEFL enrollment for ${b10Id}.`);
  const enrollment = snap.data();
  const by = request.auth.token.b10Id || request.auth.uid;

  // The document first: the rules enforce it on the very next request, so a
  // freeze takes effect even if the Auth step below fails.
  await ref.update(frozen
    ? { frozen: true, frozenAt: FieldValue.serverTimestamp(), frozenBy: by }
    : { frozen: false, unfrozenAt: FieldValue.serverTimestamp(), unfrozenBy: by });

  let loginDisabled = false;
  if (isToeflOnlyAccount(b10Id)) {
    try {
      const uid = await uidFor(b10Id, enrollment);
      if (frozen) {
        await disableLogin(uid);
        loginDisabled = true;
      } else if (isExpired(enrollment, now())) {
        // Unfreezing never revives an expired account's login.
        loginDisabled = true;
      } else {
        await admin.auth().updateUser(uid, { disabled: false });
      }
    } catch (err) {
      logger.error("setToeflFreeze: login update failed", { b10Id, frozen, error: err.message });
      throw new HttpsError("internal",
        `Enrollment ${frozen ? "frozen" : "unfrozen"}, but the login could not be updated. Try again.`);
    }
  }

  logger.info("setToeflFreeze", { b10Id, frozen, loginDisabled, by });
  return { success: true, b10Id, frozen, loginDisabled };
});

// Daily: disable the logins of T accounts past expiresAt, and delete signup
// throttle counters older than two days. The rules already refuse expired
// students all TOEFL data; this closes the remaining door (signing in at all).
async function runExpirySweep(at) {
  const db = admin.firestore();
  let disabled = 0;
  const expired = await db.collection("toeflEnrollment")
    .where("expiresAt", "<=", Timestamp.fromDate(at)).get();
  for (const doc of expired.docs) {
    const e = doc.data();
    if (!isToeflOnlyAccount(doc.id) || e.expiryLoginDisabledAt) continue;
    try {
      await disableLogin(await uidFor(doc.id, e));
      await doc.ref.update({ expiryLoginDisabledAt: FieldValue.serverTimestamp() });
      disabled++;
    } catch (err) {
      // Left unmarked, so tomorrow's run retries it.
      logger.error("toeflExpirySweep: disable failed", { b10Id: doc.id, error: err.message });
    }
  }

  const cutoff = new Date(at.getTime() - 2 * 24 * 60 * 60 * 1000);
  const stale = await db.collection(THROTTLE).where("updatedAt", "<", Timestamp.fromDate(cutoff)).get();
  await Promise.all(stale.docs.map((d) => d.ref.delete()));

  logger.info("toeflExpirySweep: complete", { disabled, throttleDeleted: stale.size });
  return { disabled, throttleDeleted: stale.size };
}

exports.toeflExpirySweep = onSchedule(
  { schedule: "every day 03:00", timeZone: "America/Chicago" },
  async () => { await runExpirySweep(now()); });

// Exposed for tests.
exports._internal = {
  normalizeCode, toSyntheticEmail, expiryFor, hourKey, clientIp, TOEFL_ID_PATTERN,
  FAILS_PER_IP_PER_HOUR, FAILS_GLOBAL_PER_HOUR, THROTTLE, runExpirySweep,
  setNow(fn) { now = fn; },
};
