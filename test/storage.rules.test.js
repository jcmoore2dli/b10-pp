// test/storage.rules.test.js
// Storage rules for audio/, including the TOEFL enrollment gate (2026-09-18;
// document-based 2026-09-19). Runs against the Storage AND Firestore
// emulators, under a demo- project id, which the emulators treat as offline:
// nothing here can reach the real bucket or database. Firestore is needed
// because hasToeflAccess() calls firestore.exists() on toeflEnrollment/{b10Id}.
// The emulator cannot prove the production half of that: the Storage service's
// permission to read Firestore, granted on first deploy, must be checked live.
//
//   firebase emulators:exec --only storage,firestore --project demo-b10-rules \
//     "npx mocha test/storage.rules.test.js --timeout 10000"

const { readFileSync } = require("fs");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { ref, getBytes, uploadBytes } = require("firebase/storage");
const { doc, setDoc } = require("firebase/firestore");

const PROJECT_ID = "demo-b10-rules";
const BYTES = new Uint8Array([1, 2, 3]);

let testEnv;

// toeflStudent is enrolled by the toeflEnrollment/26-022 document seeded in
// beforeEach, not by anything in its token. oldClaimOnly carries the
// superseded toefl: true claim (172161d3, never deployed) and no document.
const claims = {
  toeflStudent: { b10Id: "26-022", role: "student", groupId: "DLIELC" },
  b10Student:   { b10Id: "26-999", role: "student", groupId: "DLIELC" },
  oldClaimOnly: { b10Id: "26-998", role: "student", groupId: "DLIELC", toefl: true },
  frozen:       { b10Id: "T26-901", role: "student" },
  expired:      { b10Id: "T26-902", role: "student" },
  notYetExpired: { b10Id: "T26-903", role: "student" },
  instructor:   { b10Id: "T26-INS-1", role: "instructor" },   // TOEFL instructor
  b10Instructor: { b10Id: "26-INS-200", role: "instructor", groupId: "DLIELC" },
  admin:        { role: "admin" },
  noClaims:     {},
};
const as = (who) => testEnv.authenticatedContext(`uid-${who}`, claims[who]).storage();
const anon = () => testEnv.unauthenticatedContext().storage();

async function seed(path) {
  await testEnv.withSecurityRulesDisabled(async (c) => {
    await uploadBytes(ref(c.storage(), path), BYTES);
  });
}

async function enroll(b10Id, extra = {}) {
  await testEnv.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "toeflEnrollment", b10Id), { enrolledBy: "rules-test", ...extra });
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: { rules: readFileSync("./firebase/storage.rules", "utf8"), host: "127.0.0.1", port: 9199 },
    firestore: { rules: readFileSync("./firebase/firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
});
beforeEach(async () => { await enroll("26-022"); });
afterEach(async () => {
  await testEnv.clearStorage();
  await testEnv.clearFirestore();
});
after(async () => { await testEnv.cleanup(); });

describe("audio/toefl/** — TOEFL stimulus audio", () => {
  const P = "audio/toefl/lar/LAR-001/LAR-001_u1.mp3";

  it("enrolled TOEFL student can read", async () => {
    await seed(P);
    await assertSucceeds(getBytes(ref(as("toeflStudent"), P)));
  });
  it("B10-PP student with no enrollment document cannot read", async () => {
    await seed(P);
    await assertFails(getBytes(ref(as("b10Student"), P)));
  });
  it("the old toefl: true claim alone no longer grants access", async () => {
    await seed(P);
    await assertFails(getBytes(ref(as("oldClaimOnly"), P)));
  });
  it("a B10-PP instructor cannot read TOEFL audio (not TOEFL staff)", async () => {
    await seed(P);
    await assertFails(getBytes(ref(as("b10Instructor"), P)));
  });
  it("TOEFL instructor and admin can read by role", async () => {
    await seed(P);
    await assertSucceeds(getBytes(ref(as("instructor"), P)));
    await assertSucceeds(getBytes(ref(as("admin"), P)));
  });
  it("signed-out and unclaimed accounts cannot read", async () => {
    await seed(P);
    await assertFails(getBytes(ref(anon(), P)));
    await assertFails(getBytes(ref(as("noClaims"), P)));
  });
  it("no client can write stimulus audio, enrolled or not", async () => {
    await assertFails(uploadBytes(ref(as("toeflStudent"), P), BYTES));
    await assertFails(uploadBytes(ref(as("b10Student"), P), BYTES));
  });
  it("a file directly at audio/toefl (no subpath) is gated too", async () => {
    await seed("audio/toefl");
    await assertFails(getBytes(ref(as("b10Student"), "audio/toefl")));
  });
});

describe("audio/toefl/** — enrollment must be active (frozen, expiresAt)", () => {
  const P = "audio/toefl/lar/LAR-001/LAR-001_u1.mp3";

  it("a frozen student cannot read TOEFL audio", async () => {
    await enroll("T26-901", { frozen: true });
    await seed(P);
    await assertFails(getBytes(ref(as("frozen"), P)));
  });
  it("an expired student cannot read TOEFL audio", async () => {
    await enroll("T26-902", { expiresAt: new Date("2020-01-01T00:00:00Z") });
    await seed(P);
    await assertFails(getBytes(ref(as("expired"), P)));
  });
  it("a student before their expiresAt reads TOEFL audio", async () => {
    await enroll("T26-903", { expiresAt: new Date("2099-01-01T00:00:00Z") });
    await seed(P);
    await assertSucceeds(getBytes(ref(as("notYetExpired"), P)));
  });
});

describe("the rest of audio/ — unchanged for B10-PP", () => {
  it("any signed-in account reads B10-PP audio", async () => {
    await seed("audio/core/CORE-001.mp3");
    await assertSucceeds(getBytes(ref(as("b10Student"), "audio/core/CORE-001.mp3")));
    await assertSucceeds(getBytes(ref(as("noClaims"), "audio/core/CORE-001.mp3")));
  });
  it("files directly under audio/ still match", async () => {
    await seed("audio/top-level.mp3");
    await assertSucceeds(getBytes(ref(as("b10Student"), "audio/top-level.mp3")));
  });
  it("signed-out cannot read B10-PP audio", async () => {
    await seed("audio/core/CORE-001.mp3");
    await assertFails(getBytes(ref(anon(), "audio/core/CORE-001.mp3")));
  });
  it("B10-PP student recording upload still works (b10Id claim)", async () => {
    await assertSucceeds(uploadBytes(ref(as("b10Student"), "audio/26-999/26-999_1/recording.mp4"), BYTES));
  });
  it("TOEFL student recording upload still works (audio/{b10Id}/toefl_{attempt}/)", async () => {
    await assertSucceeds(uploadBytes(ref(as("toeflStudent"), "audio/26-022/toefl_ATT1/lar.mp4"), BYTES));
  });
  it("upload without a b10Id claim is refused, as before", async () => {
    await assertFails(uploadBytes(ref(as("admin"), "audio/x/recording.mp4"), BYTES));
  });
  it("a B10-PP instructor still reads B10-PP audio", async () => {
    await seed("audio/core/CORE-001.mp3");
    await assertSucceeds(getBytes(ref(as("b10Instructor"), "audio/core/CORE-001.mp3")));
  });
});
