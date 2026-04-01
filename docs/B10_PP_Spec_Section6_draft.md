# B10-PP Spec — Section 6: Audio Delivery
**Version:** 0.1 Draft
**Status:** DRAFT — Pending Jeff Moore review and approval

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
