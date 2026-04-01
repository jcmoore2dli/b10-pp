# B10-PP Spec — Section 3: Student Experience and Task Flow
**Version:** 0.1 Draft
**Status:** DRAFT — Pending Jeff Moore review and approval

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
