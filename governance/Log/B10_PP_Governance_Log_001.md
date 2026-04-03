# B10-PP DAILY GOVERNANCE LOG

---

**Date:** March 31, 2026
**Session Duration:** Uncertain — single extended session (Sunday)
**Logged by:** Jeff Moore, DLIELC
**Log version:** 001

---

## CURRENT PHASE
Pre-build — Specification development

## FOCUS AREA
B10-PP Product Specification v0.1 — full document draft from Section 1 through Section 13

---

## WORK COMPLETED

- Reviewed and discussed article on Claude Code Channels (VentureBeat, March 20, 2026) as context for B10-PP platform concept
- Established B10-PP as the replacement for Snorkl ($120/month out-of-pocket) using GitHub Pages + Claude API + Whisper API
- Confirmed PWA architecture: React + Vite, GitHub Pages hosting, Firebase cloud datastore, no custom backend server
- Confirmed tool naming: B10 Practice Platform / B10-PP (rejected "B11", "B10-LAB", "app")
- Confirmed director model: Jeff Moore = spec author and quality gate; Claude Code = builder
- Confirmed Linux Mint as primary development OS — verified compatible with full stack
- Drafted B10 Master Orientation Prompt v1 — paste-ready reentry document capturing full B10 system architecture
- Drafted B10-PP Spec v0.1 — all 13 sections completed:
  - Section 1: Product Identity and Purpose
  - Section 2: Task Types
  - Section 3: Student Experience and Task Flow
  - Section 4: Access, Auth, and Class Code System
  - Section 5: Passage Menu and Selection
  - Section 6: Audio Delivery
  - Section 7: Recording and Transcription
  - Section 8: Scoring and Feedback
  - Section 9: Instructor Dashboard
  - Section 10: Data Storage
  - Section 11: Technical Stack
  - Section 12: MVP Scope and Build Order
  - Section 13: Out of Scope
- Assembled all 13 sections into single unified document: B10_PP_Spec_v0_1_FULL.md (1,581 lines)
- Conducted targeted revisions to Section 2.5 (pipeline storage model — two rounds)
- Conducted targeted revisions to Section 3 (Begin Task gating, Retry emphasis tone, Section 8 cross-reference)
- Conducted targeted revisions to Section 9 (removed all average-based metrics and score distribution)
- Generated B10 PWA Architecture diagram (exploratory reference — predates spec; domain labels in diagram do not reflect final B10 domain taxonomy)

---

## FILES CREATED / MODIFIED

- `B10_Master_Orientation_Prompt_v1.md` — created
- `B10_PP_Spec_Section2_draft.md` — created; revised twice
- `B10_PP_Spec_Section3_draft.md` — created; revised once
- `B10_PP_Spec_Section4_draft.md` — created
- `B10_PP_Spec_Section5_draft.md` — created
- `B10_PP_Spec_Section6_draft.md` — created
- `B10_PP_Spec_Section7_draft.md` — created
- `B10_PP_Spec_Section8_draft.md` — created
- `B10_PP_Spec_Section9_draft.md` — created; revised once
- `B10_PP_Spec_Section10_draft.md` — created
- `B10_PP_Spec_Sections11_12_13_draft.md` — created
- `B10_PP_Spec_v0_1_FULL.md` — assembled from all section drafts
- `b10-pwa-architecture.html` — created (exploratory reference only; predates spec)

---

## DECISIONS MADE

- **Tool name:** B10 Practice Platform / B10-PP (locked)
- **No multiple choice:** Confirmed by design — no MC items ever in B10-PP
- **MVP task type:** Oral Paraphrase only (Phase 1); ESO and Hypothetical deferred to Phase 2
- **Audio model:** Pre-generated Azure TTS MP3s stored statically on GitHub Pages — no runtime TTS
- **Voice selection:** One standard Azure neural voice for all passages — specific voice deferred to build time; pilot batch of 5–10 passages required before full generation
- **Transcription service:** OpenAI Whisper API ($0.006/min) — MVP only
- **Recording time limit:** Configurable by instructor at code creation — no platform default enforced
- **Storage model:** Firebase (Google) as cloud datastore — permanent storage for all session data; localStorage = temporary buffer only
- **Data retention:** Indefinite — no automatic deletion in MVP
- **Data export:** No CSV export in MVP — dashboard access only
- **Audio storage:** Never stored permanently — hard architectural requirement
- **Student access model:** Access code + name/ID — no account or password required
- **Instructor auth:** Firebase Authentication — username and password — MVP only
- **Access code creation:** Instructor self-service inside dashboard
- **Access code scope:** Group + assigned passage set + optional time window; no open-ended access
- **Access code expiration:** Configurable time window; manual deactivation available anytime
- **Browse library:** Open for student attempts; tagged as independent_practice; visible to instructor under separate dashboard view
- **Dashboard organization:** Two-level — summary across all codes + drill-down by code
- **Dashboard updates:** Real-time via Firebase live listeners
- **Dashboard metrics:** Raw scores, completion counts, attempt history, transcripts only — no averages, no score distribution
- **Feedback language:** English only — no L1 translation in MVP
- **Transcript display:** Shown to student on feedback screen labeled "What we heard you say:"
- **Passage text reveal:** Shown to student on feedback screen only — never during task
- **Scoring:** Claude API, 4-point rubric only — no ILR level estimate, no B10 performance label in MVP
- **API key security:** Keys must be proxied via Firebase Cloud Functions — never exposed in frontend
- **Build model:** Director model — 4 checkpoint reviews by Jeff Moore
- **Development OS:** Linux Mint (primary)
- **Frontend framework:** React + Vite
- **Hosting:** GitHub Pages
- **Prosody visualizer (Tool B):** Separate build — not part of B10-PP MVP

---

## ISSUES / BLOCKERS

- Section 2.5 initially contained internally inconsistent storage language ("Score logged to localStorage and instructor dashboard") — localStorage is browser-local and cannot serve as shared data source for instructor dashboard
- Section 3 initial draft used overly rigid gating language for Begin Task button
- Section 3 initial draft used prescriptive tone for Retry emphasis
- Section 9 initial draft included average-based metrics (avg score) and score distribution — not aligned with MVP dashboard decision
- B10 Master Orientation Prompt v1 references Puerto Rican adult ESL context from earlier project documentation — this does not reflect current target population (international military students, diverse L1 backgrounds)

---

## RESOLUTIONS

- Section 2.5 revised twice — storage model corrected to Firebase cloud datastore as permanent layer; localStorage demoted to temporary buffer only; Claude input line broadened to task metadata (not passage-only)
- Section 3 revised — Begin Task gating softened to encouragement framing; Retry tone revised to encouraging; Section 8 cross-reference added
- Section 9 revised — all avg score fields and score distribution removed; dashboard relies on raw scores, counts, and trajectory only
- Puerto Rican ESL context flag noted in orientation prompt — Jeff to verify and correct Section 1 of orientation prompt before next session use

---

## ALIGNMENT CHECK

**Does work align with spec? Y**

**Notes:**
- All 13 spec sections drafted and assembled into single document
- All major architectural decisions made during session are reflected in the spec
- One known inconsistency flagged: B10 Master Orientation Prompt v1 population description requires correction before use (see Issues above)
- Exploratory PWA architecture diagram (created earlier in session) contains domain labels (Military, Medical, Logistics, Civilian Affairs) that do not reflect the B10 canonical domain taxonomy — diagram is reference only and should not be used as a spec input

---

## NEXT STEPS

- Jeff reviews B10_PP_Spec_v0_1_FULL.md in full — section by section — and marks approved sections
- Correct B10 Master Orientation Prompt v1: update population description to reflect international military students (diverse L1 backgrounds); update tool name to B10-PP
- Select Azure TTS neural voice — generate pilot batch of 5–10 passages for Jeff review before full corpus generation
- Develop ESO rubric and Hypothetical rubric (required before Phase 2 build — not blocking MVP)
- Begin Claude Code build — Phase 1: Scaffold and Static Layer
- Confirm Firebase project setup and API key provisioning before Phase 2 build begins

---

## CLAUDE PERFORMANCE NOTES

- Correctly read and synthesized 11 uploaded files (PDF and TXT) covering full B10 architecture before drafting orientation prompt
- Correctly flagged inconsistency between Puerto Rican ESL population description in uploaded documentation and Jeff's stated target population during conversation
- Correctly identified and flagged internal inconsistency in Section 2.5 storage model before revision was requested — then revised accurately when formally instructed
- Section 9 initially included average-based metrics not aligned with MVP decisions — required correction via explicit instruction; not self-identified
- Exploratory architecture diagram (Screen 03) retained multiple choice label — inconsistent with confirmed no-MC design decision; not self-corrected until flagged
- All targeted revisions (Sections 2, 3, 9) executed accurately without rewriting unaffected content
- Spec tone and structure maintained consistently across all 13 sections
- Assembly of full document from 11 source files executed correctly — all 13 section headers confirmed present, placeholders removed

---
*B10-PP Daily Governance Log 001 — DLIELC — Jeff Moore — March 31, 2026*
