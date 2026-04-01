# B10-PP Spec — Section 9: Instructor Dashboard
**Version:** 0.1 Draft
**Status:** DRAFT — Pending Jeff Moore review and approval

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
