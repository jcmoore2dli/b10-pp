# B10-PP Spec — Sections 11, 12, and 13
**Version:** 0.1 Draft
**Status:** DRAFT — Pending Jeff Moore review and approval

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
