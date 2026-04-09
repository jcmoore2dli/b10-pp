PHASE 2A SPRINT EXECUTION SHEET (B10-PP)

GOAL
Implement and validate Firebase backend foundation:
- Firestore rules (v2)
- Seed data
- Identity bridge (/userIndex)
- Emulator validation


-----------------------------------
SECTION 1 — SETUP (COMMANDS)
-----------------------------------

1. Install / Verify Firebase CLI
firebase --version

If not installed:
npm install -g firebase-tools

2. Login
firebase login

3. Verify existing Firebase setup (from repo root)

Do NOT run firebase init. Firebase was already initialized in this project.

Verify the following files/folders exist:

ls

Expected:
- firebase.json
- firestore.rules
- firestore.indexes.json
- functions/

If any are missing, stop and resolve before continuing.

4. Start Emulator
firebase emulators:start

EXPECTED:
- Firestore emulator starts
- Emulator UI opens (http://localhost:4000)


-----------------------------------
SECTION 2 — LOAD SEED DATA (UI)
-----------------------------------

1. Open Emulator UI
http://localhost:4000

2. Go to Firestore tab

3. Manually create collections:

users
userIndex
students
passages
assignments
attempts

4. Copy-paste JSON from seed files into documents

CRITICAL ORDER:
1. users
2. userIndex
3. students
4. passages
5. assignments
6. attempts

EXPECTED:
- All collections appear
- Documents visible in UI


-----------------------------------
SECTION 3 — TESTS
-----------------------------------

TEST 1 — Identity Mapping

ACTION:
- Simulate user with UID: student_001_uid

CHECK:
- /userIndex/student_001_uid exists
- studentId = B10-A001

EXPECTED:
PASS

FAIL MEANS:
- userIndex missing
- mismatch with students


-----------------------------------

TEST 2 — Assignment Access

ACTION:
- Read assignments where studentId = B10-A001

EXPECTED:
PASS (own assignment)

TRY:
- Access assignment for B10-B001

EXPECTED:
FAIL

FAIL MEANS:
- rules incorrect
- mapping broken


-----------------------------------

TEST 3 — Attempt Access

ACTION:
- Read attempts for B10-A001

EXPECTED:
PASS

TRY:
- Read attempts for B10-B001

EXPECTED:
FAIL


-----------------------------------

TEST 4 — Passage Access

ACTION:
Login as Track A student (B10-A001)

TRY:
- Track A passage → PASS
- Track B passage → FAIL
- track="both" → PASS

Login as Track B student:
- inverse behavior

FAIL MEANS:
- track logic issue


-----------------------------------

TEST 5 — Write Constraints

ACTION:
- Try writing another student's data

EXPECTED:
FAIL

- Try invalid score (string or out of range)

EXPECTED:
FAIL

FAIL MEANS:
- rules too permissive


-----------------------------------
SECTION 4 — DEBUG CHECKPOINT
-----------------------------------

If ANY test fails:

CHECK:

1. /userIndex exists?
2. userId matches student?
3. studentId matches assignments?
4. track matches passages?
5. rules condition logic correct?

DO NOT:
- rewrite system
- expand scope

FIX ONLY:
- broken mapping
- incorrect rule condition


-----------------------------------
END STATE (SUCCESS)
-----------------------------------

✔ Student identity resolves correctly
✔ Students can only access own data
✔ Track-based passage filtering works
✔ Invalid writes blocked

You now have:
A WORKING BACKEND FOUNDATION


-----------------------------------
REMINDER
-----------------------------------

Do NOT:
- build UI
- optimize performance
- redesign schema

FOCUS:
Make the rules + identity model WORK
