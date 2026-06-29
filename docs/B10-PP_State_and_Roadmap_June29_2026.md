# B10-PP State and Roadmap — June 29, 2026

(Supersedes June 28, 2026 version)

---

## PLATFORM STATUS

**Live URL:** https://b10-practice-platform.web.app/b10_practice_platform/
**Firebase project:** b10-practice-platform (nam5, Blaze plan)
**Repo:** github.com/jcmoore2dli/b10-pp
**Project root:** ~/b10_corpus/b10_practice_platform/
**Frontend:** frontend/src/
**Functions:** functions/index.js, functions/lib/claudeScorer.js
**Latest commit:** 0a11be32 (Add feedback system — modal form, instructor Feedback tab, admin Feedback section, Firestore rules)
**Pilot launch date:** July 27, 2026 — confirmed hard date by supervisor (Vidal), not a target

---

## IST OUTCOME — June 5, 2026 (unchanged, retained for record)

- **Result:** Adoption declared a foregone conclusion in the room
- **Supervisor commitment:** Will provide instructor account setup timeline
- **Instructors:** ~6 want practice accounts; instructor practice account access intended to begin ~June 19
- **Launch date:** July 27 — confirmed hard date, the only launch milestone on this roadmap
- **TESOL 2027 proposal:** Submitted
- **MTT instructor meeting:** Held; relationship/scheduling resolved.

---

## BILLING STATUS (as of June 20 — not re-checked)

- **Anthropic:** $18.80 balance, auto-reload ON ($10 trigger, $20 add)
- **Deepgram:** $199.55 balance, Pay As You Go
- **Firebase:** Blaze plan, billing card confirmed
- **AssemblyAI:** Card on file — still unverified; carry forward to next billing check
- **ElevenLabs:** Creator plan cancelled June 20; access continues through July 20, then reverts to Free. Voice and settings saved for future resubscription.

---

## CORPUS STATUS

816 total passages live in Firestore (ORIENT 18, CORE 120, EXT 72, ESO-Bundled 60, ESO-Frames 48, ESO-General 192, NAR/DES/INS 306). Audio for ORIENT, CORE, and EXT (210 passages) fully regenerated with ElevenLabs voice June 20. ESO and NAR/DES/INS audio untouched.

**32 ESO passages tagged with `lfSubcategory` field (WFF/SV/SC/PI)** for Linguistic Flexibility track routing. These passages retain `corpusType: "ESO"` and are excluded from the assigned practice feed via UI filter.

---

## COMPLETED JUNE 27–28 (ISTE Conference, Orlando — Day 1)

### 1. Standard Operating Procedures (SOPs) — Three Documents
- **CORE Bundle Daily Protocol** — Main Instructor
- **ESO/Frames Daily Protocol** — Main Instructor
- **Linguistic Flexibility Protocol** — SLT Instructor

HTML + PDF. Deployed to `hosting/b10_practice_platform/materials/SOPs/`. Close button (`window.close()`) on all HTML files.

### 2. Memory Training Strategies (MTS) — Five HTML Reference Documents
MTS 1 Keyword Anchoring, MTS 2 Chunking + Immediate Rehearsal, MTS 3 Gist-First / Details-Second, MTS 4 Idea Skeleton (Propositional Reduction), MTS 5 Response Template (Output Scaffolding). Deployed to `hosting/b10_practice_platform/materials/CORE/`.

### 3. LF Question Loading — 32 Passages Tagged in Firestore
All 32 LF questions tagged with `lfSubcategory` (WFF/SV/SC/PI). Script: `tag_lf_passages.js`.

### 4. PassageMenuScreen.jsx — LF Subcategory Folders Wired
Four LF subcategory folders (WFF/SV/SC/PI) expandable with PassageCards. LF passages excluded from assigned practice feed.

### 5. CORE Reference Materials Folder (Student View)
Expandable folder at top of Bundle Sequence with 5 MTS links.

### 6. POI Section — Instructor Dashboard
Permanent Plan of Instruction section above tab bar. Three pill links: CORE Bundle, ESO/Frames Practice, LF — SLT Protocol.

### 7. Deploy Script Fixed
`npm run deploy` uses `rsync --exclude=materials`. Materials folder protected from future deploys.

### 8. Materials Backup Committed to Git
All materials HTMLs backed up to `docs/materials_backup/` and committed.

---

## COMPLETED JUNE 29 (ISTE Conference, Orlando — Day 2)

### 1. Instructor Dashboard Student Detail View — Reference Materials

Three new reference folder sections added to the `AttemptHistory` component in `InstructorDashboardScreen.jsx`:

- **CORE Bundle** — expandable Reference Materials folder with 5 MTS HTML links
- **Frames Practice** — expandable Reference Materials folder with W1-W6 subfolders, each containing all 6 frame phrase files + Grammar Stems + Frames Argument Builder
- **Linguistic Flexibility** — new LF section with Reference Materials subfolder (4 LF phrase HTMLs + Grammar Stems + Frames Argument Builder) and 4 subcategory folders (WFF/SV/SC/PI)

### 2. W1-W6 Materials Folder Structure Fixed

Each week folder now contains all 6 frame phrase files for that week (not just its own frame type). Structure:
- W1: `B10PP_W1_Scale_Stakeholder_Phrases.html`, `B10PP_W1_Tradeoffs_Constraints_Phrases.html`, `B10PP_W1_Causal_Systems_Phrases.html`, `B10PP_W1_Hypothetical_Conditional_Phrases.html`, `B10PP_W1_Values_Heuristics_Bias_Phrases.html`, `B10PP_W1_Synthesis_Judgment_Phrases.html`, `B10PP_Grammar_Stems_All_Weeks.html`, `B10PP_Frames_Argument_Builder.html`
- W2-W6: same pattern with week-specific filenames

Materials backup updated to match. All 36 missing files committed to `docs/materials_backup/`.

### 3. Feedback System — Full Implementation

**Firestore schema — `/feedback` collection:**
- `type` — "core" / "eso" / "general"
- `category` — "level_concern" / "content_error" / "scoring_issue" / "platform_problem" / "suggestion" / "other"
- `description` — free text, required
- `transcript` — free text, optional
- `submittedBy` — b10Id
- `role` — "instructor" / "student"
- `timestamp` — Firestore server timestamp

**UI display labels:** Level Concern / Content Error / Scoring Issue / Platform Problem / Suggestion / Other

**Components built:**
- `FeedbackModal` — 4-field form (Type, Category, Description, Transcript). Accessible via Feedback button in nav bar on both `PassageMenuScreen.jsx` and `InstructorDashboardScreen.jsx`. Available to all signed-in users.
- `FeedbackView` — read-only list, newest first, with type badge, category, description, transcript, submitted by, timestamp. Accessible to instructors via Feedback tab in dashboard; accessible to admin via Pilot Feedback section at bottom of admin screen.

**Firestore security rules:** `/feedback` collection rule added — any signed-in user can create; only instructors and admins can read; no updates; admin-only delete.

**Verified end-to-end:** Student submission confirmed, instructor Feedback tab confirmed, admin Pilot Feedback section confirmed.

---

## ARCHITECTURE — CURRENT STATE

### Materials Folder Structure

```
hosting/b10_practice_platform/materials/
  W1/   — 8 HTMLs: B10PP_W1_[all 6 frames]_Phrases.html + Grammar Stems + Frames Argument Builder
  W2/   — 8 HTMLs: B10PP_W2_[all 6 frames]_Phrases.html + shared files
  W3/   — same pattern
  W4/   — same pattern
  W5/   — same pattern
  W6/   — same pattern
  LF/   — 6 HTMLs: 4 LF phrase HTMLs + Grammar Stems + Frames Argument Builder
  CORE/ — 5 MTS HTMLs (MTS1–MTS5)
  SOPs/ — 3 SOP HTMLs (CORE, ESO/Frames, LF)
```

### LF Track Architecture (fully wired)

- FLEX_01–FLEX_04 rubrics live in `SCAFFOLD_RUBRICS` in `claudeScorer.js` ✅
- `primaryFlex` mapped from instructor UI to FLEX codes in `InstructorDashboardScreen.jsx` ✅
- `primaryFlex` flows through `index.js` as `primaryTarget` ✅
- 32 questions tagged in Firestore with `lfSubcategory` ✅
- PassageMenuScreen filters and displays by subcategory (student view) ✅
- InstructorDashboardScreen shows LF section with reference materials (instructor view) ✅

### Feedback System

- `/feedback` Firestore collection — live and accepting writes
- `FeedbackModal` component — in `PassageMenuScreen.jsx` and `InstructorDashboardScreen.jsx`
- `FeedbackView` component — in `InstructorDashboardScreen.jsx` (Feedback tab) and `AdminScreen.jsx` (Pilot Feedback section)
- Firestore rules deployed

### Deploy Safety

- `npm run deploy` from `frontend/` — only valid deploy command
- Uses `rsync --exclude=materials` — materials folder never overwritten by frontend deploy
- Materials backup at `docs/materials_backup/` — committed to git
- Recovery if materials wiped: `cp -r docs/materials_backup/* hosting/b10_practice_platform/materials/ && firebase deploy --only hosting`

---

## KNOWN ISSUES / PENDING

### Low priority — post-pilot:
- Feedback button visible to admins in nav bar (harmless — admin can submit feedback to themselves; post-pilot cleanup)
- Scaffold rubric norming — ongoing, tied to real pilot data
- Audio playback re-enable — blocked on formal privacy guidance
- PII transcript filter — post-pilot
- Bulk student assignment / pre-load sequence — lower urgency
- Hard reload 404 on deep routes — do not fix before pilot
- URL simplification (root path) — post-pilot
- AssemblyAI billing card — still unverified
- EXT CSV row-count discrepancy (73 vs. 72) — low priority

---

## PRE-LAUNCH LOGISTICS (remaining before July 27)

All technical platform work is complete. Remaining tasks are operational:

1. Distribute instructor and demo B10-PP IDs
2. IST newsletter
3. Implementation meeting — week of July 27
4. MTT instructor pre-load (CORE passages, time limits)
5. Instructor familiarization period — July 14–26

---

## PILOT PARAMETERS

- **Launch:** July 27, 2026
- **Duration:** 6 weeks
- **Students:** 10–20
- **Instructors:** 2–3 Main + SLT
- **Scaffold criteria for norming:** 17

---

## KEY FILES

### Application
- `functions/index.js` — processSubmission, cleanupAudio, createInstructorAccount, lookupStudent, generateProgressSummary
- `functions/lib/claudeScorer.js` — all scoring prompts + SCAFFOLD_RUBRICS (FLEX_01–04 wired)
- `frontend/src/screens/LoginScreen.jsx` — B10 ID login
- `frontend/src/screens/InstructorDashboardScreen.jsx` — instructor dashboard, POI section, roster, assignments, CORE/Frames/LF reference materials, Feedback tab, FeedbackModal, FeedbackView
- `frontend/src/screens/PassageMenuScreen.jsx` — student passage menu, Bundle Sequence (CORE Reference Materials/MTS), Frames Practice (W1-W6 Reference Materials), LF section (LF Reference Materials + 4 subcategory folders), FeedbackModal
- `frontend/src/screens/AdminScreen.jsx` — access code management, instructor account creation, Pilot Feedback section, FeedbackView
- `frontend/src/screens/RecordingScreen.jsx` — recording + speaking guides
- `frontend/src/screens/FeedbackScreen.jsx` — immediate feedback display (student)
- `frontend/src/context/AuthProvider.jsx` — auth context with refreshClaims
- `firebase/firestore.rules` — security rules including /feedback collection
- `governance/B10-PP_AI_Provider_Portability_Audit_v1.md` — AI provider portability audit

### Instructional Materials
- `docs/sops/` — 3 SOP HTML + PDF files
- `docs/memory_training_strategies/` — 5 MTS HTML files
- `docs/materials_backup/` — full backup of all hosting materials HTMLs (committed to git)

### Deploy
- `frontend/package.json` — deploy script uses `rsync --exclude=materials`
- `tag_lf_passages.js` — Firestore tagging script for 32 LF passages (one-time, completed)

### Audio Pipeline
- `docs/Canonized 2ff2fc7288bd80d18463dcb42428dcdc_all.csv` — canonical passage export
- `generate_core_audio.py / sync_core_audio.py` — CORE batch
- `generate_orient_audio.py / sync_orient_audio.py` — ORIENT batch
- `generate_ext_audio.py / sync_ext_audio.py` — EXT batch
- `key/b10-pp-firebase-adminsdk-260525.json` — confirmed-working Firebase Admin SDK credentials

---

END OF DOCUMENT — June 29, 2026
