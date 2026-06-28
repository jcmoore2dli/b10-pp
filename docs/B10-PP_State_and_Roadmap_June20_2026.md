# B10-PP State and Roadmap — June 20, 2026

(Supersedes June 18, 2026 version)

---

## PLATFORM STATUS

**Live URL:** https://b10-practice-platform.web.app/b10_practice_platform/
**Firebase project:** b10-practice-platform (nam5, Blaze plan)
**Repo:** github.com/jcmoore2dli/b10-pp
**Project root:** ~/b10_corpus/b10_practice_platform/
**Frontend:** frontend/src/
**Functions:** functions/index.js, functions/lib/claudeScorer.js
**Latest commit:** f1b3048 (instructor Summary/Scaffold Feedback/Transcript Note parity — deployed and verified live)
**Pilot launch date:** July 27, 2026 — confirmed as a hard date by supervisor (Vidal), not a target

---

## IST OUTCOME — June 5, 2026 (unchanged, retained for record)

- **Result:** Adoption declared a foregone conclusion in the room
- **Supervisor commitment:** Will provide instructor account setup timeline
- **Instructors:** ~6 want practice accounts; instructor practice account access intended to begin ~June 19, giving a 2-week head start before launch — this is not a separate launch event, just instructor familiarization time ahead of the single launch date below
- **Launch date:** July 27 — confirmed hard date, the only launch milestone on this roadmap
- **TESOL 2027 proposal:** Submitted
- **MTT instructor meeting:** Held; relationship/scheduling resolved. The dedicated "CORE-only restricted account" feature originally scoped for this (see June 7 item 8) has been removed from the roadmap — see KNOWN ISSUES / PENDING below for why.

---

## BILLING STATUS (as of June 20)

- **Anthropic:** $18.80 balance, auto-reload ON ($10 trigger, $20 add) — not re-checked this session
- **Deepgram:** $199.55 balance, Pay As You Go — not re-checked this session
- **Firebase:** Blaze plan, billing card confirmed
- **AssemblyAI:** Card on file — still unverified; carry forward to next billing check
- **ElevenLabs (new):** Creator plan subscribed and used for the June 20 audio voice migration (~$11 first-month rate). Subscription cancelled June 20; access continues through end of billing cycle (July 20), then reverts to Free with no further charge. Voice ("Nichalia Schwartz – Bright and Friendly") and tuned settings remain saved on the account for future resubscription if needed.

---

## CORPUS STATUS

816 total passages live in Firestore (ORIENT 18, CORE 120, EXT 72, ESO-Bundled 60, ESO-Frames 48, ESO-General 192, NAR/DES/INS 306) — passage counts unchanged since June 7/18. **Audio for ORIENT, CORE, and EXT (210 passages) was fully regenerated and re-synced June 20** — see COMPLETED JUNE 20 below. ESO and NAR/DES/INS audio untouched, still on original voice.

---

## COMPLETED JUNE 19–20

### TTS Voice Migration: Azure → ElevenLabs

**Background:** Original Azure Neural voice ("Jenny," slowed rate) flagged by a remote IST instructor for unclear intonation/stress, particularly compound noun stress in early passages. Originally a stopgap chosen for ease of implementation.

**Vendor evaluation:** Compared ElevenLabs, OpenAI TTS (gpt-4o-mini-tts), Google Cloud TTS, Amazon Polly, and Rime (Mist v2/Coda) on naturalness, cost, ease of integration, and specifically on compound-noun-stress handling. OpenAI tested well and is meaningfully cheaper/simpler to integrate (~$2–5 for the full corpus vs. ElevenLabs' subscription model), but ElevenLabs was selected based on direct listening tests across multiple difficult passages, plus its pronunciation-dictionary/voice-settings calibration options.

**Voice selected:** Nichalia Schwartz – "Bright and Friendly" (ElevenLabs Voice Library)
- **Model:** Eleven Multilingual v2 for CORE and ORIENT (formal narration register)
- **Model:** Eleven Flash v2.5 for EXT (lecture-style register; also necessary to stay within Creator plan's 121,000 monthly credit allowance — Multilingual v2 for the full EXT batch would have exceeded it)
- **Settings:** stability 76%, similarity boost 80%, style exaggeration 0%, speaker boost on, speed 1.05, output MP3 44.1kHz/128kbps

**Production pipeline built:** Python scripts (CSV → ElevenLabs API → local MP3 → Firebase Storage → Firestore `audioPath`/`audioGeneration` field update), run from `~/b10_corpus/b10_practice_platform/`. Pattern: separate generation and sync scripts per corpus segment, each producing a manifest/sync-log CSV for audit trail. Firestore writes gated by a pre-check (document must already exist) to prevent stray document creation from malformed IDs.

**Batch results:**
- CORE: 120/120 generated and synced (Multilingual v2)
- ORIENT: 18/18 generated and synced (Multilingual v2)
- EXT: 72/72 generated and synced — 62 in the main batch (Flash v2.5) + 10 additional passages that were content-complete but mismarked as `Draft`/`Not Started` in Notion, caught and processed separately

**Data-integrity issues found and fixed during sync (all via direct verification against live Firestore, not assumed):**
1. 3 CORE passages (`COR-BIO-007`, `COR-TEC-032`, and one with a stray-space ID) had corrupted `Name` values in the Notion/Canonized CSV export — a duplicate-suffix artifact (` (1)`) from the export tool colliding an old Inactive row with the current Active one. Fixed by re-syncing under the correct clean IDs.
2. 1 ORIENT duplicate: `OR-14-ENV` appeared twice in Notion with different text. Resolved by renaming the second occurrence to `OR-15-PHY`, which also filled a gap in the existing ID sequence — confirming it was a mislabel, not a true duplicate.
3. 1 EXT content-drift case (`EXT-GOV-001`): Firestore's stored `passageText` was an older draft that didn't match the current Notion/CSV version, which is what the new audio was generated from. Fixed by updating `passageText` to match (confirmed correct version via author judgment, since `actualMechanism`/`commonAssumption` scoring fields fit both versions equally and couldn't disambiguate).
4. 10 EXT passages were content-complete but never promoted to `Validated` status in Notion — processed as a targeted batch after confirming via text-match that Firestore already held matching content.

**Verification methodology established:** A read-only script compares each synced passage's generation-source text (from CSV) against its live Firestore `passageText` field, catching content mismatches the existence-check alone can't. Run against all three segments (CORE, ORIENT, EXT) post-sync; an earlier version of this script had a bug (didn't filter by `Status` when an ID had multiple CSV rows from revision history), which produced 7 false-positive mismatches on first run — corrected and re-verified clean. **Lesson for future scripts touching this CSV: always filter by Status/Library Segment explicitly, even in "just checking" scripts, since passage IDs frequently have multiple rows from revision history.**

**Known open item, not yet investigated:** EXT CSV export shows 73 rows total against a clean 1–72 sequence visible in Notion — likely the same export-collision pattern as the COR-BIO-007/COR-TEC-032 issue, but not yet traced to a specific row. Does not block anything currently synced.

---

## ARCHITECTURE — CURRENT STATE

### Login Flow, Roster System, Scaffold Pipeline, Audio Retention
Unchanged from June 7/18 — see those documents for full detail.

### Bundle/Frames Reference Pattern, Instructor/Student Feedback Parity, AI Provider Dependency
Unchanged since June 18 — see that document's Architecture section.

### Audio Generation Pipeline (new since June 18)
- Standalone Python scripts (not part of the Cloud Functions deploy) handle TTS generation and Firebase sync for CORE/ORIENT/EXT passage audio. Credentials: `key/b10-pp-firebase-adminsdk-260525.json` (Firebase Admin SDK service account — note: two other credential files exist in the repo, `service-account.json` and `firebase/service-account.json`; only the `key/` one is confirmed working, the other two should be treated as candidates for cleanup, not assumed equivalent).
- ElevenLabs API key scoped narrowly (Text to Speech: Access, Voices: Read, History: Read, all Administration permissions: No Access) with a per-key credit cap as a safety ceiling against runaway scripts.
- Storage convention: `audio/corpus/{COR|ORI|EXT}/{passageId}.mp3`, matching `corpusType` field values (note: ORIENT's `corpusType` is `"ORI"`, not `"ORIENT"`).

---

## KNOWN ISSUES / PENDING

### Resolved since June 18 (moved out of pending):
- ✅ Azure TTS voice quality complaint (compound noun stress) — resolved via full ElevenLabs migration, see COMPLETED JUNE 19–20

### New, low priority:
- **EXT CSV row-count discrepancy (73 vs. 72)** — likely an export-collision artifact like the CORE ID-corruption issue; not yet traced to a specific row, doesn't block anything currently synced
- **Three Firebase service account credential files** in the repo (`service-account.json`, `key/b10-pp-firebase-adminsdk-260525.json`, `firebase/service-account.json`) — only one confirmed working; consolidate and remove the other two when convenient
- **Notion export Name-field corruption pattern** — recurring issue (hit twice: CORE and ORIENT) where revising a passage and re-exporting can produce a malformed `Name` value via duplicate-suffix collision with the old Inactive row. Worth a process fix upstream if revising passages becomes more frequent.

### Still open, unchanged from June 18:
- Scaffold rubric norming — ongoing, tied to real pilot data
- Audio playback re-enable — still blocked on formal privacy guidance
- PII transcript filter — Sept–Oct 2026, post-pilot
- Bulk student assignment / pre-load sequence — lower urgency, see June 18 reframing
- Hard reload 404 on deep routes — do not fix before pilot
- URL simplification (root path) — post-pilot
- AssemblyAI billing card — still unverified

---

## PILOT PARAMETERS

Unchanged from June 18 — see that document for full detail (launch July 27, 6-week duration, 10–20 students, 2–3 instructors + SLT, 17 scaffold criteria for norming).

---

## PRE-LAUNCH LOGISTICS

Unchanged from June 18 — distribute instructor/demo IDs, IST newsletter, implementation meeting week of July 27, MTT instructor pre-load.

**Calendar constraint (unchanged):** Orlando conference June 27–July 1, NYC family trip July 6–9. Audio voice migration work (June 19–20) completed inside the pre-Orlando window as planned.

---

## POST-IST FEATURE REQUESTS (from instructors) — status update

Unchanged from June 18 — items 1–4 and 6 done, item 5 (bulk assignment) pending, lower urgency.

---

## SECURITY / COMPLIANCE STATUS

Unchanged from June 18. Audio voice migration does not affect SORN/ATO/PIA posture — same retention policy (72-hour deletion) applies regardless of TTS vendor; new audio is pre-generated reference material, not user-submitted content, so the existing privacy framework already covers it without modification.

---

## NEXT SESSION PRIORITIES

1. Pre-launch logistics: instructor/demo ID distribution, IST newsletter, implementation meeting prep for week of July 27
2. Mobile training instructor setup: pre-load CORE passages, enable time limits for that group
3. Investigate EXT CSV row-count discrepancy (73 vs. 72) — low priority
4. Consolidate/clean up redundant Firebase service account credential files
5. Scaffold rubric norming, as real pilot data starts coming in
6. Bulk assignment / pre-load sequence — lower priority backlog item

---

## KEY FILES

### Application (unchanged from June 18)
- functions/index.js — processSubmission, cleanupAudio, createInstructorAccount, lookupStudent, generateProgressSummary
- functions/lib/claudeScorer.js — all scoring prompts + SCAFFOLD_RUBRICS (FLEX_01–04 included)
- frontend/src/screens/LoginScreen.jsx — B10 ID login
- frontend/src/screens/InstructorDashboardScreen.jsx — instructor dashboard, roster, assignments, Bundle Sequence/Frames Practice folders, expanded attempt feedback view
- frontend/src/screens/PassageMenuScreen.jsx — student passage menu, My Progress, Bundle Sequence/Frames Practice folders with S#.# labels
- frontend/src/screens/RecordingScreen.jsx — recording + speaking guides
- frontend/src/screens/FeedbackScreen.jsx — immediate feedback display (student)
- frontend/src/screens/AdminScreen.jsx — access code + instructor account creation
- frontend/src/context/AuthProvider.jsx — auth context with refreshClaims
- firebase/firestore.rules — security rules
- governance/B10-PP_AI_Provider_Portability_Audit_v1.md — AI provider portability audit

### Audio pipeline (new, June 20)
- docs/Canonized 2ff2fc7288bd80d18463dcb42428dcdc_all.csv — current canonical passage export (supersedes the June 20-dated "Canonized 26 06 20_A/B.csv" files)
- generate_core_audio.py / sync_core_audio.py — CORE batch generation and Firestore/Storage sync
- generate_orient_audio.py / sync_orient_audio.py — ORIENT batch generation and sync
- generate_ext_audio.py / sync_ext_audio.py — EXT main batch generation and sync
- process_pending_ext.py — targeted script for the 10 mismarked-Draft EXT passages
- verify_ext_sync.py / verify_core_orient_sync.py — read-only content-drift verification (compares CSV source text against live Firestore `passageText`)
- key/b10-pp-firebase-adminsdk-260525.json — confirmed-working Firebase Admin SDK credentials (see Known Issues re: redundant credential files)
- audio/core_full_manifest.csv, audio/orient_full_manifest.csv, audio/ext_full_manifest.csv — generation audit logs
- audio/core_sync_log.csv, audio/orient_sync_log.csv, audio/ext_sync_log.csv — Firebase sync audit logs

---

END OF DOCUMENT — June 20, 2026
