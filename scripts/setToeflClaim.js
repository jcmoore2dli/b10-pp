// ─────────────────────────────────────────────────────────────────────────────
// B10-PP · scripts/setToeflClaim.js
// Grants (or removes) the TOEFL enrollment claim, `toefl: true`, that
// hasToeflAccess() in firestore.rules and storage.rules requires (2026-09-18).
//
// MERGES, NEVER REPLACES. setCustomUserClaims() overwrites the whole claim
// set, and every account here already carries B10-PP's {b10Id, role, groupId}.
// Dropping b10Id would break isOwner() and recording uploads; dropping role
// would break staff routing. This script reads the current claims, adds or
// removes only `toefl`, writes the result, and reads it back.
//
// Dry run by default. Nothing is written without --apply.
//
//   GOOGLE_CLOUD_QUOTA_PROJECT=b10-practice-platform \
//     node scripts/setToeflClaim.js 26-022              # show the change
//   GOOGLE_CLOUD_QUOTA_PROJECT=b10-practice-platform \
//     node scripts/setToeflClaim.js 26-022 --apply      # write it
//   ... --remove [--apply]                              # take it away
//
// (The quota-project variable is only needed with local user ADC, which the
// Auth admin API otherwise rejects.)
//
// A claim change reaches the student's browser on the next ID-token refresh:
// signing out and back in, or up to an hour on its own.
//
// NOTE: B10-PP's claim-setting callables (createStudentAccount,
// enrollStudent, setStudentClaims, adminBulkRosterSetup, instructorAddStudent)
// write the claim set wholesale and do not know about `toefl`. If one of them
// runs again for a TOEFL student, the claim is lost and must be re-granted.
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const admin = require("../functions/node_modules/firebase-admin");

const PROJECT_ID = "b10-practice-platform";
const toSyntheticEmail = (b10Id) => b10Id.toLowerCase().replace(/[^a-z0-9-]/g, "-") + "@b10pp.local";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const remove = args.includes("--remove");
  const ids = args.filter((a) => !a.startsWith("--"));
  if (!ids.length) {
    console.error("usage: node scripts/setToeflClaim.js <b10Id> [<b10Id> ...] [--remove] [--apply]");
    process.exit(2);
  }

  admin.initializeApp({ projectId: PROJECT_ID });
  console.log(`${apply ? "APPLYING" : "DRY RUN"} — ${remove ? "remove" : "grant"} toefl claim, project ${PROJECT_ID}\n`);

  let failed = 0;
  for (const b10Id of ids) {
    try {
      const user = await admin.auth().getUserByEmail(toSyntheticEmail(b10Id));
      const before = user.customClaims || {};
      if (before.b10Id !== b10Id) {
        throw new Error(`claims.b10Id is ${JSON.stringify(before.b10Id)}, not ${b10Id}; refusing to touch a mismatched account`);
      }
      const after = { ...before };
      if (remove) delete after.toefl; else after.toefl = true;

      console.log(`${b10Id} (${user.uid})`);
      console.log(`  before: ${JSON.stringify(before)}`);
      console.log(`  after : ${JSON.stringify(after)}`);
      if (JSON.stringify(before) === JSON.stringify(after)) {
        console.log("  no change needed");
        continue;
      }
      if (!apply) continue;

      await admin.auth().setCustomUserClaims(user.uid, after);
      const readBack = (await admin.auth().getUser(user.uid)).customClaims || {};
      const ok = JSON.stringify(readBack) === JSON.stringify(after);
      console.log(`  written, read back: ${JSON.stringify(readBack)} ${ok ? "OK" : "MISMATCH"}`);
      if (!ok) failed++;
    } catch (err) {
      failed++;
      console.log(`${b10Id}: FAILED — ${err.message}`);
    }
  }
  if (!apply) console.log("\nNothing written. Re-run with --apply to write.");
  process.exit(failed ? 1 : 0);
}

main();
