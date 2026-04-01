# B10-PP Spec — Section 7: Recording and Transcription
**Version:** 0.1 Draft
**Status:** DRAFT — Pending Jeff Moore review and approval

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
