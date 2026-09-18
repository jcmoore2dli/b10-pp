#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// THROWAWAY TEST USER — EMULATOR ONLY, NOT A REAL ACCOUNT
//
// Creates one fake student in the Auth emulator so the TOEFL app can be signed
// into locally. This is not a real enrollment: it bypasses the access-code /
// enrollStudent flow entirely and sets custom claims directly via the Admin
// SDK, which is exactly what a real signup would NOT do.
//
// Nothing here should be reused for real account creation. The real path is
// functions/index.js → createStudentAccount / enrollStudent.
//
// SAFETY: refuses to run unless FIREBASE_AUTH_EMULATOR_HOST is set. Without it
// the Admin SDK would create this user in the live project's Auth, alongside
// active B10-PP students.
//
// Usage:
//   firebase emulators:start --only auth,firestore,functions
//   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/seedToeflAuthUser.js
// ─────────────────────────────────────────────────────────────────────────────

const admin = require("firebase-admin");

const PROJECT_ID = process.env.GCLOUD_PROJECT || "b10-practice-platform";

// Matches the Firestore fixture's studentId, so seeded attempts and
// submissions belong to this user.
const B10_ID = "TEST-STUDENT-01";
const PASSWORD = "test123"; // 6-char minimum enforced by the signup form

if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error(
    "\nREFUSING TO RUN: FIREBASE_AUTH_EMULATOR_HOST is not set.\n\n" +
      "This creates a throwaway user. Without that variable the Admin SDK\n" +
      "would write it into the live project's Auth, which holds real B10-PP\n" +
      "student accounts. Start the emulator and re-run:\n\n" +
      "  firebase emulators:start --only auth,firestore,functions\n" +
      "  FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/seedToeflAuthUser.js\n"
  );
  process.exit(1);
}

// Mirrors toSyntheticEmail() in src/screens/LoginScreen.jsx line 7. Kept
// identical deliberately: the login form converts the typed B10 ID with this
// exact transform, so any drift here produces a user that cannot be signed
// into. If that function changes, change this too.
function toSyntheticEmail(b10Id) {
  const val = b10Id.trim();
  if (val.includes("@") && val.includes(".")) return val;
  return val.toLowerCase().replace(/[^a-z0-9-]/g, "-") + "@b10pp.local";
}

admin.initializeApp({ projectId: PROJECT_ID });

async function main() {
  const email = toSyntheticEmail(B10_ID);

  // Idempotent: re-running resets the password and claims rather than failing.
  let user;
  try {
    user = await admin.auth().getUserByEmail(email);
    await admin.auth().updateUser(user.uid, { password: PASSWORD });
    console.log(`updated existing user ${email}`);
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
    user = await admin.auth().createUser({ email, password: PASSWORD });
    console.log(`created user ${email}`);
  }

  // The claims every TOEFL rule reads. isOwner() checks b10Id; the staff-route
  // guards in App.jsx check role. A user without these is signed in but denied
  // by every rule, which is the failure this script exists to prevent.
  // toefl: the enrollment claim hasToeflAccess() requires (2026-09-18).
  await admin.auth().setCustomUserClaims(user.uid, {
    b10Id: B10_ID,
    role: "student",
    toefl: true,
  });

  // Read back rather than assume the write landed.
  const verified = await admin.auth().getUser(user.uid);
  console.log(`\nuid          : ${verified.uid}`);
  console.log(`email        : ${verified.email}`);
  console.log(`custom claims: ${JSON.stringify(verified.customClaims)}`);

  console.log(`\n─── SIGN IN WITH ───────────────────────────────`);
  console.log(`  B10 ID   : ${B10_ID}`);
  console.log(`  Password : ${PASSWORD}`);
  console.log(`────────────────────────────────────────────────`);
  console.log(`(the form converts the B10 ID to ${email} itself —`);
  console.log(` type the B10 ID, not the email)\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("seed failed:", err);
    process.exit(1);
  });
