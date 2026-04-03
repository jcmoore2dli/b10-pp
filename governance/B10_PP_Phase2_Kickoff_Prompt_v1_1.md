# B10-PP PHASE 2 KICKOFF PROMPT
## For use in Claude Code at the start of Phase 2 build
## Version: 1.1 — April 2, 2026
## Author: Jeff Moore, DLIELC

---

## CONTEXT

This is Phase 2 of the B10 Practice Platform (B10-PP) build. Phase 1 scaffold is complete and
verified at Checkpoint 1. You are now building the student practice flow.

Project repository: ~/b10_corpus/b10_practice_platform/
Frontend: ~/b10_corpus/b10_practice_platform/frontend/
Stack: React + Vite, Tailwind CSS, Web Audio API, Firebase Cloud Functions (stubbed)

---

## PHASE 2 SCOPE — EXACTLY THIS, NOTHING MORE

1. Recording Screen — Web Audio API recording implementation
2. Scoring service layer — model-agnostic evaluate() interface
3. ClaudeScorer — stub returning mock score data (no real API call yet)
4. WhisperTranscriber — stub returning mock transcript (no real API call yet)
5. Feedback Screen — full score display per B10 4-point rubric schema

Firebase is NOT being set up in this phase. Do not touch Firebase configuration,
Firestore, authentication, or Cloud Functions setup. All API calls are stubbed.

---

## HARD ARCHITECTURAL RULES — ENFORCE AT ALL TIMES

1. API keys NEVER in frontend code — ever. In Phase 2 this is moot since all
   scorers are stubs, but the architecture must be designed so real keys would
   flow through a backend proxy, never the frontend.

2. Audio is NEVER stored. The audio blob exists only in memory during the
   transcription window. After the stub transcriber returns, explicitly release
   the audioBlob reference (set it to null) to allow garbage collection.
   Do not write audio to localStorage, sessionStorage, or any server.

3. localStorage = temporary buffer only. Nothing is written to localStorage
   permanently in this phase.

4. Passage text is NOT shown until the Feedback Screen. It must not appear on
   the Recording Screen under any circumstance.

5. No re-recording before submission. Once the student submits, the flow moves
   forward. Re-recording is out of MVP scope.

6. No multiple choice — ever.

7. RecordingScreen must ONLY call ScoringService.evaluate(). Do not call
   ClaudeScorer directly from any UI component. This preserves the
   model-agnostic architecture required for Phase 3.

8. Favor simple, readable implementations over abstraction. Do not introduce
   unnecessary complexity or premature optimization.

---

## SCREEN 1 — RECORDING SCREEN

### Route
Navigates from Passage Detail → Recording Screen when Begin Task is clicked
(after audio has been played at least once).

### What this screen must show
- Task prompt text: "Listen carefully, then record your paraphrase of the passage."
- Replay button — replays the passage audio (same audio player, no scrub, no speed)
- Record button — starts recording via Web Audio API
- Stop / Submit button — appears after recording begins; stops recording and submits
- Recording state indicator — visual feedback that recording is active
- Back navigation — returns to Passage Detail (pre-recording only)

### What this screen must NOT show
- Passage text — never
- Score or feedback — never
- Re-record option — out of scope

### Passage text source
Passage text must be retrieved from the existing passage data source (passages.json)
using the passageId route parameter. Do not hardcode passage text anywhere.
The passageText is not displayed on this screen — it is retrieved here so it can
be passed to ScoringService.evaluate() and forwarded to the Feedback Screen.

### Recording implementation
Use the browser-native Web Audio API (MediaRecorder). Steps:
1. Request microphone permission on Record button click
2. Start MediaRecorder, collect audio chunks
3. On Stop/Submit: assemble chunks into a Blob
4. Pass Blob to WhisperTranscriber.transcribe()
5. Receive { transcript } from transcriber
6. Explicitly release audioBlob reference (set to null)
7. Pass transcript + passageText + passageId to ScoringService.evaluate()
8. Receive scoring result object
9. Navigate to Feedback Screen passing full result via React Router location state

The complete pipeline is:
audio → transcript → evaluate() → result → Feedback Screen

### Routing state shape
Pass exactly this object via React Router location state when navigating to Feedback Screen:
```javascript
{
  score: number,
  score_label: string,
  transcript: string,
  strengths: string,
  gaps: string,
  language_note: string,
  passageText: string,
  passageId: string
}
```
Do not add, remove, or rename fields in this object.

### Loading state
While transcription + scoring stubs are running, show a loading indicator with
message: "Analyzing your response..." — do not navigate away until stubs return.

### Error handling
If recording permission is denied or recording fails, display a simple error
message and allow the student to try again. Do not implement complex error
handling in this phase — a single clear message is sufficient.

---

## SCREEN 2 — FEEDBACK SCREEN

### Route
Navigates from Recording Screen after evaluate() returns result.

### What this screen must show
- Score (1–4) displayed prominently
- Score label: "Inaccurate" / "Partial" / "Good" / "Excellent"
- Transcript labeled: "What we heard you say:"
- Passage text (revealed here for the first time)
- Strengths field
- Gaps field
- Language note field
- Three navigation buttons:
  - Retry this passage → returns to Recording Screen
  - Next passage → returns to Passage Menu
  - Return to menu → returns to Passage Menu

### Retry emphasis rule
If score is 1 or 2, the Retry button must be visually emphasized
(larger, highlighted, or primary styling). Next Passage and Return to Menu
are secondary for Score 1 and Score 2.

### Retry behavior
Retry must start a completely new recording session.
Do not reuse previous transcript or score state when returning to Recording Screen.
Clear all prior session state on Retry.

---

## SERVICE LAYER ARCHITECTURE

Create these files in frontend/src/services/:

### services/transcription/WhisperTranscriber.js
Interface:
```javascript
// Input: audioBlob (Blob)
// Output: { transcript: string }
async function transcribe(audioBlob) {}
```
Phase 2 stub implementation: ignore audioBlob, return after 1 second delay:
```javascript
return {
  transcript: "The study found that sleep deprivation affects younger adults more strongly than previously thought, increasing blood pressure risk by forty percent."
}
```

### services/scoring/ScoringService.js
Model-agnostic evaluate() interface:
```javascript
// Input: { transcript: string, passageText: string, passageId: string }
// Output: { score: number, score_label: string, strengths: string, gaps: string, language_note: string }
async function evaluate(input) {}
```
This function delegates to ClaudeScorer only. RecordingScreen calls only this
function — never a scorer directly.
ScoringService does NOT call WhisperTranscriber. Transcription is handled in
RecordingScreen before evaluate() is called.

### services/scoring/ClaudeScorer.js
Phase 2 stub implementation: ignore inputs, return after 1.5 second delay:
```javascript
return {
  score: 3,
  score_label: "Good",
  strengths: "You accurately identified the main finding and mentioned the age-related effect.",
  gaps: "The specific risk percentage and the blood pressure connection were not clearly stated.",
  language_note: "Good use of reporting language. Consider using 'the researchers found' to signal the source."
}
```

### services/scoring/OpenAIScorer.js
Stub only — export the interface with a not-implemented error:
```javascript
async function evaluate(input) {
  throw new Error("OpenAIScorer not implemented")
}
```

---

## FOLDER STRUCTURE ADDITIONS

frontend/src/
├── screens/
│   ├── RecordingScreen.jsx         ← NEW
│   └── FeedbackScreen.jsx          ← REPLACE stub with full implementation
├── services/
│   ├── transcription/
│   │   └── WhisperTranscriber.js   ← NEW
│   └── scoring/
│       ├── ScoringService.js       ← NEW
│       ├── ClaudeScorer.js         ← NEW
│       └── OpenAIScorer.js         ← NEW
└── hooks/
    └── useRecorder.js              ← NEW (Web Audio API logic)

---

## HOOKS

### hooks/useRecorder.js
Encapsulate all Web Audio API / MediaRecorder logic here.
Expose:
- `isRecording` — boolean state
- `startRecording()` — requests mic permission, starts MediaRecorder
- `stopRecording()` — stops MediaRecorder, returns audioBlob
- `error` — any permission or recording errors

Keep all recording logic out of the screen component.

---

## ROUTING

Current routes (do not change):
- / → EntryScreen
- /menu → PassageMenu
- /passage/:id → PassageDetail

Add:
- /record/:id → RecordingScreen
- /feedback/:id → FeedbackScreen

Pass score result from RecordingScreen to FeedbackScreen via React Router
location state (not URL params, not localStorage) using the exact state
shape defined above.

---

## DO NOT TOUCH IN THIS PHASE

- passages.json — do not modify
- EntryScreen.jsx — do not modify
- PassageMenu.jsx — do not modify
- PassageDetail.jsx — only modify to fix the Begin Task navigation to /record/:id
- vite.config.js — do not modify
- Firebase configuration — do not create or modify
- Any environment variables or .env files

---

## BUILD ORDER

Complete in this exact order:

1. useRecorder.js hook
2. WhisperTranscriber.js stub
3. ClaudeScorer.js stub
4. OpenAIScorer.js stub
5. ScoringService.js (delegates scoring to ClaudeScorer — does NOT perform transcription)
6. RecordingScreen.jsx
7. FeedbackScreen.jsx (full implementation replacing stub)
8. Update routing in App.jsx or router file
9. Fix Begin Task navigation in PassageDetail.jsx

---

## VALIDATION BEFORE MARKING PHASE 2 COMPLETE

Walk this full flow end to end:

1. Enter with test access code → Passage Menu loads
2. Click passage card → Passage Detail loads
3. Play audio (or simulate) → Begin Task button enables
4. Click Begin Task → Recording Screen loads
5. Click Record → browser requests microphone permission
6. Click Stop/Submit → loading indicator "Analyzing your response..." appears
7. After stub delay → Feedback Screen loads with:
   - Score 3 displayed prominently
   - Score label "Good"
   - Mock transcript visible labeled "What we heard you say:"
   - Passage text visible (first time shown)
   - Strengths, gaps, language note all visible
   - All three navigation buttons present
   - Retry NOT emphasized (score is 3, emphasis only for 1 or 2)
8. Click Retry → returns to Recording Screen with clean state (no prior transcript or score)
9. Click Return to Menu → returns to Passage Menu

If all 9 steps pass, Phase 2 is complete.

---

## GOVERNANCE REMINDERS

- Do not add features not listed here
- Do not redesign any existing screen
- Do not rename spec field names
- Do not call ClaudeScorer directly from any UI component
- Ask before omitting any requirement
- Ask before expanding scope
- Favor simple, readable implementations over abstraction

---
*B10-PP Phase 2 Kickoff Prompt v1.1 — DLIELC — Jeff Moore — April 2, 2026*
