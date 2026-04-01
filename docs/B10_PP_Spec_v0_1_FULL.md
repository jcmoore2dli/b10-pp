# B10 Practice Platform (B10-PP) — Product Specification
**Version:** 0.1 (Draft — In Progress)
**Author:** Jeff Moore, DLIELC
**Date:** March 2026
**Status:** DRAFT v0.1 — All sections pending Jeff Moore review and approval

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

---
*B10 Practice Platform Spec — DLIELC — Jeff Moore — March 2026*

---


## SECTION 2 — TASK TYPES

### 2.1 Overview

B10-PP supports three oral response task types. All three share the same core pipeline: student listens and/or reads a prompt → student records a spoken response → response is transcribed via Whisper → transcript is scored by Claude API against the B10 rubric → structured feedback is returned to the student.

Task types differ in their **input stimulus** (passage, prompt, or both) and their **response demand** (comprehension reporting vs. opinion argumentation vs. conditional reasoning).

**No task type in B10-PP uses multiple choice. Ever.**

---

### 2.2 Task Type 1 — Oral Paraphrase (CORE Task / MVP Phase 1)

| Field | Detail |
|-------|--------|
| **Status** | ✅ MVP Phase 1 — build this first |
| **Input stimulus** | B10 passage audio (Azure TTS MP3, pre-generated) |
| **Student action** | Listen to passage → record oral paraphrase of what they heard |
| **Response demand** | Comprehension reporting — student demonstrates they understood the passage's main idea, key relationships, and argumentative logic |
| **Scoring rubric** | B10 4-point paraphrase scale (Score 1–4; see Section 8) |
| **Passage layers** | CORE (70–87 words), EXT (120–185 words), ORIENT — as assigned |
| **Prompt displayed to student** | "Listen to the passage. When you are ready, record your paraphrase in English." |

**Design notes:**
- Student may replay the audio before recording. Number of replays may be configurable by instructor.
- Student records once. No re-recording in MVP (may be added in later phase).
- The passage text is NOT displayed to the student at any point during the task. Audio only.
- Feedback is returned immediately after submission.

---

### 2.3 Task Type 2 — Extended Supported Opinion (ESO)

| Field | Detail |
|-------|--------|
| **Status** | 🔲 Phase 2 — not in MVP |
| **Input stimulus** | Mode A: Written or spoken ESO policy prompt only (no passage) / Mode B: B10 passage audio followed by ESO prompt derived from or related to that passage |
| **Student action** | Read/hear prompt → record spoken opinion with supporting reasoning |
| **Response demand** | Argumentation — student takes a position, supports it with reasons, acknowledges complexity or counterargument |
| **Scoring rubric** | B10 ESO rubric (to be developed; separate from paraphrase rubric) |
| **Prompt example** | "Should municipalities ban single-use plastic bottles? Give your opinion and support it with reasons." |

**Design notes:**
- Mode A and Mode B are both supported; assignment type is set by instructor at the passage/set level.
- ESO prompts draw from the B10 ESO bank (280+ mapped policy questions across 10 policy domains).
- Uses identical recording, transcription, and scoring pipeline as Task Type 1.
- Scoring rubric for ESO is distinct from paraphrase rubric and must be developed before Phase 2 build begins.

---

### 2.4 Task Type 3 — Hypothetical / Conditional Response

| Field | Detail |
|-------|--------|
| **Status** | 🔲 Phase 2 — not in MVP |
| **Input stimulus** | Mode A: Standalone hypothetical prompt only / Mode B: B10 passage audio followed by hypothetical prompt |
| **Student action** | Read/hear prompt → record spoken hypothetical or conditional response |
| **Response demand** | Conditional reasoning — student speculates, hypothesizes, or reasons through a conditional scenario using appropriate language |
| **Scoring rubric** | B10 Hypothetical rubric (to be developed) |
| **Prompt example** | "If this policy were implemented nationally, what might be the unintended consequences? Explain your reasoning." |

**Design notes:**
- Mode A and Mode B both supported; set by instructor at assignment level.
- Hypothetical prompts may be derived from ESO bank topics or generated independently.
- Uses identical recording, transcription, and scoring pipeline as Task Types 1 and 2.
- Scoring rubric must be developed before Phase 2 build begins.

---

### 2.5 Pipeline Shared Across All Task Types

All three task types run through the same technical pipeline once the student submits a recording:

```
Student records spoken response (Web Audio API)
        ↓
Audio blob temporarily buffered in local browser storage (session only)
        ↓
Audio blob sent to OpenAI Whisper API
        ↓
Plain text transcript returned
        ↓
Transcript + task metadata (task_type, prompt/passage, rubric)
sent to Anthropic Claude API
        ↓
Claude returns structured JSON:
  - score (1–4)
  - score label
  - strengths
  - gaps
  - specific language feedback
        ↓
Feedback displayed to student
        ↓
Score and response data are written to a lightweight cloud datastore
(e.g., Firebase or equivalent) and made available to the instructor
dashboard. Local browser storage may be used only for temporary
buffering during the session.
```

**Storage architecture:**
- **Cloud datastore (Firebase or equivalent):** Permanent storage for all score and response data. Single source of truth for instructor dashboard. Persists across devices and browsers.
- **Local browser storage:** Temporary session buffer only. Used to hold in-progress data before cloud write. Not used for permanent storage and not accessible across devices.

This pipeline is built once in MVP (for Oral Paraphrase) and reused without structural change for ESO and Hypothetical in Phase 2. Only the task metadata and system prompt sent to Claude change between task types.

---

### 2.6 Task Type Summary Table

| Task Type | MVP Phase | Stimulus | Response Demand | Rubric Status |
|-----------|-----------|----------|----------------|---------------|
| Oral Paraphrase | ✅ Phase 1 | Passage audio | Comprehension reporting | ✅ Defined (Section 8) |
| ESO | 🔲 Phase 2 | Prompt only OR Passage + Prompt | Opinion argumentation | 🔲 To be developed |
| Hypothetical | 🔲 Phase 2 | Prompt only OR Passage + Prompt | Conditional reasoning | 🔲 To be developed |

---
*B10 Practice Platform Spec — Section 2 — DLIELC — Jeff Moore — March 2026*

---


## SECTION 3 — STUDENT EXPERIENCE AND TASK FLOW

### 3.1 Overview

The student experience in B10-PP is designed around three principles:

1. **Minimal friction entry** — no account creation, no password, no app install required
2. **Immediate practice** — student reaches the task in as few steps as possible
3. **Iterative improvement** — after feedback, the student is encouraged to retry rather than move on

The full student flow from entry to completion is described below screen by screen.

---

### 3.2 Screen 1 — Entry Screen (Access Code + Identity)

**What the student sees:**
- B10-PP platform name and brief one-line descriptor
- Two input fields:
  - Access code (provided by instructor)
  - Name or Student ID (entered by student)
- A single "Enter" or "Begin" button

**What the access code does:**
The access code is a lightweight routing mechanism. It may represent:
- A class or group assignment
- A specific assigned practice set (e.g., Set 03, Tier 1)
- An individual independent assignment
- A timed or open-ended practice window

The access code routes the student to the correct passage materials and associates all session responses and scores with the correct instructor dashboard view. No account, password, or email is required.

**Design notes:**
- Entry must be fast. The entire entry sequence should take under 30 seconds.
- If the access code is invalid, a clear error message is shown with guidance to check with the instructor.
- Student name or ID is stored with session data in the cloud datastore for instructor identification purposes only. It is not used for authentication.

---

### 3.3 Screen 2 — Passage Menu

**What the student sees:**
- **Assigned set** displayed prominently at the top — passages the instructor has assigned via the access code, shown with completion status indicators (not yet started / in progress / completed)
- **Browse library** accessible below or via a secondary tab — full browsable passage library organized by domain cluster and layer (ORIENT / CORE / EXT), available for additional independent practice beyond the assigned set

**Passage card information displayed:**
- Passage ID (e.g., B10-COR-HLT-004)
- Domain label (e.g., Health & Medicine)
- Layer (ORIENT / CORE / EXT)
- Tier (Tier 0 / Tier 1 / Tier 2) for CORE passages
- EXT band and PIL level for EXT passages (e.g., EXT-M / PIL-F)
- Completion status for current student

**Design notes:**
- Assigned passages are always shown first. Browse library is secondary.
- The passage text is never displayed in the menu. Title, domain, and metadata only.
- Completed passages remain accessible for retry.

---

### 3.4 Screen 3 — Passage Detail

**What the student sees:**
- Passage metadata (ID, domain, layer, tier)
- Audio player with Play / Replay controls
- A "Begin Task" button (activates after the student has engaged with the audio — e.g., full play or a configurable minimum listen time; intent is to encourage listening, not enforce compliance)

**What happens:**
1. Student presses Play — passage audio (Azure TTS MP3) begins
2. Student may replay as many times as needed before beginning (replay limit configurable by instructor; default = unlimited in MVP)
3. Student presses "Begin Task" when ready — advances to Screen 4

**Design notes:**
- Passage text is NOT displayed at any point during the task sequence. Audio only.
- The "Begin Task" button activates after the student has engaged with the audio (e.g., full play or a configurable minimum listen time). The intent is to encourage listening before responding, not to enforce compliance. Exact activation threshold to be determined at build time.
- Task type displayed here: "Task: Oral Paraphrase" (MVP Phase 1 only)

---

### 3.5 Screen 4 — Recording Screen (Oral Paraphrase)

**What the student sees:**
- Brief task prompt displayed on screen:
  *"Listen to the passage. When you are ready, record your paraphrase in English."*
- A Replay button (allows student to re-listen before recording)
- A Record button (large, clearly labeled)
- Recording timer visible once recording begins
- A Stop / Submit button

**What happens:**
1. Student presses Record — browser requests microphone permission if not already granted
2. Recording begins — timer runs
3. Student speaks their oral paraphrase
4. Student presses Stop / Submit
5. Audio blob is temporarily buffered in local browser storage
6. Audio is sent to OpenAI Whisper API for transcription
7. A brief processing indicator is shown ("Scoring your response…")
8. Transcript + task metadata sent to Claude API
9. Claude returns structured JSON feedback
10. Student advances to Screen 5

**Design notes:**
- In MVP Phase 1, student records once per submission. Re-recording before submission may be added in a later phase.
- Microphone permission prompt is handled by the browser natively. If permission is denied, a clear error message and guidance are shown.
- Processing time (Whisper + Claude) is estimated at 5–15 seconds. A visible progress indicator must be shown during this window.
- Audio blob is not stored permanently. It is discarded after transcription is complete.

---

### 3.6 Screen 5 — Feedback Screen

**What the student sees:**
- **Score** — B10 4-point scale score displayed clearly (1 / 2 / 3 / 4) with label (Inaccurate / Partial / Good / Excellent)
- **Strengths** — brief narrative of what the student conveyed accurately
- **Gaps** — specific description of what was missing, misrepresented, or unclear
- **Language feedback** — targeted note on specific lexical or structural items to review (where applicable)
- **Three clearly labeled action buttons:**
  1. **Retry this passage** — returns to Screen 4 (recording screen) for immediate re-attempt; recommended for Score 1–2
  2. **Next passage** — advances to next passage in assigned set
  3. **Return to menu** — returns to Screen 2 (passage menu) for free navigation

**What happens in the background:**
- Score and response data (score, transcript excerpt, task metadata, timestamp, student ID, access code) are written to the cloud datastore (Firebase or equivalent)
- Data is immediately available in the instructor dashboard

**Design notes:**
- The Retry option is visually emphasized for Score 1 and Score 2 responses to encourage immediate improvement (e.g., highlighted button, brief encouraging prompt such as "Try again — you can improve this.").
- Feedback language must be clear and accessible to non-native English speakers. Avoid metalinguistic jargon in student-facing feedback text.
- The passage text is revealed on the Feedback Screen after submission — student may read the passage for the first time here to compare with their paraphrase. This is an intentional pedagogical choice.
- Score history for this passage (if student has attempted it before) may be shown here to illustrate score trajectory.
- Detailed scoring criteria and rubric definitions are specified in Section 8 (Scoring and Feedback).

---

### 3.7 Full Student Flow Summary

```
Entry Screen (Access Code + Name/ID)
        ↓
Passage Menu (Assigned set + Browse library)
        ↓
Passage Detail (Audio player → Begin Task)
        ↓
Recording Screen (Replay → Record → Stop/Submit)
        ↓
[Processing: Whisper transcription → Claude scoring]
        ↓
Feedback Screen (Score + Strengths + Gaps + Language feedback)
        ↓
        ├── Retry this passage → Recording Screen
        ├── Next passage → Passage Detail (next in set)
        └── Return to menu → Passage Menu
```

---

### 3.8 Design Principles Governing Student UX

| Principle | Implementation |
|-----------|----------------|
| Minimal friction entry | Access code + name only; no account or password |
| Audio-first | Passage text never shown during task; revealed only post-submission |
| Iteration over advancement | Retry is the primary post-feedback action for low scores |
| Mobile-ready | All screens designed for iOS/Android browser use; large tap targets, simple layouts |
| Accessibility | Clear error states, progress indicators, plain English prompts throughout |
| Instructor visibility | All score data written to cloud datastore immediately; no manual export required |

---
*B10 Practice Platform Spec — Section 3 — DLIELC — Jeff Moore — March 2026*

---


## SECTION 4 — ACCESS, AUTH, AND CLASS CODE SYSTEM

### 4.1 Overview

B10-PP uses a lightweight, no-login access model. Students do not create accounts or passwords. Access is granted via an **access code** issued by the instructor, which routes the student to the correct passage materials and associates all session data with the correct instructor dashboard view.

This model is designed for:
- Rapid student entry with minimal friction
- Instructor control over what materials students access
- Clean data routing to the instructor dashboard without requiring student account management

---

### 4.2 What an Access Code Represents

A single access code encodes three elements:

| Element | Description | Required |
|---------|-------------|----------|
| **Group** | A class, cohort, or student group the code is issued to | ✅ Required |
| **Assigned passage set** | The specific B10 passage set(s) the code grants access to (e.g., Set 03, Tier 1) | ✅ Required |
| **Time window** | Optional start and/or end date/time defining when the code is active | 🔲 Optional |

**What an access code is NOT:**
- Not an open-ended library access pass — codes always route to a defined passage set
- Not an individual student identifier — student identity is captured separately via name or student ID at entry
- Not a password — codes are not secret credentials; they are routing and assignment mechanisms

---

### 4.3 Access Code Creation (Instructor Self-Service)

Instructors generate access codes directly inside the B10-PP instructor dashboard. No request to Jeff Moore or external process is required.

**Code creation workflow (instructor):**
1. Instructor logs into the B10-PP instructor dashboard
2. Navigates to "Create Access Code"
3. Selects:
   - Group name or label (e.g., "Cohort A", "Block 2 Thursday")
   - Assigned passage set (e.g., Set 03, Tier 1, CORE)
   - Optional time window (start date/time, end date/time)
4. System generates a unique access code (format: to be determined at build time — short alphanumeric recommended for ease of entry on mobile)
5. Instructor distributes code to students via any out-of-platform channel (email, LMS, whiteboard, etc.)

---

### 4.4 Access Code Behavior and Expiration

| Behavior | Specification |
|----------|---------------|
| **Expiration** | Codes expire after a configurable time period set by the instructor at creation |
| **Time window** | Optional start and end date/time; if set, code is active only within that window |
| **Manual deactivation** | Instructor may manually deactivate any code at any time regardless of expiration setting |
| **Reuse** | A single code may be used by multiple students in the same group; it is not single-use |
| **Invalid/expired code** | Student sees a clear error message at entry with guidance to contact their instructor |

---

### 4.5 Student Entry Flow (Access Code Side)

At the Entry Screen (Section 3.2), the student:
1. Enters the access code provided by the instructor
2. Enters their name or student ID
3. Presses "Begin"

The platform validates the access code against the cloud datastore:
- If valid and active → student is routed to their assigned passage set (Passage Menu, Section 3.3)
- If invalid or expired → error message displayed; no access granted

Student name or ID is stored with all session data in the cloud datastore for instructor identification purposes. It is not used for authentication and is not verified against any roster.

---

### 4.6 Data Routing and Dashboard Association

All student session data — scores, transcripts, task metadata, timestamps — are tagged with:
- The access code used at entry
- The student name or ID entered at entry
- The passage ID and task type completed

This tagging ensures that instructor dashboard views are automatically filtered by access code, allowing an instructor to see results for a specific group and assignment without manual sorting.

**Design note:** If a student uses the same access code across multiple sessions, all sessions are grouped under that code in the dashboard view. Score trajectory across sessions is visible to the instructor.

---

### 4.7 Instructor Authentication

While students use a no-login access model, **instructors require authentication** to access the dashboard and code management tools.

Instructor authentication model for MVP:
- Username and password (standard credential-based login)
- No SSO or institutional login integration in MVP (may be added in a later phase)
- Instructor accounts provisioned manually for MVP (self-registration or admin-created — to be determined at build time)

---

### 4.8 Out of Scope for MVP

| Feature | Status |
|---------|--------|
| Student account creation or login | ❌ Out of scope |
| SSO / institutional login (CAC, LMS integration) | ❌ Out of scope |
| Individual student access codes (one code per student) | ❌ Out of scope — group codes only in MVP |
| Roster verification (name/ID checked against a list) | ❌ Out of scope |
| Self-service instructor account registration | 🔲 To be determined at build time |

---
*B10 Practice Platform Spec — Section 4 — DLIELC — Jeff Moore — March 2026*

---


## SECTION 5 — PASSAGE MENU AND SELECTION

### 5.1 Overview

After entering the platform via access code, students land on the Passage Menu. This screen serves two functions:

1. **Assigned set view** — displays the passages the instructor has assigned via the access code, with completion status and navigation
2. **Browse library** — provides access to the full B10 passage corpus for independent practice beyond the assigned set

These two views are presented on the same screen, with the assigned set displayed prominently and the browse library accessible as a secondary option.

---

### 5.2 Assigned Set View

The assigned set is displayed at the top of the Passage Menu immediately upon entry. It contains only the passages associated with the student's access code.

**Passage card — information displayed:**

| Field | Display |
|-------|---------|
| Passage ID | e.g., B10-COR-HLT-004 |
| Domain label | e.g., Health & Medicine |
| Layer | ORIENT / CORE / EXT |
| Tier | Tier 0 / Tier 1 / Tier 2 (CORE passages only) |
| EXT band + PIL level | e.g., EXT-M / PIL-F (EXT passages only) |
| Completion status | Not Started / In Progress / Completed |

**What is NOT displayed on the passage card:**
- Passage text (never shown in the menu)
- Word count
- Score from previous attempt (visible on Feedback Screen only, not in menu)

**Completion status logic:**
- **Not Started** — student has not yet played the audio for this passage
- **In Progress** — student has played the audio but not yet submitted a response
- **Completed** — student has submitted at least one response for this passage

Completed passages remain accessible and selectable for retry. Completion status does not lock a passage.

---

### 5.3 Browse Library

The browse library gives students access to the full B10 passage corpus beyond their assigned set. It is available as a secondary view on the Passage Menu.

**Organization — three-axis browsing:**

Students can filter and browse by any combination of:

| Filter axis | Options |
|-------------|---------|
| Domain cluster | L&W (Learning & Work) / H&E (Health & Environment) / G&S (Governance & Society) / T&S (Technology & Science) / C&B (Culture & Behavior) |
| Layer | ORIENT / CORE / EXT |
| Tier / Band | Tier 0 / Tier 1 / Tier 2 (CORE) — EXT-S / EXT-M / EXT-L (EXT) |

Passage cards in the browse library display the same fields as assigned set cards (Section 5.2).

**Access model — open with session tagging:**

Students may attempt any passage in the browse library. Browse library attempts are fully functional — audio plays, response is recorded, Whisper transcribes, Claude scores, feedback is returned.

However, browse library session data is tagged differently from assigned set data:

| Data field | Assigned set | Browse library |
|------------|-------------|----------------|
| Session type tag | `assigned` | `independent_practice` |
| Visible in instructor dashboard | ✅ Yes — under assigned results | ✅ Yes — under separate independent practice view |
| Counted toward assigned set completion | ✅ Yes | ❌ No |

This tagging ensures instructors can distinguish between required assigned work and student-initiated independent practice, while still having visibility into all activity.

---

### 5.4 Passage Selection and Navigation

**Selecting a passage:**
- Student taps or clicks a passage card to open the Passage Detail screen (Section 3.4)
- No confirmation step required — selection goes directly to Passage Detail

**Returning to the menu:**
- Available at any point via a clearly labeled "Return to Menu" option
- From the Feedback Screen, "Return to Menu" is one of three post-feedback navigation options (Section 3.6)

**Passage ordering in assigned set:**
- Passages are displayed in the order defined by the instructor at code creation
- Default order follows B10 curriculum sequence (Set → Phase → Tier progression) unless instructor specifies otherwise

---

### 5.5 Design Notes

- The passage text is never displayed in the Passage Menu. Domain, layer, tier, and status only.
- The browse library does not display passages that have not yet been canonized or released. Only validated, production-ready passages appear.
- Students with no assigned set (edge case — access code with browse-only configuration) land directly on the browse library view. This is not a standard use case in MVP.
- Passage card design must be mobile-optimized — large tap targets, readable at small screen sizes, clear status indicators that do not rely on color alone.

---

### 5.6 Passage Menu Summary

```
PASSAGE MENU
│
├── ASSIGNED SET (top / primary view)
│     └── Passage cards filtered by access code
│           Fields: ID / Domain / Layer / Tier or EXT band+PIL / Status
│           Status: Not Started / In Progress / Completed
│           All passages selectable including completed (retry allowed)
│
└── BROWSE LIBRARY (secondary view)
      └── Full B10 corpus
            Organized by: Domain cluster / Layer / Tier or Band
            Attempts allowed — tagged as independent_practice
            Not counted toward assigned set completion
            Visible to instructor under separate dashboard view
```

---
*B10 Practice Platform Spec — Section 5 — DLIELC — Jeff Moore — March 2026*

---


## SECTION 6 — AUDIO DELIVERY

### 6.1 Overview

B10-PP delivers passage audio as pre-generated static MP3 files hosted on GitHub Pages. Audio is not generated at runtime. All passages are recorded once using Microsoft Azure Cognitive Services TTS and stored as static files in the platform repository. This model eliminates runtime API costs, ensures consistent audio quality across all sessions, and removes dependency on third-party API availability during student practice.

---

### 6.2 Audio Generation Model

| Parameter | Specification |
|-----------|--------------|
| **Generation method** | Pre-generated offline using Azure Cognitive Services TTS |
| **Storage** | Static MP3 files hosted on GitHub Pages |
| **Generation timing** | Once, prior to platform deployment; regenerated only if passage text is revised |
| **Runtime API dependency** | None — no Azure TTS API call occurs during student sessions |
| **Cost at runtime** | $0 — audio is served as static files |

**Rationale:**
Pre-generation is the correct model for B10-PP because:
- Passage text is fixed and controlled — passages do not change during a session
- Static file serving is faster and more reliable than on-demand TTS generation
- Eliminates per-playback API costs entirely
- Audio quality is consistent and reviewable before deployment

---

### 6.3 Voice Selection

A single standard Azure neural voice is used for all passages across all layers (ORIENT, CORE, EXT) and all domain clusters.

| Parameter | Specification |
|-----------|--------------|
| **Voice model** | Microsoft Azure Neural TTS — specific voice to be selected at build time |
| **Voice consistency** | One voice, all passages, no variation by layer, domain, or tier |
| **Voice selection criteria** | Must model natural connected speech prosody; avoid robotic cadence; suitable for ILR listening assessment construct validity |

**Design note — voice selection matters:**
The Azure neural voice selected will affect the listening construct. A voice with natural prosody, connected speech features, and appropriate pacing is required. Robotic or over-enunciated delivery would undermine the ILR 2+ listening demand. Voice selection must be reviewed and approved by Jeff Moore before audio generation begins. A small pilot batch (5–10 passages) should be generated and evaluated before full corpus generation.

---

### 6.4 Audio File Naming and Organization

Audio files are named to match passage IDs for unambiguous mapping between the passage JSON data and the corresponding audio file.

**Naming convention:**
```
{PASSAGE_ID}.mp3
```

**Examples:**
```
B10-COR-HLT-004.mp3
B10-EXT-GOV-012.mp3
B10-ORI-EDU-001.mp3
```

**Repository structure (GitHub Pages):**
```
/audio/
  ├── orient/
  │     └── B10-ORI-{DOMAIN}-{NUM}.mp3
  ├── core/
  │     └── B10-COR-{DOMAIN}-{NUM}.mp3
  └── ext/
        └── B10-EXT-{DOMAIN}-{NUM}.mp3
```

---

### 6.5 Audio Playback in the Platform

Audio playback is handled natively by the browser via a standard HTML5 audio player element, styled to match the B10-PP interface.

**Playback controls available to students:**
- Play
- Pause
- Replay (restart from beginning)

**Replay behavior:**
- Default: unlimited replays before task begins
- Configurable: instructor may set a replay limit at code creation (optional)
- After task begins (recording screen): replay remains available via a clearly labeled Replay button

**Playback design notes:**
- No seek bar or scrubbing control — students may not skip to a specific point in the audio. Play and replay only.
- No playback speed control in MVP — audio plays at the recorded TTS rate only.
- No transcript or text display during playback — audio only until post-submission feedback screen.
- Autoplay is NOT used — student must press Play deliberately.

---

### 6.6 Audio File Generation Workflow (Pre-Deployment)

This section describes the offline process for generating passage audio before platform deployment. This is a Jeff Moore / build-time process, not a student-facing feature.

```
Passage text finalized and canonized in B10 corpus
        ↓
Azure TTS script runs against passage text
(batch processing — all passages in one run)
        ↓
MP3 files generated with standard voice settings
        ↓
Audio reviewed by Jeff Moore (spot-check for prosody,
pacing, mispronunciation, unnatural stress)
        ↓
Approved files committed to GitHub Pages /audio/ directory
        ↓
Passage JSON updated to reference correct audio file path
        ↓
Audio available for student playback on platform
```

**Regeneration trigger:**
If a canonized passage is revised after audio generation, the corresponding MP3 must be regenerated and re-committed. The passage JSON audio path does not change — only the file is replaced.

---

### 6.7 Out of Scope for MVP

| Feature | Status |
|---------|--------|
| On-demand TTS generation at playback | ❌ Out of scope |
| Multiple voice options per passage | ❌ Out of scope |
| Playback speed control | ❌ Out of scope |
| Audio seek / scrubbing | ❌ Out of scope |
| Autoplay | ❌ Out of scope |
| Transcript display during playback | ❌ Out of scope |

---
*B10 Practice Platform Spec — Section 6 — DLIELC — Jeff Moore — March 2026*

---


## SECTION 7 — RECORDING AND TRANSCRIPTION

### 7.1 Overview

B10-PP records student spoken responses directly in the browser using the Web Audio API. No external recording app, plugin, or device is required. The recorded audio is sent to the OpenAI Whisper API for transcription. The resulting plain text transcript is then passed to the Claude API for scoring. Audio is not stored permanently — it is discarded after transcription is complete.

---

### 7.2 Recording — Technical Model

| Parameter | Specification |
|-----------|--------------|
| **Recording method** | Web Audio API (browser-native) |
| **Audio format** | WebM or M4A — browser default; no conversion required for Whisper |
| **Microphone access** | Browser permission prompt — student must grant access before recording begins |
| **Recording interface** | Single large Record button; timer visible during recording; Stop / Submit button ends recording |
| **Re-recording before submission** | Not available in MVP — student records once per submission |
| **Time limit** | Configurable by instructor at code creation; no platform-enforced default |
| **Permanent audio storage** | None — audio blob is discarded after transcription |

---

### 7.3 Recording Time Limit

The recording time limit is set by the instructor at access code creation. It is not enforced by the platform globally.

| Configuration | Behavior |
|--------------|----------|
| **Time limit set** | Recording stops automatically when limit is reached; student is prompted to submit |
| **No time limit set** | Student records until they press Stop / Submit |
| **Recommended guidance** | Instructors should set time limits appropriate to passage layer: ORIENT / CORE passages suggest 60–90 seconds; EXT passages suggest 90–150 seconds |

**Design notes:**
- A visible countdown timer is shown when a time limit is set — student can see remaining time during recording.
- When time expires, recording stops automatically and the Submit button activates. Student must press Submit to proceed — auto-submit does not occur.
- Recommended time limits are advisory guidance only and not enforced by the platform defaults.

---

### 7.4 Microphone Permission Handling

Browser microphone access requires explicit student permission. B10-PP handles permission states as follows:

| Permission state | Platform behavior |
|-----------------|-------------------|
| **Granted** | Recording begins immediately when student presses Record |
| **Denied** | Clear error message displayed; guidance shown to enable microphone in browser settings; recording unavailable until permission granted |
| **Not yet requested** | Browser native permission prompt shown when student presses Record for the first time |

**Design note:** Microphone permission is requested only when the student presses Record — not at platform entry or passage menu. This minimizes friction for students who do not proceed to a recording task in a given session.

---

### 7.5 Transcription — Technical Model

| Parameter | Specification |
|-----------|--------------|
| **Transcription service** | OpenAI Whisper API |
| **Endpoint** | `/v1/audio/transcriptions` |
| **Pricing** | $0.006 per minute of audio |
| **Input format** | WebM or M4A audio blob |
| **Output** | Plain text transcript |
| **Language setting** | English (fixed — all B10-PP responses are in English) |
| **Transcript storage** | Stored in cloud datastore (Firebase or equivalent) as part of session record |

---

### 7.6 Transcription Pipeline

```
Student presses Stop / Submit
        ↓
Audio blob temporarily buffered in local browser storage
        ↓
Processing indicator shown to student ("Transcribing your response...")
        ↓
Audio blob sent to OpenAI Whisper API (/v1/audio/transcriptions)
        ↓
Plain text transcript returned
        ↓
Audio blob discarded — not stored permanently
        ↓
Transcript passed to Claude API with task metadata
(see Section 8 — Scoring and Feedback)
        ↓
Transcript stored in cloud datastore as part of session record
```

---

### 7.7 Transcription Quality Considerations

Whisper API performs well on clear English speech in quiet environments. The following factors may affect transcription quality in practice:

| Factor | Risk | Mitigation |
|--------|------|------------|
| Background noise | Reduced accuracy | Students advised to record in quiet environment; guidance shown on recording screen |
| Non-native accent | Minor accuracy reduction | Whisper is trained on diverse accents; risk is low for most L1 backgrounds |
| Very short responses (under 5 seconds) | May produce empty or minimal transcript | Minimum recording length may be enforced at build time |
| Device microphone quality | Variable | No mitigation in MVP; noted as known limitation |

**Design note:** Transcription errors that meaningfully distort meaning are a known risk. Claude's scoring prompt should instruct the model to account for likely transcription artifacts when evaluating student responses — for example, not penalizing for minor word-level errors that are clearly transcription noise rather than comprehension failure. This is addressed in Section 8.

---

### 7.8 Data Handling — Audio and Transcript

| Data type | Stored | Location | Retention |
|-----------|--------|----------|-----------|
| Audio blob | Temporary only | Local browser storage | Discarded after transcription |
| Plain text transcript | Yes | Cloud datastore (Firebase or equivalent) | Retained as part of session record |
| Student name / ID | Yes | Cloud datastore | Retained as part of session record |
| Timestamp | Yes | Cloud datastore | Retained as part of session record |
| Score | Yes | Cloud datastore | Retained as part of session record |

**Privacy note:** Audio recordings are never stored on any server. The audio blob exists only in the student's browser memory during the transcription window and is discarded immediately after. Only the plain text transcript is retained.

---

### 7.9 Out of Scope for MVP

| Feature | Status |
|---------|--------|
| Re-recording before submission | ❌ Out of scope |
| Audio playback of student recording before submission | ❌ Out of scope |
| Permanent audio storage | ❌ Out of scope |
| Real-time transcription (streaming) | ❌ Out of scope |
| Alternative transcription services (GPT-4o Mini, Deepgram) | ❌ Out of scope — Whisper only in MVP |
| Offline recording with deferred transcription | ❌ Out of scope |

---
*B10 Practice Platform Spec — Section 7 — DLIELC — Jeff Moore — March 2026*

---


## SECTION 8 — SCORING AND FEEDBACK

### 8.1 Overview

Scoring in B10-PP is performed by the Anthropic Claude API. After a student submits a spoken response, the Whisper transcript is passed to Claude along with the passage text and task metadata. Claude evaluates the transcript against the B10 4-point paraphrase rubric and returns a structured JSON object containing the score, label, and formative feedback. Feedback is displayed to the student immediately on the Feedback Screen (Section 3.6).

Claude is the scoring agent. No human scoring occurs in the student-facing practice flow. Human scoring remains the standard for official ILR assessment — B10-PP is a formative practice tool only.

---

### 8.2 Scoring Rubric — B10 4-Point Paraphrase Scale

The following rubric is the authoritative scoring standard for all Oral Paraphrase tasks in MVP Phase 1. This rubric is embedded in the Claude system prompt verbatim.

---

**Score 4 — Excellent**
The paraphrase:
- Clearly conveys the passage's central claim
- Accurately expresses the key relationships (e.g., cause/effect, unexpected findings, contrasting expectations)
- Includes all essential explanatory logic
- Presents the ideas coherently without distortion

---

**Score 3 — Good**
A Score 3 response must meet all of the following:
- Conveys the general main idea OR one of the central findings accurately
- Includes at least one major causal or explanatory relationship correctly
- Shows overall accurate understanding even if some essential relationships are missing
- Is coherent and does not distort meaning
- Demonstrates substantial but incomplete coverage of the passage's logic

*(This level is for responses that are accurate and well-structured but missing some deeper reasoning or secondary insights.)*

---

**Score 2 — Partial**
A Score 2 response:
- Mentions only the topic or an isolated detail
- Does not clearly convey the passage's main idea or central findings
- Shows only partial comprehension
- Omits or confuses key relationships
- Lacks a coherent explanation of the passage's logic

---

**Score 1 — Inaccurate**
The response misrepresents the meaning, introduces major errors, or shows minimal comprehension.

---

### 8.3 Claude API — Input (System Prompt Structure)

The following describes the structure of the call made to the Anthropic Claude API for each scoring event. The system prompt is constructed dynamically at runtime from fixed rubric text and session-specific variables.

**System prompt components:**

| Component | Content | Source |
|-----------|---------|--------|
| Role instruction | Claude is acting as a trained ILR listening assessment scorer | Fixed — hardcoded in prompt |
| Rubric | Full B10 4-point paraphrase rubric (Section 8.2) | Fixed — hardcoded in prompt |
| Passage text | The full text of the B10 passage the student listened to | Dynamic — pulled from passage JSON |
| Task type | `oral_paraphrase` (MVP Phase 1) | Dynamic — from task metadata |
| Transcription note | Instruction to account for likely Whisper transcription artifacts when scoring | Fixed — hardcoded in prompt |
| Output format instruction | Claude must return a JSON object only — no prose outside the JSON structure | Fixed — hardcoded in prompt |

**User turn content:**

| Component | Content |
|-----------|---------|
| Student transcript | Plain text output from Whisper API |

**System prompt — transcription artifact instruction (required):**
Claude must be explicitly instructed to account for transcription noise. The prompt must include language such as:
*"The student response below was transcribed automatically and may contain minor transcription errors. Do not penalize the student for word-level errors that are clearly transcription artifacts rather than comprehension failures. Score based on the overall meaning conveyed."*

---

### 8.4 Claude API — Output (JSON Structure)

Claude must return a structured JSON object only. No prose, no preamble, no markdown formatting outside the JSON. The output format instruction in the system prompt must enforce this explicitly.

**Required JSON structure:**

```json
{
  "score": 3,
  "score_label": "Good",
  "strengths": "The student accurately conveyed the central finding and identified the causal relationship between X and Y.",
  "gaps": "The counter-intuitive element was not captured — the student did not address the unexpected reversal in the second half of the passage.",
  "language_feedback": "Consider using discourse markers such as 'however' or 'nevertheless' to signal contrast when paraphrasing passages with a reversal structure.",
  "transcript_note": "Minor transcription artifacts detected — scored on meaning conveyed, not surface form."
}
```

**Field definitions:**

| Field | Type | Description |
|-------|------|-------------|
| `score` | Integer (1–4) | Numeric score per B10 rubric |
| `score_label` | String | Rubric label: Inaccurate / Partial / Good / Excellent |
| `strengths` | String | What the student conveyed accurately — 1–3 sentences |
| `gaps` | String | What was missing, misrepresented, or unclear — 1–3 sentences |
| `language_feedback` | String | Specific lexical or structural feedback — 1–2 sentences; null if not applicable |
| `transcript_note` | String | Note if transcription artifacts were detected and accounted for; null if clean transcript |

**Output constraints:**
- Feedback language must be clear and accessible to non-native English speakers
- Avoid metalinguistic jargon in `strengths`, `gaps`, and `language_feedback` fields
- `strengths` and `gaps` must reference the specific content of the passage — not generic rubric language
- `language_feedback` should target one specific, actionable item — not a general comment

---

### 8.5 Feedback Display — Student-Facing

The feedback screen displays all Claude output fields to the student in plain English. No raw JSON is shown.

**Display layout:**

| Display element | Source field | Notes |
|----------------|-------------|-------|
| Score badge (1 / 2 / 3 / 4) | `score` | Displayed prominently with color indicator |
| Score label | `score_label` | Displayed alongside score badge |
| Whisper transcript | Whisper output | Displayed in a clearly labeled text box: "What we heard you say:" |
| Passage text | Passage JSON | Revealed here for the first time — labeled: "The passage:" |
| Strengths | `strengths` | Displayed under heading "What you did well:" |
| Gaps | `gaps` | Displayed under heading "What to work on:" |
| Language feedback | `language_feedback` | Displayed under heading "Language note:" — hidden if null |
| Transcript note | `transcript_note` | Displayed as a small note if not null — hidden if null |

**Feedback language requirement:**
All student-facing feedback text generated by Claude must be written in plain, accessible English. Metalinguistic terminology (e.g., "subordinate clause," "nominal phrase," "discourse pivot") must not appear in student-facing fields. Claude's system prompt must explicitly instruct this.

**Feedback screen navigation:**
After reviewing feedback the student may:
1. Retry this passage — returns to Recording Screen
2. Next passage — advances to next in assigned set
3. Return to menu — returns to Passage Menu

*(See Section 3.6 for full navigation behavior and retry emphasis design.)*

---

### 8.6 Score Data Written to Cloud Datastore

Immediately after Claude returns the scoring JSON, the following data is written to the cloud datastore (Firebase or equivalent):

| Field | Value |
|-------|-------|
| `student_id` | Name or ID entered at platform entry |
| `access_code` | Code used at entry |
| `passage_id` | Passage scored |
| `task_type` | `oral_paraphrase` |
| `session_type` | `assigned` or `independent_practice` |
| `score` | Integer 1–4 |
| `score_label` | String |
| `transcript` | Plain text Whisper output |
| `strengths` | Claude output |
| `gaps` | Claude output |
| `language_feedback` | Claude output |
| `timestamp` | UTC timestamp of submission |
| `attempt_number` | Integer — increments per retry on same passage |

This data is immediately available in the instructor dashboard view filtered by access code.

---

### 8.7 Scoring Model — Phase 2 Notes

The scoring pipeline defined in this section is built once for Oral Paraphrase (MVP Phase 1) and reused for ESO and Hypothetical tasks in Phase 2. The only changes required for Phase 2 are:

- A new rubric embedded in the system prompt (ESO rubric and Hypothetical rubric — to be developed before Phase 2 build)
- Updated `task_type` field in the JSON output
- Updated system prompt framing for task type (argumentation vs. conditional reasoning vs. comprehension reporting)

The JSON output structure, cloud datastore schema, and feedback display layout remain unchanged across task types.

---

### 8.8 Out of Scope for MVP

| Feature | Status |
|---------|--------|
| ILR level estimate in student feedback | ❌ Out of scope |
| B10 performance level label (B10-1 through B10-4) | ❌ Out of scope — rubric score only |
| Suggested next passage recommendation | ❌ Out of scope |
| Human scoring or human review of Claude scores | ❌ Out of scope for student-facing flow |
| L1 translation of feedback | ❌ Out of scope |
| Score appeal or override mechanism | ❌ Out of scope |
| ESO rubric | ❌ Out of scope — to be developed before Phase 2 |
| Hypothetical rubric | ❌ Out of scope — to be developed before Phase 2 |

---
*B10 Practice Platform Spec — Section 8 — DLIELC — Jeff Moore — March 2026*

---


## SECTION 9 — INSTRUCTOR DASHBOARD

### 9.1 Overview

The instructor dashboard provides real-time visibility into student practice activity across all access codes. It is the instructor-facing layer of B10-PP — separate from the student-facing practice platform but drawing from the same cloud datastore (Firebase or equivalent).

The dashboard serves two functions:
1. **Monitoring** — instructors see student scores, completion status, transcripts, and score trajectories as they happen
2. **Management** — instructors create and manage access codes (Section 4)

Instructor access requires authentication (username and password — see Section 4.7).

---

### 9.2 Dashboard Organization — Two-Level View

The dashboard is organized at two levels:

**Level 1 — Summary View (across all codes)**
The landing view after instructor login. Shows all access codes the instructor has created, with aggregate data for each.

| Column | Description |
|--------|-------------|
| Access code | Code identifier and label |
| Assigned passage set | Passage set linked to this code |
| Active window | Start / end dates if set |
| Students | Number of unique students who have used this code |
| Completion | % of assigned passages completed across the group |
| Status | Active / Expired / Deactivated |

**Level 2 — Drill-down View (by access code)**
Instructor clicks any access code row to drill down into full detail for that code.

Drill-down contains three tabs:

| Tab | Content |
|-----|---------|
| **Students** | Per-student view — see Section 9.3 |
| **Passages** | Per-passage view — see Section 9.4 |
| **Independent Practice** | Browse library activity — see Section 9.5 |

---

### 9.3 Students Tab — Per-Student View

Displays one row per student who has used the access code.

**Student row fields:**

| Field | Description |
|-------|-------------|
| Student name / ID | As entered at platform entry |
| Passages completed | Number of assigned passages with at least one submission |
| Passages remaining | Number of assigned passages not yet attempted |

**Student drill-down:**
Clicking a student row opens a detailed view for that student showing:

- All passages attempted, in order
- For each passage:
  - All attempts (attempt number, timestamp, score, score label)
  - Score trajectory across attempts (visual indicator — e.g., 1 → 2 → 3)
  - Transcript text for each submission (labeled by attempt number)
  - Claude feedback fields (strengths, gaps, language feedback) for each attempt

---

### 9.4 Passages Tab — Per-Passage View

Displays one row per passage in the assigned set.

**Passage row fields:**

| Field | Description |
|-------|-------------|
| Passage ID | e.g., B10-COR-HLT-004 |
| Domain | Domain label |
| Layer / Tier | Layer and tier or EXT band + PIL |
| Students attempted | Number of students who have submitted at least one response |
| Students completed | Number of students with a Score 3 or 4 on at least one attempt |

**Passage drill-down:**
Clicking a passage row opens a view showing all student submissions for that passage — student name, attempt number, score, and transcript.

---

### 9.5 Independent Practice Tab — Browse Library Activity

Displays student activity from the browse library (passages attempted outside the assigned set). Tagged as `independent_practice` in the datastore (Section 5.3).

**Display:**
- One row per student
- For each student: passages attempted independently, scores, transcripts
- Clearly labeled as independent practice — visually distinct from assigned set data

**Design note:** Independent practice data is visible to instructors for awareness but is not counted toward assigned set completion metrics.

---

### 9.6 Real-Time Updates

The dashboard updates in real time as students submit responses. No manual refresh is required.

| Event | Dashboard behavior |
|-------|--------------------|
| Student submits a response | Score and transcript appear in Students tab immediately |
| Student completes a passage | Completion count updates in summary view immediately |
| New student uses access code | Student row appears in Students tab immediately |

**Technical note:** Real-time updates are implemented via Firebase or equivalent cloud datastore live listener functionality. No polling or manual refresh required.

---

### 9.7 Transcript Access

Instructors can read the full Whisper transcript for any student submission. Transcripts are displayed in the student drill-down view (Section 9.3) alongside the Claude feedback for that attempt.

**Purpose:** Transcript access allows instructors to:
- Verify Claude scoring against what the student actually said
- Identify patterns in student language production
- Detect transcription artifacts that may have affected scoring

**Design note:** Transcripts are plain text only. No audio playback is available in the dashboard — audio is not stored (Section 7.8).

---

### 9.8 Access Code Management

The dashboard includes a code management panel where instructors can:

- Create new access codes (Section 4.3)
- View all active, expired, and deactivated codes
- Manually deactivate any code
- Edit time window for an existing code (if not yet expired)

Code management is described fully in Section 4.

---

### 9.9 Out of Scope for MVP

| Feature | Status |
|---------|--------|
| Export to CSV | ❌ Out of scope — deferred to Phase 3 |
| Score averages by passage across all codes | ❌ Out of scope |
| Instructor-to-student messaging | ❌ Out of scope |
| Annotating or overriding Claude scores | ❌ Out of scope |
| Multi-instructor account sharing | ❌ Out of scope |
| Student-facing progress dashboard | ❌ Out of scope — students see per-session feedback only |
| LMS integration | ❌ Out of scope |

---
*B10 Practice Platform Spec — Section 9 — DLIELC — Jeff Moore — March 2026*

---


## SECTION 10 — DATA STORAGE

### 10.1 Overview

B10-PP uses a two-layer storage model:

1. **Local browser storage** — temporary session buffering only; no permanent data
2. **Cloud datastore (Firebase or equivalent)** — permanent storage for all session data, scores, transcripts, and access code configuration

All instructor-visible data lives in the cloud datastore. Local browser storage is never the source of truth for any persistent record.

---

### 10.2 Local Browser Storage

| Parameter | Specification |
|-----------|--------------|
| **Purpose** | Temporary buffering of in-progress session data only |
| **Contents** | Audio blob (pre-transcription), partial session state |
| **Retention** | Cleared after cloud write completes; not retained across sessions |
| **Scope** | Single device, single browser — not accessible across devices |
| **Role in architecture** | Buffer only — never primary or permanent storage |

---

### 10.3 Cloud Datastore

| Parameter | Specification |
|-----------|--------------|
| **Service** | Firebase or equivalent lightweight cloud datastore |
| **Purpose** | Permanent storage for all session records, scores, transcripts, and access code data |
| **Access** | Student-facing platform writes data; instructor dashboard reads data in real time |
| **Retention** | Indefinite — data is not automatically deleted |
| **Export** | No export mechanism in MVP — data accessible via dashboard only |

---

### 10.4 Data Schema — Session Record

Each student submission generates one session record in the cloud datastore. The schema is defined in Section 8.6 and reproduced here for reference.

| Field | Type | Description |
|-------|------|-------------|
| `student_id` | String | Name or ID entered at platform entry |
| `access_code` | String | Code used at entry |
| `passage_id` | String | Passage scored (e.g., B10-COR-HLT-004) |
| `task_type` | String | Task type (e.g., `oral_paraphrase`) |
| `session_type` | String | `assigned` or `independent_practice` |
| `score` | Integer (1–4) | Numeric score per B10 rubric |
| `score_label` | String | Inaccurate / Partial / Good / Excellent |
| `transcript` | String | Plain text Whisper output |
| `strengths` | String | Claude feedback — strengths field |
| `gaps` | String | Claude feedback — gaps field |
| `language_feedback` | String / null | Claude feedback — language note; null if not applicable |
| `transcript_note` | String / null | Transcription artifact note; null if clean |
| `timestamp` | UTC datetime | Submission timestamp |
| `attempt_number` | Integer | Attempt count for this student on this passage |

---

### 10.5 Data Schema — Access Code Record

Each access code created by an instructor generates one access code record.

| Field | Type | Description |
|-------|------|-------------|
| `access_code` | String | Unique code identifier |
| `instructor_id` | String | Instructor account that created the code |
| `group_label` | String | Group name or label assigned by instructor |
| `passage_set` | String | Assigned passage set (e.g., Set 03 / Tier 1 / CORE) |
| `start_time` | UTC datetime / null | Optional activation start time |
| `end_time` | UTC datetime / null | Optional expiration time |
| `status` | String | `active` / `expired` / `deactivated` |
| `created_at` | UTC datetime | Code creation timestamp |

---

### 10.6 Data Schema — Instructor Account Record

| Field | Type | Description |
|-------|------|-------------|
| `instructor_id` | String | Unique instructor identifier |
| `username` | String | Login username |
| `password_hash` | String | Hashed password — plaintext never stored |
| `created_at` | UTC datetime | Account creation timestamp |

---

### 10.7 Data Routing and Isolation

All session records are tagged with `access_code` and `instructor_id` at write time. This tagging ensures:

- Instructor dashboard queries are filtered by `instructor_id` — instructors see only their own codes and student data
- Dashboard drill-down views are filtered by `access_code` — each code's data is isolated
- `assigned` and `independent_practice` session types are queryable independently (Section 9.5)

---

### 10.8 Audio Data — Explicit Non-Storage Confirmation

Audio recordings are never written to the cloud datastore or any server. The audio blob exists only in local browser storage during the transcription window and is discarded immediately after the Whisper transcript is returned. Only the plain text transcript is retained.

This is a hard architectural requirement, not a configuration option.

---

### 10.9 Data Retention

| Data type | Retention policy |
|-----------|-----------------|
| Session records (scores, transcripts, feedback) | Indefinite |
| Access code records | Indefinite |
| Instructor account records | Indefinite |
| Audio blobs | Never stored — discarded after transcription |
| Local browser storage contents | Cleared after cloud write; not persisted |

No automatic deletion or archiving occurs in MVP. Data accumulates indefinitely in the cloud datastore until manually deleted by the platform administrator (Jeff Moore).

---

### 10.10 Out of Scope for MVP

| Feature | Status |
|---------|--------|
| CSV or data export | ❌ Out of scope |
| Data archiving or automatic deletion | ❌ Out of scope |
| FERPA / institutional data compliance review | ❌ Out of scope — noted as future requirement |
| Student-initiated data deletion | ❌ Out of scope |
| Multi-institution data isolation | ❌ Out of scope |
| Backup and disaster recovery | ❌ Out of scope — deferred to later phase |

---
*B10 Practice Platform Spec — Section 10 — DLIELC — Jeff Moore — March 2026*

---


## SECTION 11 — TECHNICAL STACK

### 11.1 Overview

B10-PP is a Progressive Web App (PWA) built on a static frontend with no custom backend server. All server-side functions are handled by third-party APIs and Firebase. The platform runs entirely in the browser on any modern iOS, Android, Windows, or Linux device.

---

### 11.2 Full Stack Summary

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend framework** | React + Vite | PWA UI — student practice platform and instructor dashboard |
| **Hosting** | GitHub Pages | Static file serving — PWA, passage JSON, audio MP3s |
| **PWA layer** | Service Worker (Workbox or equivalent) | Offline support, asset caching |
| **Audio playback** | HTML5 Audio API | Passage MP3 playback |
| **Audio recording** | Web Audio API (browser-native) | Student spoken response capture |
| **Transcription** | OpenAI Whisper API (`/v1/audio/transcriptions`) | Speech-to-text for student recordings |
| **Scoring** | Anthropic Claude API (`/v1/messages`) | AI scoring and feedback generation |
| **Cloud datastore** | Firebase (Google) | Permanent storage — session records, scores, transcripts, access codes |
| **Real-time updates** | Firebase Realtime Database or Firestore live listeners | Instructor dashboard real-time data push |
| **Instructor auth** | Firebase Authentication | Username and password login for instructor accounts |
| **TTS audio generation** | Microsoft Azure Cognitive Services TTS | Pre-generation of passage MP3s (offline, pre-deployment) |
| **Local browser storage** | localStorage / sessionStorage | Temporary session buffer only |
| **Development OS** | Linux Mint (primary) | Claude Code build environment |

---

### 11.3 Frontend — React + Vite

| Parameter | Specification |
|-----------|--------------|
| **Framework** | React 18+ |
| **Build tool** | Vite |
| **Deployment target** | GitHub Pages (static build output) |
| **PWA configuration** | vite-plugin-pwa or equivalent — enables install prompt, service worker, offline cache |
| **Styling** | To be determined at build time — CSS modules or Tailwind CSS recommended |
| **Mobile optimization** | Required — all UI components must be touch-friendly and functional on iOS and Android browsers |

---

### 11.4 Firebase — Services Used

| Firebase service | Purpose |
|-----------------|---------|
| **Firestore** | Primary cloud datastore — session records, access code records |
| **Firebase Authentication** | Instructor login (username + password) |
| **Firebase Realtime Database or Firestore live listeners** | Real-time dashboard updates |
| **Firebase Hosting** | Not used — GitHub Pages is the hosting layer |

**Cost note:** Firebase free tier (Spark Plan) is sufficient for MVP at DLIELC pilot scale. Firestore free tier allows 50,000 reads and 20,000 writes per day — well within expected usage for a pilot cohort.

---

### 11.5 API Dependencies

| API | Provider | Auth method | MVP use |
|-----|----------|-------------|---------|
| Whisper (`/v1/audio/transcriptions`) | OpenAI | API key | Transcription of student recordings |
| Claude (`/v1/messages`) | Anthropic | API key | Scoring and feedback generation |
| Azure TTS | Microsoft | API key | Pre-generation of passage audio (offline, pre-deployment only) |

**API key handling:** API keys for OpenAI and Anthropic must never be exposed in the frontend client code. All API calls requiring keys must be proxied through a lightweight serverless function (e.g., Firebase Cloud Functions or equivalent) to protect credentials. This is a security requirement, not optional.

---

### 11.6 Development Environment

| Parameter | Specification |
|-----------|--------------|
| **Primary OS** | Linux Mint |
| **Runtime** | Node.js + npm |
| **Build agent** | Claude Code (director model — see Section 1.7) |
| **Version control** | Git + GitHub |
| **Deployment** | GitHub Pages via GitHub Actions (automated on push to main) |

---

## SECTION 12 — MVP SCOPE AND BUILD ORDER

### 12.1 MVP Definition

The B10-PP MVP is the minimum functional platform that:
- Allows a student to enter via access code, listen to a B10 CORE passage, record an oral paraphrase, and receive AI-generated feedback
- Allows an instructor to create access codes, assign passage sets, and view student scores and transcripts in real time
- Runs on GitHub Pages with no custom backend server
- Costs less than $10/month in API usage at pilot scale

Everything else is post-MVP.

---

### 12.2 MVP Feature Set

| Feature | Section | MVP |
|---------|---------|-----|
| Access code entry + student name/ID | 3.2, 4 | ✅ |
| Assigned passage set view | 5.2 | ✅ |
| Browse library (view + attempt) | 5.3 | ✅ |
| Passage audio playback (Azure TTS MP3) | 6 | ✅ |
| Oral paraphrase recording (Web Audio API) | 7 | ✅ |
| Whisper transcription | 7.5 | ✅ |
| Claude scoring + feedback (4-point rubric) | 8 | ✅ |
| Feedback screen (score, transcript, passage reveal, strengths, gaps, language note) | 8.5 | ✅ |
| Retry / Next / Menu navigation | 3.6 | ✅ |
| Firebase session record write | 8.6, 10 | ✅ |
| Instructor dashboard — summary + drill-down | 9.2 | ✅ |
| Students tab — completion + attempt history + transcripts | 9.3 | ✅ |
| Passages tab — completion counts | 9.4 | ✅ |
| Independent practice tab | 9.5 | ✅ |
| Real-time dashboard updates | 9.6 | ✅ |
| Instructor authentication (Firebase Auth) | 4.7, 11.4 | ✅ |
| Access code creation and management | 4.3, 9.8 | ✅ |
| PWA install prompt + offline asset cache | 11.3 | ✅ |
| API key proxy (serverless function) | 11.5 | ✅ |
| ESO task type | 2.3 | ❌ Phase 2 |
| Hypothetical task type | 2.4 | ❌ Phase 2 |
| CSV export | 9.9 | ❌ Phase 3 |
| Prosody visualizer (Tool B) | — | ❌ Separate build |

---

### 12.3 Build Order

Claude Code will build B10-PP in the following sequence. Each phase ends with a defined checkpoint review by Jeff Moore before proceeding.

**Phase 1 — Scaffold and Static Layer**
1. GitHub repo setup and GitHub Pages configuration
2. React + Vite PWA scaffold (Vite-plugin-pwa, service worker)
3. Passage JSON structure defined and sample passages loaded (5–10 passages)
4. Azure TTS pilot batch generated (5–10 MP3s) and committed to `/audio/`
5. Audio playback component built and tested

*Checkpoint 1: Jeff reviews passage JSON structure, audio playback, and PWA install behavior*

**Phase 2 — Student Practice Flow**
6. Entry screen (access code + name/ID input)
7. Passage menu (assigned set + browse library)
8. Passage detail screen (audio player + Begin Task)
9. Recording screen (Web Audio API recording + timer)
10. Whisper transcription integration (via API proxy)
11. Claude scoring integration (via API proxy)
12. Feedback screen (score, transcript, passage reveal, Claude feedback fields, navigation)
13. Firebase session record write on submission

*Checkpoint 2: Jeff completes a full end-to-end student session and reviews feedback quality*

**Phase 3 — Instructor Dashboard**
14. Firebase Authentication — instructor login
15. Access code creation and management UI
16. Dashboard summary view (all codes)
17. Students tab (per-student completion + attempt history + transcripts)
18. Passages tab (per-passage completion counts)
19. Independent practice tab
20. Real-time listener wiring (Firestore live updates)

*Checkpoint 3: Jeff reviews full instructor dashboard with live student data*

**Phase 4 — Polish and Pilot Preparation**
21. Mobile UI review and optimization (iOS + Android browser testing)
22. Error state handling (invalid access code, microphone denied, API failure)
23. Full passage corpus loaded (all canonized passages as of pilot date)
24. Azure TTS full batch generated for all loaded passages
25. PWA offline behavior verified

*Checkpoint 4: Jeff approves platform for pilot deployment*

---

### 12.4 Success Criteria for MVP

MVP is considered complete when:

1. A student on an iOS or Android browser can enter an access code, listen to a B10 CORE passage, record an oral paraphrase, and receive scored feedback — end to end — without instructor assistance
2. An instructor can log in, create an access code, assign a passage set, and see student scores and transcripts appear in real time as students submit
3. The full session costs less than $0.02 per student submission in API fees
4. The platform runs without errors on iOS Safari, Android Chrome, and Linux Mint Chrome/Firefox
5. All student audio is confirmed non-persistent — no audio stored on any server

---

## SECTION 13 — OUT OF SCOPE

### 13.1 Out of Scope for MVP — Master List

The following features are explicitly excluded from MVP. They are documented here to prevent scope creep during the build phase. None of these items should be built, stubbed, or partially implemented unless Jeff Moore explicitly moves them into scope.

| Feature | Rationale for deferral |
|---------|----------------------|
| ESO task type | Requires separate rubric development before build |
| Hypothetical / Conditional task type | Requires separate rubric development before build |
| Multiple choice questions | Excluded by design — not a B10-PP task type |
| ILR level estimate in student feedback | Deferred — formative tool only |
| B10 performance level label (B10-1 through B10-4) | Scale not yet developed |
| Suggested next passage recommendation | Deferred to later phase |
| CSV / data export | Deferred to Phase 3 |
| Student account creation or login | No-login model by design |
| SSO / institutional login (CAC, LMS) | Deferred — MVP uses Firebase Auth only |
| Individual per-student access codes | Group codes only in MVP |
| Roster verification | Out of scope by design |
| Re-recording before submission | Deferred to later phase |
| Audio playback of student recording | Deferred to later phase |
| Permanent audio storage | Excluded by design — privacy requirement |
| Playback speed control | Deferred to later phase |
| Audio seek / scrubbing | Excluded by design |
| Transcript display during playback | Excluded by design — audio only |
| L1 translation of feedback | Deferred |
| Score override or appeal mechanism | Deferred |
| Instructor-to-student messaging | Deferred |
| Multi-instructor account sharing | Deferred |
| Student-facing progress dashboard | Deferred — students see per-session feedback only |
| LMS integration | Deferred |
| FERPA / institutional compliance review | Required before wider deployment — not MVP blocker |
| Prosody pitch contour visualizer (Tool B) | Separate build — not part of B10-PP MVP |
| Backup and disaster recovery | Deferred |
| Data archiving or automatic deletion | Deferred |

---
*B10 Practice Platform Spec — Sections 11, 12, 13 — DLIELC — Jeff Moore — March 2026*

---

