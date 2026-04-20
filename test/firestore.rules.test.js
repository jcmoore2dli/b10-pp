const { readFileSync } = require("fs");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc, updateDoc, deleteDoc } = require("firebase/firestore");

const PROJECT_ID = "b10-practice-platform";
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
