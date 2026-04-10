# B10-PP SESSION LOG
## Date: April 3, 2026
## Author: Jeff Moore, DLIELC
## Session Type: Phase 3 Firebase Setup

---

## SESSION SUMMARY

Firebase Blaze upgrade completed via gcloud CLI after Console UI failures.
Firebase init completed — Firestore and Cloud Functions scaffolded.
Repo pushed and clean. Ready for Phase 3 Cloud Functions build.

---

## PART 1 — PHASE 2 VALIDATION (CARRIED OVER FROM APRIL 2)

All 9 validation steps passed:
1. Enter with test access code → Passage Menu loads ✅
2. Click passage card → Passage Detail loads ✅
3. Play audio (or simulate) → Begin Task button enables ✅
4. Click Begin Task → Recording Screen loads ✅
5. Click Record → browser requests microphone permission ✅
6. Click Stop/Submit → loading indicator "Analyzing your response..." appears ✅
7. After stub delay → Feedback Screen loads with full score display ✅
8. Click Retry → returns to Recording Screen with clean state ✅
9. Click Return to Menu → returns to Passage Menu ✅

Phase 2 status: ✅ COMPLETE AND VALIDATED

---

## PART 2 — MINOR UI FIX

DLIELC badge removed from Entry Screen per Jeff request.
Commit included in earlier session push.

---

## PART 3 — FIREBASE BLAZE UPGRADE

### Problem
Firebase Console UI spinner on Blaze upgrade — never completed.
Console billing page (linkedaccount URL) rendering blank in both Firefox and Chrome.

### Root cause identified
Project was auto-linked to "Firebase Payment" billing account (Google internal
account for Spark plan). Firebase Console was trying to swap accounts and timing out.

### Resolution path
1. Google Cloud Console confirmed three billing accounts:
   - Firebase Payment (01624C-4DF01B-FDBBD1) — auto-linked to project
   - Firebase Payment (016A60-67813E-5361E9) — unused
   - My Billing Account (01C98F-1F8713-DB95F1) — real account to use

2. Console UI circular — could not complete swap via browser.

3. Installed gcloud CLI:
   ```
   sudo apt install google-cloud-cli
   ```
   (Required adding Google's apt repo — not in standard Linux Mint repos)

4. Authenticated gcloud via browser (Chrome — Firefox clicks non-functional):
   ```
   BROWSER=google-chrome gcloud auth login
   ```

5. Linked billing account via CLI:
   ```
   gcloud billing projects link b10-practice-platform --billing-account=01C98F-1F8713-DB95F1
   ```

6. Result — confirmed success:
   ```
   billingAccountName: billingAccounts/01C98F-1F8713-DB95F1
   billingEnabled: true
   name: projects/b10-practice-platform/billingInfo
   projectId: b10-practice-platform
   ```

Firebase Console plan badge still showing "plan" (UI lag) but billing is confirmed
linked at the API level. Cloud Functions accessible — confirmed by successful firebase init.

---

## PART 4 — FIREBASE INIT

### Command
```
cd ~/b10_corpus/b10_practice_platform
firebase init
```

### Features selected
- Firestore: Configure security rules and indexes files ✅
- Functions: Configure a Cloud Functions directory ✅

### Configuration choices
- Project: b10-practice-platform (existing)
- Firestore rules file: firestore.rules (default)
- Firestore indexes file: firestore.indexes.json (default)
- Functions language: JavaScript
- ESLint: No
- Install dependencies now: (failed — ran manually)

### Manual npm install
```
cd functions && npm install
```
Result: 531 packages installed. Warnings about Node 24 requirement and deprecated
packages are non-critical. Node 20.20.2 is compatible.

### Files created
| File | Status |
|------|--------|
| firestore.rules | ✅ Created |
| firestore.indexes.json | ✅ Created |
| functions/index.js | ✅ Created |
| functions/package.json | ✅ Created |
| functions/.gitignore | ✅ Created |

### Git commit
Repo was already clean — Firebase init files committed in earlier push.
Final state: nothing to commit, working tree clean, up to date with origin/main.

---

## PART 5 — ARCHITECTURE DECISIONS MADE TODAY

| Decision | Rationale |
|----------|-----------|
| gcloud CLI as billing tool | Firebase Console UI non-functional for billing swap |
| Firefox avoided for Google Console | Clicks non-functional in billing/auth flows |
| Chrome set as default for gcloud auth | BROWSER=google-chrome env var |
| ESLint skipped | Unnecessary complexity for MVP |
| JavaScript (not TypeScript) for Functions | Simpler, faster for MVP build |

---

## PART 6 — PENDING ACTIONS (PHASE 3)

### Next session — start here
Run Phase 3 Cloud Functions build. See Monday Startup section.

### Full Phase 3 build order
1. Write `transcribe` Cloud Function (OpenAI Whisper API)
2. Write `score` Cloud Function (Anthropic Claude API)
3. Store API keys as Firebase environment secrets (never in frontend code)
4. Replace WhisperTranscriber.js stub with real Cloud Function call
5. Replace ClaudeScorer.js stub with real Cloud Function call
6. Write Firestore security rules
7. Wire Firestore session record writes after scoring returns
8. Firebase Authentication — instructor login
9. Instructor dashboard — Phase 3 build

### Deferred items (unchanged from April 2)
| Item | When |
|------|------|
| Update B10_PP_Spec_v0_1_FULL.md Section F (SA-001, SA-002) | Before Phase 3 complete |
| Update B10_PP_Governance_Log_002.md | Before Phase 3 complete |
| Generate pilot MP3 batch (5-10 CORE passages) via Azure TTS | Home machine |
| Re-test A1.18-A1.28 and A2.04 once MP3s available | After MP3 batch |
| ORIENT passages — export from Notion and canonize | Phase 4 |

---

*B10-PP Session Log — April 3, 2026 — DLIELC — Jeff Moore*
