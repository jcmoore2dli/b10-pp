# B10-PP MONDAY STARTUP
## Next session: Phase 3 — Cloud Functions Build
## Date written: April 3, 2026

---

## STEP 1 — PASTE THESE TWO THINGS INTO A NEW CLAUDE SESSION

1. The contents of `B10_PP_Project_Continuation_Prompt_v1.md`
2. This handoff note (copy and paste everything below the line):

---

## HANDOFF NOTE FOR MONDAY

Project: B10 Practice Platform (B10-PP) — github.com/jcmoore2dli/b10-pp
Session log: B10_PP_Session_Log_2026-04-03.md

**Status:** Phase 3 Firebase setup complete. Ready to build Cloud Functions.

**Completed as of April 3, 2026:**
- Phase 2 validated (all 9 steps passed)
- Firebase project: b10-practice-platform (Blaze plan — billing linked via gcloud CLI)
- Firestore database: created (nam5, production mode)
- Authentication: enabled (Email/Password)
- Firebase init: complete — Firestore + Functions scaffolded
- functions/index.js, firestore.rules, firestore.indexes.json all created
- functions npm install: complete (531 packages)
- Repo: clean, pushed, up to date with origin/main

**Next task — Phase 3 Cloud Functions:**

Build in this exact order:

1. `transcribe` Cloud Function
   - Receives audio blob (base64) from frontend
   - Calls OpenAI Whisper API
   - Returns { transcript: string }
   - OpenAI key stored as Firebase secret — never in frontend

2. `score` Cloud Function
   - Receives { transcript, passageText, passageId }
   - Calls Anthropic Claude API with B10 4-point rubric
   - Returns { score, score_label, strengths, gaps, language_note }
   - Anthropic key stored as Firebase secret — never in frontend

3. Replace stubs
   - WhisperTranscriber.js → calls transcribe Cloud Function via httpsCallable
   - ClaudeScorer.js → calls score Cloud Function via httpsCallable

4. Firestore session record write
   - After scoring returns, write record to Firestore
   - Fields: passageId, score, transcript, timestamp, accessCode, studentId

5. Firestore security rules
   - Students: write only (no read)
   - Instructors: read all records under their access codes

6. Firebase Authentication
   - Wire instructor login to Email/Password provider

**Key governance rules to enforce:**
- API keys NEVER in frontend code
- Audio NEVER stored — blob released after transcription
- ScoringService.evaluate() is sole entry point from UI — never call ClaudeScorer directly
- Do not touch passages.json, EntryScreen, PassageMenu in this phase

**Have ready before starting:**
- OpenAI API key (for Whisper)
- Anthropic API key (for Claude scoring)
- These will be stored as Firebase secrets during the build session

---

## STEP 2 — PULL LATEST REPO

```bash
cd ~/b10_corpus/b10_practice_platform
git pull
```

---

## STEP 3 — START DEV SERVER

```bash
cd frontend
npm run dev
```

Confirm app loads at http://localhost:5173/b10_practice_platform/

---

## STEP 4 — TELL CLAUDE CODE TO BEGIN PHASE 3

Open Claude Code terminal and say:

"Begin Phase 3 Cloud Functions build. Start with the transcribe function."

---

*B10-PP Monday Startup — April 3, 2026 — Jeff Moore*
