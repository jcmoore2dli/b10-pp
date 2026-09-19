// test/toeflAccounts.test.js
// createToeflStudentAccount (functions/toeflAccounts.js), run against the Auth
// and Firestore EMULATORS under a demo- project id. The handler is called
// directly through onCall's .run(), so the Functions emulator is never
// started and no secret is ever loaded. The guard below refuses to run
// anywhere else.
//
//   firebase emulators:exec --only auth,firestore --project demo-toefl-accounts \
//     "npx mocha test/toeflAccounts.test.js --timeout 15000"

const path = require("path");
const assert = require("assert");

const PROJECT_ID = process.env.GCLOUD_PROJECT || "";
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!PROJECT_ID.startsWith("demo-") || !FS_HOST || !AUTH_HOST) {
  throw new Error(
    "Refusing to run: needs a demo- project and both the Auth and Firestore emulators " +
    `(GCLOUD_PROJECT=${PROJECT_ID || "unset"}, FIRESTORE_EMULATOR_HOST=${FS_HOST || "unset"}, ` +
    `FIREBASE_AUTH_EMULATOR_HOST=${AUTH_HOST || "unset"}). Use firebase emulators:exec.`);
}

// The functions package's own firebase-admin, so the handler and these
// assertions share one initialized app.
const admin = require(require.resolve("firebase-admin", { paths: [path.join(__dirname, "../functions")] }));
admin.initializeApp({ projectId: PROJECT_ID });
const { createToeflStudentAccount } = require("../functions/toeflAccounts");

const db = admin.firestore();
const UNAVAILABLE = "Invalid or unavailable access code.";

const call = (data) => createToeflStudentAccount.run({ data, rawRequest: {} });

async function seedCode(code, extra = {}) {
  await db.collection("toeflAccessCodes").doc(code).set({
    code, active: true, instructorUid: null, createdAt: new Date(), ...extra,
  });
}

async function expectUnavailable(promise) {
  await assert.rejects(promise, (err) => {
    assert.strictEqual(err.code, "not-found");
    assert.strictEqual(err.message, UNAVAILABLE);
    return true;
  });
}

async function userCount() {
  return (await admin.auth().listUsers()).users.length;
}

async function clearEmulators() {
  await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: "DELETE" });
  await fetch(`http://${FS_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
}

beforeEach(clearEmulators);
after(clearEmulators);

describe("createToeflStudentAccount — success path", () => {
  it("creates the login, claims, enrollment and consumes the code", async () => {
    await seedCode("T26-001");
    const res = await call({ accessCode: "T26-001", password: "secret123" });
    assert.deepStrictEqual(res, { success: true, b10Id: "T26-001" });

    const user = await admin.auth().getUserByEmail("t26-001@b10pp.local");
    assert.deepStrictEqual(user.customClaims, { b10Id: "T26-001", role: "student" });

    const e = (await db.collection("toeflEnrollment").doc("T26-001").get()).data();
    assert.strictEqual(e.b10Id, "T26-001");
    assert.strictEqual(e.uid, user.uid);
    assert.strictEqual(e.frozen, false);
    assert.strictEqual(e.instructorUid, null);
    assert.strictEqual(e.expiresAt.toDate().toISOString(), "2028-01-01T00:00:00.000Z");

    const c = (await db.collection("toeflAccessCodes").doc("T26-001").get()).data();
    assert.strictEqual(c.active, false);
    assert.strictEqual(c.redeemedUid, user.uid);
    assert.ok(c.redeemedAt);
  });

  it("expiry follows the ID year: T27 expires 2029-01-01", async () => {
    await seedCode("T27-001");
    await call({ accessCode: "T27-001", password: "secret123" });
    const e = (await db.collection("toeflEnrollment").doc("T27-001").get()).data();
    assert.strictEqual(e.expiresAt.toDate().toISOString(), "2029-01-01T00:00:00.000Z");
  });

  it("copies an instructor link from the code; self-study codes stay null", async () => {
    await seedCode("T26-002", { instructorUid: "instr-uid-1" });
    await call({ accessCode: "T26-002", password: "secret123" });
    const e = (await db.collection("toeflEnrollment").doc("T26-002").get()).data();
    assert.strictEqual(e.instructorUid, "instr-uid-1");
  });

  it("normalizes case and whitespace in the entered code", async () => {
    await seedCode("T26-003");
    const res = await call({ accessCode: "  t26 -003 ", password: "secret123" });
    assert.strictEqual(res.b10Id, "T26-003");
  });
});

describe("createToeflStudentAccount — every code problem looks the same", () => {
  it("unknown code", async () => {
    await expectUnavailable(call({ accessCode: "T26-404", password: "secret123" }));
    assert.strictEqual(await userCount(), 0);
  });

  it("inactive code", async () => {
    await seedCode("T26-010", { active: false });
    await expectUnavailable(call({ accessCode: "T26-010", password: "secret123" }));
    assert.strictEqual(await userCount(), 0);
  });

  it("already-used code", async () => {
    await seedCode("T26-011");
    await call({ accessCode: "T26-011", password: "secret123" });
    await expectUnavailable(call({ accessCode: "T26-011", password: "other456" }));
    assert.strictEqual(await userCount(), 1);
  });

  it("a B10-PP-style code is refused without any lookup", async () => {
    await expectUnavailable(call({ accessCode: "26-001", password: "secret123" }));
    assert.strictEqual(await userCount(), 0);
  });

  it("an active code in B10-PP's accessCodes is ignored", async () => {
    await db.collection("accessCodes").doc("T26-012").set({ code: "T26-012", active: true, groupId: "DLIELC" });
    await expectUnavailable(call({ accessCode: "T26-012", password: "secret123" }));
    assert.strictEqual(await userCount(), 0);
  });
});

describe("createToeflStudentAccount — input and failure handling", () => {
  it("a short password is refused and the code is not consumed", async () => {
    await seedCode("T26-020");
    await assert.rejects(call({ accessCode: "T26-020", password: "123" }), (err) => err.code === "invalid-argument");
    const c = (await db.collection("toeflAccessCodes").doc("T26-020").get()).data();
    assert.strictEqual(c.active, true);
    assert.strictEqual(await userCount(), 0);
  });

  it("missing fields are refused", async () => {
    await assert.rejects(call({}), (err) => err.code === "invalid-argument");
    await assert.rejects(call({ accessCode: "T26-021" }), (err) => err.code === "invalid-argument");
  });

  it("if enrollment cannot be written, the login is rolled back and the code stays usable", async () => {
    await seedCode("T26-030");
    await db.collection("toeflEnrollment").doc("T26-030").set({ b10Id: "T26-030", leftover: true });
    await assert.rejects(call({ accessCode: "T26-030", password: "secret123" }), (err) => err.code === "internal");
    assert.strictEqual(await userCount(), 0);
    const c = (await db.collection("toeflAccessCodes").doc("T26-030").get()).data();
    assert.strictEqual(c.active, true);
    assert.strictEqual(c.redeemedAt, undefined);
  });

  it("two simultaneous sign-ups with one code: exactly one succeeds", async () => {
    await seedCode("T26-040");
    const results = await Promise.allSettled([
      call({ accessCode: "T26-040", password: "secret123" }),
      call({ accessCode: "T26-040", password: "secret456" }),
    ]);
    assert.strictEqual(results.filter((r) => r.status === "fulfilled").length, 1);
    const rejected = results.find((r) => r.status === "rejected");
    assert.strictEqual(rejected.reason.message, UNAVAILABLE);
    assert.strictEqual(await userCount(), 1);
  });
});

describe("createToeflStudentAccount — never touches B10-PP collections", () => {
  it("a successful sign-up writes nothing to students, users, accessCodes or rosters", async () => {
    await seedCode("T26-050");
    await call({ accessCode: "T26-050", password: "secret123" });
    for (const name of ["students", "users", "userIndex", "accessCodes", "rosters"]) {
      const snap = await db.collection(name).limit(1).get();
      assert.strictEqual(snap.size, 0, `${name} should be untouched`);
    }
  });
});
