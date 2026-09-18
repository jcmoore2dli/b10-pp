// test/storage.rules.test.js
// Storage rules for audio/, including the TOEFL enrollment gate (2026-09-18).
// Runs against the Storage emulator only, under a demo- project id, which the
// emulator treats as offline: nothing here can reach the real bucket.
//
//   firebase emulators:exec --only storage --project demo-b10-rules \
//     "npx mocha test/storage.rules.test.js --timeout 10000"

const { readFileSync } = require("fs");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { ref, getBytes, uploadBytes } = require("firebase/storage");

const PROJECT_ID = "demo-b10-rules";
const BYTES = new Uint8Array([1, 2, 3]);

let testEnv;

const claims = {
  toeflStudent: { b10Id: "26-022", role: "student", groupId: "DLIELC", toefl: true },
  b10Student:   { b10Id: "26-999", role: "student", groupId: "DLIELC" },
  instructor:   { role: "instructor" },
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

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: { rules: readFileSync("./firebase/storage.rules", "utf8"), host: "127.0.0.1", port: 9199 },
  });
});
afterEach(async () => { await testEnv.clearStorage(); });
after(async () => { await testEnv.cleanup(); });

describe("audio/toefl/** — TOEFL stimulus audio", () => {
  const P = "audio/toefl/lar/LAR-001/LAR-001_u1.mp3";

  it("enrolled TOEFL student can read", async () => {
    await seed(P);
    await assertSucceeds(getBytes(ref(as("toeflStudent"), P)));
  });
  it("B10-PP student WITHOUT the toefl claim cannot read", async () => {
    await seed(P);
    await assertFails(getBytes(ref(as("b10Student"), P)));
  });
  it("instructor and admin can read by role", async () => {
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
    await assertFails(uploadBytes(ref(as("instructor"), "audio/x/recording.mp4"), BYTES));
  });
});
