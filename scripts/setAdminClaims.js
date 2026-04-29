// scripts/setAdminClaims.js
// Run once to bootstrap admin claims on your test user.
// Usage: node scripts/setAdminClaims.js

const admin = require("firebase-admin");
const serviceAccount = require("../firebase/service-account.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const UID = "1vKUesFxdPfUI95cp9KEJsD5aaJ2";

async function run() {
  await admin.auth().setCustomUserClaims(UID, {
    b10Id: "ADMIN001",
    role: "admin",
    groupId: "DLIELC",
  });
  console.log("✔ Admin claims set for", UID);
  process.exit(0);
}

run().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
