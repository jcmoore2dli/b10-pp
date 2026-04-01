# B10-PP PROJECT CONTINUATION PROMPT
## For use at the start of any new Claude session
## Version: 1.0 — March 31, 2026
## Author: Jeff Moore, DLIELC

---

## SECTION A — WHO I AM AND WHAT THIS PROJECT IS

I am Jeff Moore, GS-11 ESL instructor and ILR proficiency specialist at the Defense Language Institute English Language Center (DLIELC), San Antonio, Texas.

I am building the **B10 Practice Platform (B10-PP)** — a web-based listening and spoken response practice platform for international military adult learners targeting ILR 2+ proficiency. Students come from diverse national and linguistic backgrounds. There is no single target L1. Content domains are civilian and general — no military-specialist knowledge required.

B10-PP replaces Snorkl, a third-party tool I currently pay $120/month out of pocket. B10-PP will be free to host (GitHub Pages) with minimal API costs (~$0.01 per student session).

---

## SECTION B — B10 CORPUS ARCHITECTURE (DO NOT COLLAPSE OR REDEFINE)

B10-PP delivers content from the B10 ILR 2→2+ Listening Practice Project. The corpus has THREE architecturally distinct layers:

### LAYER 1: ORIENT
- ~16 passages
- 3 fixed discourse patterns only
- CEFR B0–B1 lexical ceiling
- Purpose: discourse pattern orientation

### LAYER 2: CORE
- 120 passages planned; 18 canonized as of March 2026
- 70–87 words each
- Three tiers defined by MF (mid-frequency) word count ONLY:
  - Tier 0: 1–2 MF words
  - Tier 1: 3–6 MF words
  - Tier 2: 6–10 MF words
- Structure is IDENTICAL across all tiers — tier = lexical density only

### LAYER 3: EXT
- 72 passages planned
- 120–185 words each
- Three length bands: EXT-S (120–140), EXT-M (141–165), EXT-L (166–185)
- Three Processing Intensity Levels: PIL-F, PIL-M, PIL-H
- Anti-stacking rule: LEX-B excluded from PIL-H

These three layers must never be conflated or hybridized.

### DOMAIN ARCHITECTURE
Eight legacy (generative) domains: SCI, BIO, TEC, HLT, ENV, SOC, ECN, PHY
Ten policy (ESO) domains: EDU, WRK, ECN, GOV, HLT, TEC, ENV, JUS, INT, CUL

Domains are civilian and general. No military-specialist content. No aviation, weapons, or rank-specific material.

### AUDIO DELIVERY
- Pre-generated Microsoft Azure Cognitive Services TTS (neural voice)
- One standard voice for all passages
- Stored as static MP3 files on GitHub Pages
- No runtime TTS API calls during student sessions

---

## SECTION C — B10-PP PLATFORM SUMMARY

### What it is
A Progressive Web App (PWA) hosted on GitHub Pages. Students access it via browser on any device — no download or account required.

### What it does (MVP — Phase 1 only for now)
1. Student enters via access code + name/student ID
2. Student sees assigned passage set + browse library
3. Student listens to a B10 passage (Azure TTS MP3)
4. Student records an oral paraphrase (Web Audio API)
5. Recording transcribed by OpenAI Whisper API
6. Transcript scored by Anthropic Claude API against B10 4-point rubric
7. Structured feedback returned to student immediately
8. Score and transcript written to Firebase cloud datastore
9. Instructor sees results in real-time dashboard

### What it is NOT
- Not a multiple-choice platform (no MC items, ever)
- Not an ILR assessment tool (formative practice only)
- Not a server-dependent system
- Not a replacement for OPI or human ILR evaluation

---

## SECTION D — FULL TECHNICAL STACK

| Layer | Technology |
|-------|-----------|
| Frontend framework | React + Vite |
| Hosting | GitHub Pages |
| PWA | vite-plugin-pwa + Service Worker |
| Audio playback | HTML5 Audio API |
| Audio recording | Web Audio API (browser-native) |
| Transcription | OpenAI Whisper API ($0.006/min) |
| Scoring | Anthropic Claude API (/v1/messages) |
| Cloud datastore | Firebase (Firestore) |
| Real-time updates | Firestore live listeners |
| Instructor auth | Firebase Authentication |
| TTS generation | Azure Cognitive Services (pre-deployment only) |
| Local buffer | localStorage (temporary only — never permanent) |
| Dev OS | Linux Mint |
| Version control | Git + GitHub |
| Build agent | Claude Code (director model) |

### API Key Security (hard requirement)
OpenAI and Anthropic API keys must NEVER be exposed in frontend code. All API calls requiring keys must be proxied through Firebase Cloud Functions.

---

## SECTION E — STORAGE ARCHITECTURE

### Cloud datastore (Firebase Firestore) — permanent
All session records, scores, transcripts, access code records, instructor accounts.

### localStorage — temporary buffer only
Audio blob held during transcription window only. Discarded after Whisper returns transcript. Never used for permanent storage.

### Audio — never stored
Audio recordings are never written to any server. Discarded immediately after transcription.

---

## SECTION F — PASSAGE DATA MODEL (SPEC-LOCKED FIELD NAMES)

Each passage record uses these exact field names. Do not rename without explicit approval:

```json
{
  "passage_id": "B10-COR-HLT-004",
  "domain": "Health & Medicine",
  "layer": "CORE",
  "tier": "Tier 1",
  "ext_band": null,
  "pil": null,
  "audio_file": "/audio/core/B10-COR-HLT-004.mp3",
  "passage_text": "Full passage text here.",
  "session_type": "assigned"
}
```

For EXT passages, `tier` is null and `ext_band` + `pil` are populated (e.g., `"EXT-M"`, `"PIL-F"`).
`session_type` values: `"assigned"` or `"independent_practice"`.

---

## SECTION G — SCORING RUBRIC (B10 4-POINT PARAPHRASE SCALE)

This rubric is embedded verbatim in the Claude API system prompt for scoring.

**Score 4 — Excellent**
Clearly conveys the passage's central claim; accurately expresses key relationships (cause/effect, unexpected findings, contrasting expectations); includes all essential explanatory logic; presents ideas coherently without distortion.

**Score 3 — Good**
Conveys the general main idea OR one central finding accurately; includes at least one major causal or explanatory relationship correctly; shows overall accurate understanding even if some essential relationships are missing; is coherent and does not distort meaning; demonstrates substantial but incomplete coverage of the passage's logic.

**Score 2 — Partial**
Mentions only the topic or an isolated detail; does not clearly convey the passage's main idea or central findings; shows only partial comprehension; omits or confuses key relationships; lacks a coherent explanation of the passage's logic.

**Score 1 — Inaccurate**
Misrepresents the meaning; introduces major errors; shows minimal comprehension.

---

## SECTION H — ACCESS CODE SYSTEM

- Students enter platform with: access code + name or student ID
- No account, password, or email required
- Access code encodes: group + assigned passage set + optional time window
- Codes created by instructor inside dashboard (self-service)
- Codes expire per configurable time window; manual deactivation available anytime
- Invalid/expired code → clear error message shown to student

---

## SECTION I — STUDENT EXPERIENCE (SCREEN FLOW)

```
Entry Screen (access code + name/ID)
        ↓
Passage Menu (assigned set + browse library)
        ↓
Passage Detail (audio player → Begin Task)
        ↓
Recording Screen (Replay → Record → Stop/Submit)
        ↓
[Whisper transcription → Claude scoring]
        ↓
Feedback Screen (score + transcript + passage text + strengths + gaps + language note)
        ↓
        ├── Retry this passage
        ├── Next passage
        └── Return to menu
```

### Key UX rules
- Passage text NEVER shown during task — audio only
- Passage text revealed ONLY on Feedback Screen after submission
- Whisper transcript shown to student labeled: "What we heard you say:"
- No multiple choice, ever
- No scrubbing or speed control on audio player
- No autoplay
- Retry visually emphasized for Score 1 and Score 2

---

## SECTION J — INSTRUCTOR DASHBOARD

- Two-level: summary across all codes + drill-down by code
- Three tabs in drill-down: Students / Passages / Independent Practice
- Real-time updates via Firestore live listeners
- Metrics: individual scores, completion counts, attempt history, transcripts
- NO averages, NO score distribution, NO aggregate analytics in MVP
- Transcript text visible to instructor for each submission
- No audio playback in dashboard (audio never stored)

---

## SECTION K — MVP SCOPE (PHASE 1 ONLY RIGHT NOW)

### In scope for MVP
Oral Paraphrase task only. All other task types (ESO, Hypothetical) are Phase 2.

### Explicitly out of scope for MVP
- ESO task type
- Hypothetical/Conditional task type
- Multiple choice
- ILR level estimate in feedback
- B10 performance label (B10-1 through B10-4)
- CSV export
- Student account creation
- SSO/institutional login
- Re-recording before submission
- Permanent audio storage
- Playback speed control
- Audio scrubbing
- L1 translation of feedback
- Score override/appeal
- LMS integration
- Prosody visualizer (Tool B — separate project)

---

## SECTION L — BUILD ORDER AND CURRENT STATUS

### Development model
Director Model: Jeff Moore = domain expert, spec author, quality gate. Claude Code = builder. Checkpoint reviews by Jeff at end of each phase before proceeding.

### Four build phases
**Phase 1 — Scaffold and Static Layer** ← CURRENT PHASE
**Phase 2 — Student Practice Flow**
**Phase 3 — Instructor Dashboard**
**Phase 4 — Polish and Pilot Preparation**

### Current status as of March 31, 2026
- B10-PP Spec v0.1 fully drafted (13 sections, 1,581 lines) — pending Jeff review
- Governance Log 001 completed
- Phase 1 Build Kickoff Prompt drafted and reviewed
- Pre-Build Environment Setup Prompt drafted
- GitHub repository: NOT YET CREATED
- React/Vite scaffold: NOT YET INITIALIZED
- Firebase project: NOT YET SET UP
- Azure TTS voice: NOT YET SELECTED
- Audio pilot batch (5–10 MP3s): NOT YET GENERATED

### IMMEDIATE NEXT TASK
Pre-build environment setup:
1. Create GitHub repository (b10-pp)
2. Clone locally on Linux Mint
3. Place existing /docs and /governance files into repo
4. Verify folder structure
5. Initial commit and push
6. THEN proceed to Phase 1 build

---

## SECTION M — REQUIRED FOLDER STRUCTURE (TARGET)

```
b10-pp/
├── README.md
├── docs/
├── governance/
├── frontend/
│   └── src/
│       ├── components/
│       ├── pages/
│       ├── services/
│       ├── hooks/
│       └── utils/
│   └── public/
├── audio/
│   ├── orient/
│   ├── core/
│   └── ext/
├── data/
└── scripts/
```

---

## SECTION N — KEY GOVERNANCE RULES (ENFORCE AT ALL TIMES)

1. Follow the spec exactly — do not redesign, do not add features
2. No multiple choice — ever
3. No audio storage — ever
4. API keys never in frontend code — always proxied
5. localStorage = temporary buffer only, never permanent storage
6. Tier in CORE = MF count only — do not redefine
7. ORIENT, CORE, and EXT are separate systems — never collapse
8. Do not rename spec field names without explicit Jeff Moore approval
9. Ask before omitting any spec requirement
10. Ask before expanding scope beyond what is specified
11. Treat B10_PP_Spec_v0_1_FULL.md as the single source of truth

---

## SECTION O — AUTHORITATIVE FILES

| File | Purpose |
|------|---------|
| `B10_PP_Spec_v0_1_FULL.md` | Single source of truth — full product spec |
| `B10_Master_Orientation_Prompt_v1.md` | B10 corpus architecture reference |
| `B10_PP_Governance_Log_001.md` | Session 1 governance log |
| `B10_PP_Phase1_Kickoff_Prompt.md` | Phase 1 build instructions for Claude Code |
| `B10_PP_PreBuild_Setup_Prompt.md` | Environment setup instructions |

---

## HOW TO USE THIS PROMPT

Paste this document at the start of any new Claude session before beginning B10-PP work. It provides full project context so you do not need to re-explain the architecture, decisions, or current status.

After pasting this prompt, state what you need:
- **For environment setup:** "I need to complete pre-build environment setup. Here is the setup prompt." Then attach the Pre-Build Setup Prompt.
- **For Phase 1 build:** "I am ready to begin Phase 1. Here is the Phase 1 kickoff prompt." Then attach the Phase 1 Kickoff Prompt.
- **For spec review or revision:** "I need to review/revise [section name] of the B10-PP spec."
- **For corpus work:** "I am working on B10 CORE passage revision." Then specify the passage and issue.

---
*B10-PP Project Continuation Prompt v1.0 — DLIELC — Jeff Moore — March 31, 2026*