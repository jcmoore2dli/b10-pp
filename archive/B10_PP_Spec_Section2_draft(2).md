# B10-PP Spec — Section 2: Task Types
**Version:** 0.1 Draft
**Status:** DRAFT — Pending Jeff Moore review and approval

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
Audio blob buffered temporarily in browser localStorage (session only)
        ↓
Audio blob sent to OpenAI Whisper API
        ↓
Plain text transcript returned
        ↓
Transcript + passage text + rubric sent to Anthropic Claude API
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
Score and response data written to Firebase or equivalent
lightweight cloud datastore
        ↓
Data made available to instructor dashboard in real time
```

**Storage architecture:**
- **Cloud datastore (Firebase or equivalent):** Permanent storage for all score and response data. Single source of truth for instructor dashboard. Persists across devices and browsers.
- **localStorage:** Temporary session buffer only. Used to hold in-progress session data before cloud write. Not used for permanent storage.

This pipeline is built once in MVP (for Oral Paraphrase) and reused without structural change for ESO and Hypothetical in Phase 2. Only the system prompt sent to Claude changes between task types.

---

### 2.6 Task Type Summary Table

| Task Type | MVP Phase | Stimulus | Response Demand | Rubric Status |
|-----------|-----------|----------|----------------|---------------|
| Oral Paraphrase | ✅ Phase 1 | Passage audio | Comprehension reporting | ✅ Defined (Section 8) |
| ESO | 🔲 Phase 2 | Prompt only OR Passage + Prompt | Opinion argumentation | 🔲 To be developed |
| Hypothetical | 🔲 Phase 2 | Prompt only OR Passage + Prompt | Conditional reasoning | 🔲 To be developed |

---
*B10 Practice Platform Spec — Section 2 — DLIELC — Jeff Moore — March 2026*
