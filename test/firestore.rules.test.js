const { readFileSync } = require("fs");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc, updateDoc, deleteDoc } = require("firebase/firestore");

// A DEDICATED project, deliberately not the shared one. afterEach() below
// calls clearFirestore(), which is scoped to this projectId — so when this
// read "b10-practice-platform" every run of this suite silently wiped every
// imported corpus item out of the emulator, breaking the fixture and e2e
// suites that share it. Rules evaluation is identical under any project id.
const PROJECT_ID = "b10-pp-rules-test";
const RULES_PATH = "./firebase/firestore.rules";

let testEnv;

// ── Helpers ────────────────────────────────────────────────────────────────

function adminDb() {
  return testEnv.withSecurityRulesDisabled(ctx => ctx.firestore());
}

function authedDb(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

function anonDb() {
  return testEnv.unauthenticatedContext().firestore();
}

async function seedUser(uid, role) {
  const ctx = await testEnv.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "users", uid), { userId: uid, role });
  });
}

async function seedUserIndex(uid, studentId) {
  await testEnv.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "userIndex", uid), { studentId });
  });
}

async function seedStudent(studentId, track) {
  await testEnv.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "students", studentId), {
      studentId,
      track,
      ilrBaseline: "2"
    });
  });
}

// ── Setup / Teardown ───────────────────────────────────────────────────────

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(RULES_PATH, "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  await testEnv.cleanup();
});

// ══════════════════════════════════════════════════════════════════════════
// USERS
// ══════════════════════════════════════════════════════════════════════════

describe("users collection", () => {
  it("admin can read any user doc", async () => {
    await seedUser("admin1", "admin");
    await seedUser("target1", "student");
    const db = authedDb("admin1");
    await assertSucceeds(getDoc(doc(db, "users", "target1")));
  });

  it("user can read own doc", async () => {
    await seedUser("student1", "student");
    const db = authedDb("student1");
    await assertSucceeds(getDoc(doc(db, "users", "student1")));
  });

  it("student cannot read another user doc", async () => {
    await seedUser("student1", "student");
    await seedUser("student2", "student");
    const db = authedDb("student1");
    await assertFails(getDoc(doc(db, "users", "student2")));
  });

  it("unauthenticated cannot read user doc", async () => {
    await seedUser("student1", "student");
    const db = anonDb();
    await assertFails(getDoc(doc(db, "users", "student1")));
  });

  it("admin can create user doc", async () => {
    await seedUser("admin1", "admin");
    const db = authedDb("admin1");
    await assertSucceeds(setDoc(doc(db, "users", "newuser1"), {
      userId: "newuser1",
      role: "student"
    }));
  });

  it("student cannot create user doc", async () => {
    await seedUser("student1", "student");
    const db = authedDb("student1");
    await assertFails(setDoc(doc(db, "users", "newuser2"), {
      userId: "newuser2",
      role: "student"
    }));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// SUBMISSIONS
// ══════════════════════════════════════════════════════════════════════════

describe("submissions collection", () => {
  beforeEach(async () => {
    await seedUser("admin1", "admin");
    await seedUser("instructor1", "instructor");
    await seedUser("student1", "student");
    await seedUser("student2", "student");
    await seedUserIndex("student1", "STU001");
    await seedUserIndex("student2", "STU002");
    await seedStudent("STU001", "A");
    await seedStudent("STU002", "B");
  });

  it("student can create own queued submission with submissionNumber 0", async () => {
    const db = authedDb("student1");
    await assertSucceeds(setDoc(doc(db, "submissions", "sub001"), {
      studentId: "STU001",
      status: "queued",
      submissionNumber: 0
    }));
  });

  it("student cannot create submission for another student", async () => {
    const db = authedDb("student1");
    await assertFails(setDoc(doc(db, "submissions", "sub002"), {
      studentId: "STU002",
      status: "queued",
      submissionNumber: 0
    }));
  });

  it("student cannot create submission with status other than queued", async () => {
    const db = authedDb("student1");
    await assertFails(setDoc(doc(db, "submissions", "sub003"), {
      studentId: "STU001",
      status: "complete",
      submissionNumber: 0
    }));
  });

  it("student cannot create submission with non-zero submissionNumber", async () => {
    const db = authedDb("student1");
    await assertFails(setDoc(doc(db, "submissions", "sub004"), {
      studentId: "STU001",
      status: "queued",
      submissionNumber: 1
    }));
  });

  it("student cannot update a submission", async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "submissions", "sub005"), {
        studentId: "STU001",
        status: "queued",
        submissionNumber: 0
      });
    });
    const db = authedDb("student1");
    await assertFails(updateDoc(doc(db, "submissions", "sub005"), {
      status: "processing"
    }));
  });

  it("student can read own submission", async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "submissions", "sub006"), {
        studentId: "STU001",
        status: "complete",
        submissionNumber: 1
      });
    });
    const db = authedDb("student1");
    await assertSucceeds(getDoc(doc(db, "submissions", "sub006")));
  });

  it("student cannot read another student submission", async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "submissions", "sub007"), {
        studentId: "STU002",
        status: "complete",
        submissionNumber: 1
      });
    });
    const db = authedDb("student1");
    await assertFails(getDoc(doc(db, "submissions", "sub007")));
  });

  it("instructor can read any submission", async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "submissions", "sub008"), {
        studentId: "STU001",
        status: "complete",
        submissionNumber: 1
      });
    });
    const db = authedDb("instructor1");
    await assertSucceeds(getDoc(doc(db, "submissions", "sub008")));
  });

  it("unauthenticated cannot read submissions", async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "submissions", "sub009"), {
        studentId: "STU001",
        status: "complete",
        submissionNumber: 1
      });
    });
    const db = anonDb();
    await assertFails(getDoc(doc(db, "submissions", "sub009")));
  });

  it("admin can delete a submission", async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "submissions", "sub010"), {
        studentId: "STU001",
        status: "queued",
        submissionNumber: 0
      });
    });
    const db = authedDb("admin1");
    await assertSucceeds(deleteDoc(doc(db, "submissions", "sub010")));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// SUBMISSION COUNTERS
// ══════════════════════════════════════════════════════════════════════════

describe("submissionCounters collection", () => {
  beforeEach(async () => {
    await seedUser("admin1", "admin");
    await seedUser("instructor1", "instructor");
    await seedUser("student1", "student");
    await seedUserIndex("student1", "STU001");
    await seedStudent("STU001", "A");
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "submissionCounters", "STU001"), {
        count: 5
      });
    });
  });

  it("student cannot read submissionCounters", async () => {
    const db = authedDb("student1");
    await assertFails(getDoc(doc(db, "submissionCounters", "STU001")));
  });

  it("instructor cannot read submissionCounters", async () => {
    const db = authedDb("instructor1");
    await assertFails(getDoc(doc(db, "submissionCounters", "STU001")));
  });

  it("admin cannot read submissionCounters", async () => {
    const db = authedDb("admin1");
    await assertFails(getDoc(doc(db, "submissionCounters", "STU001")));
  });

  it("student cannot write submissionCounters", async () => {
    const db = authedDb("student1");
    await assertFails(setDoc(doc(db, "submissionCounters", "STU001"), {
      count: 99
    }));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ATTEMPTS
// ══════════════════════════════════════════════════════════════════════════

describe("attempts collection", () => {
  beforeEach(async () => {
    await seedUser("admin1", "admin");
    await seedUser("instructor1", "instructor");
    await seedUser("student1", "student");
    await seedUser("student2", "student");
    await seedUserIndex("student1", "STU001");
    await seedUserIndex("student2", "STU002");
    await seedStudent("STU001", "A");
    await seedStudent("STU002", "B");
  });

  it("student can read own attempt", async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "attempts", "att001"), {
        studentId: "STU001",
        score: 3
      });
    });
    const db = authedDb("student1");
    await assertSucceeds(getDoc(doc(db, "attempts", "att001")));
  });

  it("student cannot read another student attempt", async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "attempts", "att002"), {
        studentId: "STU002",
        score: 2
      });
    });
    const db = authedDb("student1");
    await assertFails(getDoc(doc(db, "attempts", "att002")));
  });

  it("instructor can read any attempt", async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "attempts", "att003"), {
        studentId: "STU001",
        score: 3
      });
    });
    const db = authedDb("instructor1");
    await assertSucceeds(getDoc(doc(db, "attempts", "att003")));
  });

  it("student cannot create attempt directly", async () => {
    const db = authedDb("student1");
    await assertFails(setDoc(doc(db, "attempts", "att004"), {
      studentId: "STU001",
      score: 3
    }));
  });

  it("student cannot update attempt", async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "attempts", "att005"), {
        studentId: "STU001",
        score: 2
      });
    });
    const db = authedDb("student1");
    await assertFails(updateDoc(doc(db, "attempts", "att005"), { score: 4 }));
  });

  it("admin can delete attempt", async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "attempts", "att006"), {
        studentId: "STU001",
        score: 3
      });
    });
    const db = authedDb("admin1");
    await assertSucceeds(deleteDoc(doc(db, "attempts", "att006")));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// TOEFL — toeflSubmissions and toeflAttempts
//
// Added Sep 11, 2026, because these two collections had NO rules coverage at
// all while carrying live student-owned data. That gap is what let a
// field-name defect sit undetected across seven fixture and e2e files: every
// one of them created submissions keyed on `uid` rather than `studentId`, and
// nothing could fail. The scoring trigger never reads the ownership field
// (functions/toeflScoring.js contains zero references to either name), and
// the Admin SDK bypasses rules entirely, so both the scoring path and the
// seeding path were structurally blind to it. Only a rules test can see it.
//
// These use CLAIM-BEARING auth contexts, unlike the helpers above. The TOEFL
// rules gate on custom claims — isOwner() on request.auth.token.b10Id, and
// isAdminOrInstructor() on request.auth.token.role — not on the users doc, so
// a context built by authedDb() satisfies neither. The claim values mirror
// scripts/seedToeflAuthUser.js (B10_ID = "TEST-STUDENT-01") so that the
// emulator fixtures and these assertions describe the same student.
//
// TOEFL enrollment is a document, not a claim (2026-09-19): hasToeflAccess()
// checks that toeflEnrollment/{b10Id} exists. afterEach() clears Firestore, so
// every test that needs an enrolled student seeds that document itself.
// ══════════════════════════════════════════════════════════════════════════

const OWNER_UID = "auth-uid-student-01";
const OWNER_B10 = "TEST-STUDENT-01";
const OTHER_UID = "auth-uid-student-02";
const OTHER_B10 = "TEST-STUDENT-02";

// The claim shape a real signed-in student carries: B10-PP's own claims
// (createStudentAccount). Whether they are a TOEFL student depends on
// enroll(b10Id) having been seeded, not on anything in the token.
function studentDb(uid, b10Id) {
  return testEnv.authenticatedContext(uid, { b10Id, role: "student", groupId: "DLIELC" }).firestore();
}

// An ordinary B10-PP student: same pool, same claims, and no enrollment
// document seeded. Before 2026-09-18 this account could read every TOEFL item.
function b10OnlyDb(uid, b10Id) {
  return testEnv.authenticatedContext(uid, { b10Id, role: "student", groupId: "DLIELC" }).firestore();
}

function instructorDb() {
  return testEnv.authenticatedContext("auth-uid-instructor", { role: "instructor" }).firestore();
}

// A freshly created emulator user, before setCustomUserClaims has run. This is
// the real default state, not a hypothetical: every TOEFL rule gates on b10Id,
// so an unclaimed account must be denied rather than silently treated as owner.
function noClaimsDb() {
  return testEnv.authenticatedContext("auth-uid-unclaimed").firestore();
}

async function seedToefl(collectionName, id, data) {
  await testEnv.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), collectionName, id), data);
  });
}

// Enrolls a student in TOEFL the way staff do in production: a
// toeflEnrollment/{b10Id} document, written with rules bypassed.
async function enroll(b10Id) {
  await seedToefl("toeflEnrollment", b10Id, { enrolledBy: "rules-test" });
}

const VALID_SUBMISSION = {
  attemptId: "ATT-1",
  studentId: OWNER_B10,
  taskType: "AP",
  responseContent: { answers: [{ questionIndex: 1, selectedOptionId: "a" }] },
  scoringStatus: "queued",
};

const VALID_ATTEMPT = {
  studentId: OWNER_B10,
  itemId: "AP-001",
  taskType: "AP",
  startedAt: null,
  completedAt: null,
};

describe("toeflSubmissions collection", () => {
  // The owner is an enrolled TOEFL student; OTHER_B10 is deliberately not.
  beforeEach(() => enroll(OWNER_B10));

  it("owner can create a submission whose studentId matches their b10Id claim", async () => {
    const db = studentDb(OWNER_UID, OWNER_B10);
    await assertSucceeds(setDoc(doc(db, "toeflSubmissions", "TS-001"), VALID_SUBMISSION));
  });

  // ── THE REGRESSION TEST. This is the assertion that was missing.
  //
  // A submission keyed on `uid` instead of `studentId` must be denied:
  // isOwner() reads request.resource.data.studentId, which is absent, so the
  // comparison against the b10Id claim is false. Had this existed, the defect
  // in all seven fixture files would have been caught the day it was written.
  it("DENIES a submission carrying uid instead of studentId", async () => {
    const db = studentDb(OWNER_UID, OWNER_B10);
    const { studentId, ...noStudentId } = VALID_SUBMISSION;
    await assertFails(setDoc(doc(db, "toeflSubmissions", "TS-002"), {
      ...noStudentId,
      uid: OWNER_B10,
    }));
  });

  // The other half of the same defect: such a document is unreadable by the
  // student it nominally belongs to, which is how a seeded fixture fails
  // confusingly in the browser rather than obviously.
  it("owner cannot READ a submission that carries uid instead of studentId", async () => {
    const { studentId, ...noStudentId } = VALID_SUBMISSION;
    await seedToefl("toeflSubmissions", "TS-003", { ...noStudentId, uid: OWNER_B10 });
    const db = studentDb(OWNER_UID, OWNER_B10);
    await assertFails(getDoc(doc(db, "toeflSubmissions", "TS-003")));
  });

  it("student cannot create a submission owned by another student", async () => {
    const db = studentDb(OWNER_UID, OWNER_B10);
    await assertFails(setDoc(doc(db, "toeflSubmissions", "TS-004"), {
      ...VALID_SUBMISSION,
      studentId: OTHER_B10,
    }));
  });

  it("an account with no b10Id claim cannot create a submission", async () => {
    const db = noClaimsDb();
    await assertFails(setDoc(doc(db, "toeflSubmissions", "TS-005"), VALID_SUBMISSION));
  });

  it("unauthenticated cannot create a submission", async () => {
    const db = anonDb();
    await assertFails(setDoc(doc(db, "toeflSubmissions", "TS-006"), VALID_SUBMISSION));
  });

  // scoredAt is null-tolerant BY DESIGN: MCQRenderer.jsx writes scoredAt: null
  // at creation as part of the documented initial shape, so a bare
  // key-absence check would reject every real submission. Both branches are
  // asserted because the tolerance is the part that can regress silently.
  it("owner can create with scoredAt explicitly null", async () => {
    const db = studentDb(OWNER_UID, OWNER_B10);
    await assertSucceeds(setDoc(doc(db, "toeflSubmissions", "TS-007"), {
      ...VALID_SUBMISSION,
      scoredAt: null,
    }));
  });

  it("owner cannot create with a fabricated non-null scoredAt", async () => {
    const db = studentDb(OWNER_UID, OWNER_B10);
    await assertFails(setDoc(doc(db, "toeflSubmissions", "TS-008"), {
      ...VALID_SUBMISSION,
      scoredAt: new Date("2026-01-01"),
    }));
  });

  // Server-only fields. The trigger's success path overwrites these, but its
  // error path only sets scoringStatus — so a fabricated value could survive a
  // failed scoring attempt if the create rule let it in.
  for (const field of ["perQuestionResults", "layerA", "layerB", "status", "instructor"]) {
    it(`owner cannot create with client-supplied ${field}`, async () => {
      const db = studentDb(OWNER_UID, OWNER_B10);
      await assertFails(setDoc(doc(db, "toeflSubmissions", `TS-blocked-${field}`), {
        ...VALID_SUBMISSION,
        [field]: field === "perQuestionResults" ? [{ questionIndex: 1, correct: true }] : "forged",
      }));
    });
  }

  it("owner can read own submission", async () => {
    await seedToefl("toeflSubmissions", "TS-010", VALID_SUBMISSION);
    const db = studentDb(OWNER_UID, OWNER_B10);
    await assertSucceeds(getDoc(doc(db, "toeflSubmissions", "TS-010")));
  });

  it("student cannot read another student's submission", async () => {
    await seedToefl("toeflSubmissions", "TS-011", VALID_SUBMISSION);
    const db = studentDb(OTHER_UID, OTHER_B10);
    await assertFails(getDoc(doc(db, "toeflSubmissions", "TS-011")));
  });

  it("instructor can read any submission", async () => {
    await seedToefl("toeflSubmissions", "TS-012", VALID_SUBMISSION);
    await assertSucceeds(getDoc(doc(instructorDb(), "toeflSubmissions", "TS-012")));
  });

  it("unauthenticated cannot read a submission", async () => {
    await seedToefl("toeflSubmissions", "TS-013", VALID_SUBMISSION);
    await assertFails(getDoc(doc(anonDb(), "toeflSubmissions", "TS-013")));
  });

  // allow update: if false — the trigger writes results via the Admin SDK,
  // which bypasses rules, so no client ever needs update.
  it("owner cannot update own submission", async () => {
    await seedToefl("toeflSubmissions", "TS-014", VALID_SUBMISSION);
    const db = studentDb(OWNER_UID, OWNER_B10);
    await assertFails(updateDoc(doc(db, "toeflSubmissions", "TS-014"), {
      scoringStatus: "scored",
    }));
  });

  it("owner cannot delete own submission", async () => {
    await seedToefl("toeflSubmissions", "TS-015", VALID_SUBMISSION);
    const db = studentDb(OWNER_UID, OWNER_B10);
    await assertFails(deleteDoc(doc(db, "toeflSubmissions", "TS-015")));
  });

  it("instructor cannot delete a submission", async () => {
    await seedToefl("toeflSubmissions", "TS-016", VALID_SUBMISSION);
    await assertFails(deleteDoc(doc(instructorDb(), "toeflSubmissions", "TS-016")));
  });
});

describe("toeflAttempts collection", () => {
  // The owner is an enrolled TOEFL student; OTHER_B10 is deliberately not.
  beforeEach(() => enroll(OWNER_B10));

  it("owner can create an attempt whose studentId matches their b10Id claim", async () => {
    const db = studentDb(OWNER_UID, OWNER_B10);
    await assertSucceeds(setDoc(doc(db, "toeflAttempts", "TA-001"), VALID_ATTEMPT));
  });

  it("DENIES an attempt carrying uid instead of studentId", async () => {
    const db = studentDb(OWNER_UID, OWNER_B10);
    const { studentId, ...noStudentId } = VALID_ATTEMPT;
    await assertFails(setDoc(doc(db, "toeflAttempts", "TA-002"), {
      ...noStudentId,
      uid: OWNER_B10,
    }));
  });

  it("student cannot create an attempt owned by another student", async () => {
    const db = studentDb(OWNER_UID, OWNER_B10);
    await assertFails(setDoc(doc(db, "toeflAttempts", "TA-003"), {
      ...VALID_ATTEMPT,
      studentId: OTHER_B10,
    }));
  });

  it("an account with no b10Id claim cannot create an attempt", async () => {
    await assertFails(setDoc(doc(noClaimsDb(), "toeflAttempts", "TA-004"), VALID_ATTEMPT));
  });

  it("owner can read own attempt", async () => {
    await seedToefl("toeflAttempts", "TA-005", VALID_ATTEMPT);
    const db = studentDb(OWNER_UID, OWNER_B10);
    await assertSucceeds(getDoc(doc(db, "toeflAttempts", "TA-005")));
  });

  it("student cannot read another student's attempt", async () => {
    await seedToefl("toeflAttempts", "TA-006", VALID_ATTEMPT);
    const db = studentDb(OTHER_UID, OTHER_B10);
    await assertFails(getDoc(doc(db, "toeflAttempts", "TA-006")));
  });

  it("instructor can read any attempt", async () => {
    await seedToefl("toeflAttempts", "TA-007", VALID_ATTEMPT);
    await assertSucceeds(getDoc(doc(instructorDb(), "toeflAttempts", "TA-007")));
  });

  // The real client marks the attempt complete at submit time — MCQRenderer.jsx
  // updates completedAt after the submission write — so this update must be
  // allowed, with studentId and itemId pinned against reassignment.
  it("owner can update completedAt without touching studentId or itemId", async () => {
    await seedToefl("toeflAttempts", "TA-008", VALID_ATTEMPT);
    const db = studentDb(OWNER_UID, OWNER_B10);
    await assertSucceeds(updateDoc(doc(db, "toeflAttempts", "TA-008"), {
      completedAt: new Date("2026-09-11"),
    }));
  });

  it("owner cannot reassign an attempt to another student", async () => {
    await seedToefl("toeflAttempts", "TA-009", VALID_ATTEMPT);
    const db = studentDb(OWNER_UID, OWNER_B10);
    await assertFails(updateDoc(doc(db, "toeflAttempts", "TA-009"), {
      studentId: OTHER_B10,
    }));
  });

  it("owner cannot repoint an attempt at a different item", async () => {
    await seedToefl("toeflAttempts", "TA-010", VALID_ATTEMPT);
    const db = studentDb(OWNER_UID, OWNER_B10);
    await assertFails(updateDoc(doc(db, "toeflAttempts", "TA-010"), {
      itemId: "AP-999",
    }));
  });

  it("owner cannot delete own attempt", async () => {
    await seedToefl("toeflAttempts", "TA-011", VALID_ATTEMPT);
    const db = studentDb(OWNER_UID, OWNER_B10);
    await assertFails(deleteDoc(doc(db, "toeflAttempts", "TA-011")));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// TOEFL enrollment gate (2026-09-18; document-based 2026-09-19): hasToeflAccess()
//
// No beforeEach here: the B10-PP-student cases reuse OWNER_B10 and must run
// with no enrollment document, so each enrolled case calls enroll() itself.
// ══════════════════════════════════════════════════════════════════════════

describe("TOEFL enrollment gate", () => {
  const ITEM = { taskType: "AP", status: "active" };

  it("an enrolled TOEFL student can read an item", async () => {
    await enroll(OWNER_B10);
    await seedToefl("toeflItems", "AP-001", ITEM);
    await assertSucceeds(getDoc(doc(studentDb(OWNER_UID, OWNER_B10), "toeflItems", "AP-001")));
  });

  it("a B10-PP student with no enrollment document CANNOT read an item", async () => {
    await seedToefl("toeflItems", "AP-002", ITEM);
    await assertFails(getDoc(doc(b10OnlyDb(OWNER_UID, OWNER_B10), "toeflItems", "AP-002")));
  });

  // The superseded toefl claim (172161d3, never deployed) still sits on
  // 26-022. It must grant nothing on its own.
  it("the old toefl: true claim alone no longer grants access", async () => {
    await seedToefl("toeflItems", "AP-003", ITEM);
    const db = testEnv.authenticatedContext(OWNER_UID, { b10Id: OWNER_B10, role: "student", toefl: true }).firestore();
    await assertFails(getDoc(doc(db, "toeflItems", "AP-003")));
  });

  // toeflEnrollment has no match block, so every client request is denied.
  // Were writes allowed, any B10-PP student could enroll themselves.
  it("a student cannot create their own enrollment document", async () => {
    await assertFails(setDoc(doc(b10OnlyDb(OWNER_UID, OWNER_B10), "toeflEnrollment", OWNER_B10), {
      enrolledBy: "self",
    }));
  });

  it("a student cannot read their own enrollment document", async () => {
    await enroll(OWNER_B10);
    await assertFails(getDoc(doc(studentDb(OWNER_UID, OWNER_B10), "toeflEnrollment", OWNER_B10)));
  });

  it("instructors and admins read items by role, without enrollment", async () => {
    await seedToefl("toeflItems", "AP-004", ITEM);
    await assertSucceeds(getDoc(doc(instructorDb(), "toeflItems", "AP-004")));
    const admin = testEnv.authenticatedContext("auth-uid-admin", { role: "admin" }).firestore();
    await assertSucceeds(getDoc(doc(admin, "toeflItems", "AP-004")));
  });

  it("signed-out and unclaimed accounts cannot read an item", async () => {
    await seedToefl("toeflItems", "AP-005", ITEM);
    await assertFails(getDoc(doc(anonDb(), "toeflItems", "AP-005")));
    await assertFails(getDoc(doc(noClaimsDb(), "toeflItems", "AP-005")));
  });

  it("answerKey stays staff-only, enrolled or not", async () => {
    await enroll(OWNER_B10);
    await seedToefl("toeflItems/AP-006/answerKey", "key", { correct: "a" });
    await assertFails(getDoc(doc(studentDb(OWNER_UID, OWNER_B10), "toeflItems/AP-006/answerKey", "key")));
  });

  it("a B10-PP student cannot create a TOEFL attempt, even as its owner", async () => {
    await assertFails(setDoc(doc(b10OnlyDb(OWNER_UID, OWNER_B10), "toeflAttempts", "TA-G1"), VALID_ATTEMPT));
  });

  it("a B10-PP student cannot create a TOEFL submission (it would start paid scoring)", async () => {
    await assertFails(setDoc(doc(b10OnlyDb(OWNER_UID, OWNER_B10), "toeflSubmissions", "TS-G1"), VALID_SUBMISSION));
  });

  it("a B10-PP student cannot update an existing TOEFL attempt", async () => {
    await seedToefl("toeflAttempts", "TA-G2", VALID_ATTEMPT);
    await assertFails(updateDoc(doc(b10OnlyDb(OWNER_UID, OWNER_B10), "toeflAttempts", "TA-G2"), { completedAt: null }));
  });

  it("an enrolled student still creates and completes their own attempt", async () => {
    await enroll(OWNER_B10);
    const db = studentDb(OWNER_UID, OWNER_B10);
    await assertSucceeds(setDoc(doc(db, "toeflAttempts", "TA-G3"), VALID_ATTEMPT));
    await assertSucceeds(updateDoc(doc(db, "toeflAttempts", "TA-G3"), { completedAt: null }));
  });

  it("an owner can still READ their own existing submission without enrollment (ownership, not new access)", async () => {
    await seedToefl("toeflSubmissions", "TS-G2", VALID_SUBMISSION);
    await assertSucceeds(getDoc(doc(b10OnlyDb(OWNER_UID, OWNER_B10), "toeflSubmissions", "TS-G2")));
  });
});

