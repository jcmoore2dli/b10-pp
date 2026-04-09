B10-PP repo-ready bundle

Files included:
- firestore.rules
- seed_users.json
- seed_userIndex.json
- seed_students.json
- seed_groups.json
- seed_notes.json
- seed_passages.json
- seed_assignments.json
- seed_attempts.json

Notes:
- This bundle preserves B10 ID as the canonical /students key.
- userIndex is the identity bridge from Firebase Auth UID to B10 ID.
- This is a Phase 2A / emulator-testing bundle, not a final production export/import package.
- Timestamps are ISO strings for readability and manual seeding.
