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
const { createToeflStudentAccount, setToeflFreeze, createToeflInstructorAccount, _internal } = require("../functions/toeflAccounts");
const { reviewLarIntelligibility } = require("../functions/toeflLarReview");
const { isToeflStaffToken } = require("../functions/lib/toeflStaff");

const db = admin.firestore();
const UNAVAILABLE = "Invalid or unavailable access code.";

const call = (data, ip = "203.0.113.1") => createToeflStudentAccount.run({ data, rawRequest: { ip, headers: {} } });

async function seedCode(code, extra = {}) {
  await db.collection("toeflAccessCodes").doc(code).set({
    code, active: true, instructorId: null, createdAt: new Date(), ...extra,
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
    assert.strictEqual(e.instructorId, null);
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
    await seedCode("T26-002", { instructorId: "INSTR-01" });
    await call({ accessCode: "T26-002", password: "secret123" });
    const e = (await db.collection("toeflEnrollment").doc("T26-002").get()).data();
    assert.strictEqual(e.instructorId, "INSTR-01");
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

describe("createToeflStudentAccount — failed-attempt throttle", () => {
  const { FAILS_PER_IP_PER_HOUR, FAILS_GLOBAL_PER_HOUR, THROTTLE } = _internal;
  let clock;
  beforeEach(() => {
    clock = new Date("2026-09-19T14:10:00Z");
    _internal.setNow(() => clock);
  });
  after(() => _internal.setNow(() => new Date()));

  async function failFrom(ip, times) {
    for (let i = 0; i < times; i++) {
      await expectUnavailable(call({ accessCode: "T26-999", password: "secret123" }, ip));
    }
  }

  it(`after ${FAILS_PER_IP_PER_HOUR} failures an IP is refused, even with a valid code`, async () => {
    await seedCode("T26-060");
    await failFrom("198.51.100.7", FAILS_PER_IP_PER_HOUR);
    await assert.rejects(call({ accessCode: "T26-060", password: "secret123" }, "198.51.100.7"),
      (err) => err.code === "resource-exhausted");
    assert.strictEqual(await userCount(), 0);
    const c = (await db.collection("toeflAccessCodes").doc("T26-060").get()).data();
    assert.strictEqual(c.active, true);
  });

  it("another IP is unaffected by one IP's failures", async () => {
    await seedCode("T26-061");
    await failFrom("198.51.100.7", FAILS_PER_IP_PER_HOUR);
    const res = await call({ accessCode: "T26-061", password: "secret123" }, "198.51.100.8");
    assert.strictEqual(res.b10Id, "T26-061");
  });

  it("successful sign-ups never count: a whole class on one IP registers", async () => {
    const ids = Array.from({ length: FAILS_PER_IP_PER_HOUR + 5 }, (_, i) => `T26-${String(100 + i)}`);
    for (const id of ids) await seedCode(id);
    for (const id of ids) {
      await call({ accessCode: id, password: "secret123" }, "192.0.2.50");
    }
    assert.strictEqual(await userCount(), ids.length);
  });

  it(`after ${FAILS_GLOBAL_PER_HOUR} failures across IPs, everyone waits`, async () => {
    await seedCode("T26-062");
    for (let i = 0; i < FAILS_GLOBAL_PER_HOUR; i++) {
      await expectUnavailable(call({ accessCode: "T26-999", password: "secret123" }, `10.0.0.${i}`));
    }
    await assert.rejects(call({ accessCode: "T26-062", password: "secret123" }, "10.9.9.9"),
      (err) => err.code === "resource-exhausted");
  });

  it("the limit resets in the next clock hour", async () => {
    await seedCode("T26-063");
    await failFrom("198.51.100.7", FAILS_PER_IP_PER_HOUR);
    clock = new Date("2026-09-19T15:00:01Z");
    const res = await call({ accessCode: "T26-063", password: "secret123" }, "198.51.100.7");
    assert.strictEqual(res.b10Id, "T26-063");
  });

  it("a short password does not count as a code failure", async () => {
    await seedCode("T26-064");
    for (let i = 0; i < FAILS_PER_IP_PER_HOUR + 2; i++) {
      await assert.rejects(call({ accessCode: "T26-064", password: "123" }, "198.51.100.9"),
        (err) => err.code === "invalid-argument");
    }
    const res = await call({ accessCode: "T26-064", password: "secret123" }, "198.51.100.9");
    assert.strictEqual(res.b10Id, "T26-064");
  });

  it("raw IP addresses are never stored", async () => {
    await failFrom("198.51.100.7", 1);
    const ids = (await db.collection(THROTTLE).get()).docs.map((d) => d.id + JSON.stringify(d.data()));
    assert.ok(ids.length > 0);
    assert.ok(ids.every((s) => !s.includes("198.51.100.7")));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Phase 3: setToeflFreeze and the daily expiry sweep
// ══════════════════════════════════════════════════════════════════════════

const ADMIN = { uid: "admin-uid", token: { role: "admin", b10Id: "ADMIN-01" } };
const freeze = (data, auth = ADMIN) => setToeflFreeze.run({ data, auth, rawRequest: {} });

async function signUp(id) {
  await seedCode(id);
  await call({ accessCode: id, password: "secret123" }, `198.18.0.${Math.floor(Math.random() * 250)}`);
  return (await admin.auth().getUserByEmail(`${id.toLowerCase()}@b10pp.local`)).uid;
}

async function enrollment(id) {
  return (await db.collection("toeflEnrollment").doc(id).get()).data();
}

describe("setToeflFreeze — who may call it", () => {
  it("refuses signed-out callers, students and instructors", async () => {
    await signUp("T26-200");
    await assert.rejects(freeze({ b10Id: "T26-200", frozen: true }, null), (e) => e.code === "unauthenticated");
    await assert.rejects(freeze({ b10Id: "T26-200", frozen: true }, { uid: "s", token: { role: "student", b10Id: "T26-201" } }),
      (e) => e.code === "permission-denied");
    await assert.rejects(freeze({ b10Id: "T26-200", frozen: true }, { uid: "i", token: { role: "instructor" } }),
      (e) => e.code === "permission-denied");
    assert.strictEqual((await enrollment("T26-200")).frozen, false);
  });

  it("refuses bad input and unknown IDs", async () => {
    await assert.rejects(freeze({ b10Id: "T26-200" }), (e) => e.code === "invalid-argument");
    await assert.rejects(freeze({ b10Id: "T26-200", frozen: "yes" }), (e) => e.code === "invalid-argument");
    await assert.rejects(freeze({ b10Id: "T26-404", frozen: true }), (e) => e.code === "not-found");
  });
});

describe("setToeflFreeze — freezing and unfreezing", () => {
  it("freezing a T account sets frozen and disables its login", async () => {
    const uid = await signUp("T26-210");
    const res = await freeze({ b10Id: "T26-210", frozen: true });
    assert.deepStrictEqual(res, { success: true, b10Id: "T26-210", frozen: true, loginDisabled: true });
    const e = await enrollment("T26-210");
    assert.strictEqual(e.frozen, true);
    assert.strictEqual(e.frozenBy, "ADMIN-01");
    assert.ok(e.frozenAt);
    assert.strictEqual((await admin.auth().getUser(uid)).disabled, true);
  });

  it("unfreezing restores the enrollment and the login", async () => {
    const uid = await signUp("T26-211");
    await freeze({ b10Id: "T26-211", frozen: true });
    const res = await freeze({ b10Id: "T26-211", frozen: false });
    assert.strictEqual(res.loginDisabled, false);
    assert.strictEqual((await enrollment("T26-211")).frozen, false);
    assert.strictEqual((await admin.auth().getUser(uid)).disabled, false);
  });

  it("unfreezing never revives an expired account's login", async () => {
    const uid = await signUp("T24-001"); // T24 expired on 2026-01-01
    await freeze({ b10Id: "T24-001", frozen: true });
    const res = await freeze({ b10Id: "T24-001", frozen: false });
    assert.strictEqual(res.loginDisabled, true);
    assert.strictEqual((await admin.auth().getUser(uid)).disabled, true);
  });

  it("a B10-PP student's login is never disabled; only their TOEFL enrollment freezes", async () => {
    const user = await admin.auth().createUser({ email: "26-022@b10pp.local", password: "secret123" });
    await db.collection("toeflEnrollment").doc("26-022").set({ enrolledBy: "JC" });
    const res = await freeze({ b10Id: "26-022", frozen: true });
    assert.strictEqual(res.loginDisabled, false);
    assert.strictEqual((await enrollment("26-022")).frozen, true);
    assert.strictEqual((await admin.auth().getUser(user.uid)).disabled, false);
  });
});

describe("toeflExpirySweep", () => {
  const AT = new Date("2028-01-02T09:00:00Z");

  it("disables expired T logins once, and leaves current and B10-PP accounts alone", async () => {
    const expiredUid = await signUp("T26-300");  // expires 2028-01-01
    const currentUid = await signUp("T27-300");  // expires 2029-01-01
    const b10 = await admin.auth().createUser({ email: "26-023@b10pp.local", password: "secret123" });
    await db.collection("toeflEnrollment").doc("26-023").set({ expiresAt: new Date("2027-01-01T00:00:00Z") });

    const first = await _internal.runExpirySweep(AT);
    assert.strictEqual(first.disabled, 1);
    assert.strictEqual((await admin.auth().getUser(expiredUid)).disabled, true);
    assert.ok((await enrollment("T26-300")).expiryLoginDisabledAt);
    assert.strictEqual((await admin.auth().getUser(currentUid)).disabled, false);
    assert.strictEqual((await admin.auth().getUser(b10.uid)).disabled, false);

    const second = await _internal.runExpirySweep(AT);
    assert.strictEqual(second.disabled, 0);
  });

  it("before the expiry date nothing is disabled", async () => {
    const uid = await signUp("T26-301");
    const res = await _internal.runExpirySweep(new Date("2027-12-31T23:00:00Z"));
    assert.strictEqual(res.disabled, 0);
    assert.strictEqual((await admin.auth().getUser(uid)).disabled, false);
  });

  it("deletes throttle counters older than two days and keeps recent ones", async () => {
    const T = db.collection(_internal.THROTTLE);
    await T.doc("global_2027123000").set({ fails: 3, updatedAt: new Date("2027-12-30T00:00:00Z") });
    await T.doc("global_2028010208").set({ fails: 1, updatedAt: new Date("2028-01-02T08:00:00Z") });
    const res = await _internal.runExpirySweep(AT);
    assert.strictEqual(res.throttleDeleted, 1);
    assert.strictEqual((await T.doc("global_2027123000").get()).exists, false);
    assert.strictEqual((await T.doc("global_2028010208").get()).exists, true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// createToeflInstructorAccount, and the shared TOEFL staff check
// ══════════════════════════════════════════════════════════════════════════

describe("createToeflInstructorAccount", () => {
  const mk = (data, auth = ADMIN) => createToeflInstructorAccount.run({ data, auth, rawRequest: {} });
  afterEach(() => _internal.setNow(() => new Date()));

  it("creates T<yy>-INS-<n> with claims {b10Id, role: instructor}", async () => {
    _internal.setNow(() => new Date("2026-09-19T15:00:00Z"));
    const res = await mk({ number: 1, password: "secret123" });
    assert.deepStrictEqual(res, { success: true, b10Id: "T26-INS-1" });
    const user = await admin.auth().getUserByEmail("t26-ins-1@b10pp.local");
    assert.deepStrictEqual(user.customClaims, { b10Id: "T26-INS-1", role: "instructor" });
  });

  it("the year prefix flips with the Chicago calendar year", async () => {
    _internal.setNow(() => new Date("2027-01-01T05:59:00Z")); // 23:59 Dec 31 in Chicago
    assert.strictEqual((await mk({ number: 2, password: "secret123" })).b10Id, "T26-INS-2");
    _internal.setNow(() => new Date("2027-01-01T06:01:00Z")); // 00:01 Jan 1 in Chicago
    assert.strictEqual((await mk({ number: 2, password: "secret123" })).b10Id, "T27-INS-2");
  });

  it("accepts a digit string, and refuses a duplicate", async () => {
    _internal.setNow(() => new Date("2026-09-19T15:00:00Z"));
    assert.strictEqual((await mk({ number: " 7 ", password: "secret123" })).b10Id, "T26-INS-7");
    await assert.rejects(mk({ number: 7, password: "other456" }), (e) => e.code === "already-exists");
    assert.strictEqual(await userCount(), 1);
  });

  it("refuses bad numbers and short passwords", async () => {
    for (const number of [0, 1000, -1, 1.5, "abc", "", null, "1a"]) {
      await assert.rejects(mk({ number, password: "secret123" }), (e) => e.code === "invalid-argument", `number ${number}`);
    }
    await assert.rejects(mk({ number: 3, password: "123" }), (e) => e.code === "invalid-argument");
    assert.strictEqual(await userCount(), 0);
  });

  it("admins only: refuses signed-out callers, students, and instructors of either kind", async () => {
    await assert.rejects(mk({ number: 4, password: "secret123" }, null), (e) => e.code === "unauthenticated");
    for (const token of [
      { role: "student", b10Id: "T26-001" },
      { role: "instructor", b10Id: "T26-INS-1" },
      { role: "instructor", b10Id: "26-INS-200" },
    ]) {
      await assert.rejects(mk({ number: 4, password: "secret123" }, { uid: "x", token }), (e) => e.code === "permission-denied");
    }
    assert.strictEqual(await userCount(), 0);
  });

  it("the created instructor is TOEFL staff by the shared check", async () => {
    _internal.setNow(() => new Date("2026-09-19T15:00:00Z"));
    await mk({ number: 5, password: "secret123" });
    const user = await admin.auth().getUserByEmail("t26-ins-5@b10pp.local");
    assert.strictEqual(isToeflStaffToken(user.customClaims), true);
  });
});

describe("isToeflStaffToken (functions/lib/toeflStaff.js)", () => {
  it("matches the rules: admins and T##-INS-# instructors only", () => {
    assert.strictEqual(isToeflStaffToken({ role: "admin" }), true);
    assert.strictEqual(isToeflStaffToken({ role: "instructor", b10Id: "T26-INS-1" }), true);
    assert.strictEqual(isToeflStaffToken({ role: "instructor", b10Id: "T27-INS-12" }), true);
    for (const t of [
      { role: "instructor", b10Id: "26-INS-200" },
      { role: "instructor" },
      { role: "instructor", b10Id: "T26-INS-X" },
      { role: "instructor", b10Id: "XT26-INS-1" },
      { role: "instructor", b10Id: "T26-INS-1-2" },
      { role: "student", b10Id: "T26-INS-1" },
      {}, null, undefined,
    ]) {
      assert.strictEqual(isToeflStaffToken(t), false, JSON.stringify(t));
    }
  });
});

describe("reviewLarIntelligibility: TOEFL staff only", () => {
  const review = (token) => reviewLarIntelligibility.run({
    data: { submissionId: "missing-sub", utteranceIndex: 0, action: "keep_cap" },
    auth: token ? { uid: "u", token } : null, rawRequest: {},
  });

  it("refuses a B10-PP instructor and a student before touching any data", async () => {
    await assert.rejects(review({ role: "instructor", b10Id: "26-INS-200" }), (e) => e.code === "permission-denied");
    await assert.rejects(review({ role: "student", b10Id: "T26-001" }), (e) => e.code === "permission-denied");
    await assert.rejects(review(null), (e) => e.code === "unauthenticated");
  });

  it("lets a TOEFL instructor and an admin past the role check", async () => {
    for (const token of [{ role: "instructor", b10Id: "T26-INS-1" }, { role: "admin" }]) {
      await assert.rejects(review(token), (e) => e.code !== "permission-denied" && e.code !== "unauthenticated",
        "should fail later (no such submission), not on role");
    }
  });
});
