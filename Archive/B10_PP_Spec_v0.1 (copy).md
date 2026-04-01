# B10 Practice Platform (B10-PP) — Product Specification
**Version:** 0.1 (Draft — In Progress)
**Author:** Jeff Moore, DLIELC
**Date:** March 2026
**Status:** DRAFT — Sections marked [APPROVED] are locked; all others pending review

---

## SECTION 1 — PRODUCT IDENTITY AND PURPOSE

### 1.1 Product Name and Designation
- **Full name:** B10 Practice Platform
- **Short name / code:** B10-PP
- **Predecessor tool:** Snorkl (currently in use, $120/month out-of-pocket; B10-PP is its replacement)

### 1.2 Institutional Context
B10-PP is developed by and for the Defense Language Institute English Language Center (DLIELC), San Antonio, Texas. It supports the B10 ILR 2→2+ Listening Practice Project, a scaffolded listening development system for international military students targeting ILR 2+ to ILR 3 proficiency.

B10-PP is **not** an OPI replacement. It is a formative practice and feedback platform aligned to the B10 passage corpus and scoring rubric.

### 1.3 Target Users

| Role | Description |
|------|-------------|
| **Student** | International military adult learner, current ILR 2, targeting ILR 2+/3. No single target L1. Uses B10-PP for independent or in-class listening practice. |
| **Instructor** | ESL/ILR proficiency instructor at DLIELC. Creates class codes, assigns passage sets, monitors student scores via dashboard. |

### 1.4 Core Purpose
B10-PP provides:
1. **Listening exposure** — students listen to B10 passages (CORE, EXT, or ORIENT layer) delivered as pre-generated audio (Azure TTS MP3s)
2. **Spoken response practice** — students record oral responses (paraphrase, ESO, or hypothetical/conditional) in the browser
3. **AI-powered scoring and feedback** — Claude API scores responses against the B10 4-point rubric and returns structured formative feedback
4. **Instructor visibility** — all session scores are accessible to the instructor via a class dashboard

### 1.5 What B10-PP Is NOT
- Not a multiple-choice platform (no MC items, ever)
- Not an ILR assessment tool (formative practice only)
- Not a server-dependent system (MVP is serverless; GitHub Pages + browser localStorage + third-party APIs)
- Not a replacement for human ILR evaluation or OPI

### 1.6 Deployment Target
- **Hosting:** GitHub Pages (static PWA)
- **Client OS compatibility:** Primary — Windows, Linux Mint; Secondary — iOS, Android (browser-based)
- **No native app install required** (Progressive Web App; installable but not required)

### 1.7 Development Model
B10-PP is built under the **Director Model**:
- Jeff Moore (DLIELC) = domain expert, spec author, quality gate, product director
- Claude Code = builder (iterative, checkpoint-based, spec-driven)
- No continuous hands-on coding by Jeff; redirections occur at defined review checkpoints

---

## SECTION 2 — TASK TYPES (placeholder — draft pending)

## SECTION 3 — STUDENT EXPERIENCE AND TASK FLOW (placeholder — draft pending)

## SECTION 4 — ACCESS, AUTH, AND CLASS CODE SYSTEM (placeholder — draft pending)

## SECTION 5 — PASSAGE MENU AND SELECTION (placeholder — draft pending)

## SECTION 6 — AUDIO DELIVERY (placeholder — draft pending)

## SECTION 7 — RECORDING AND TRANSCRIPTION (placeholder — draft pending)

## SECTION 8 — SCORING AND FEEDBACK (placeholder — draft pending)

## SECTION 9 — INSTRUCTOR DASHBOARD (placeholder — draft pending)

## SECTION 10 — DATA STORAGE (placeholder — draft pending)

## SECTION 11 — TECHNICAL STACK (placeholder — draft pending)

## SECTION 12 — MVP SCOPE AND BUILD ORDER (placeholder — draft pending)

## SECTION 13 — OUT OF SCOPE (placeholder — draft pending)

---
*B10 Practice Platform Spec — DLIELC — Jeff Moore — March 2026*
