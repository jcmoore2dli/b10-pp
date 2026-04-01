# B10-PP Spec — Section 8: Scoring and Feedback
**Version:** 0.1 Draft
**Status:** DRAFT — Pending Jeff Moore review and approval

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
