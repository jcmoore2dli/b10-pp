# B10-PP Spec — Section 10: Data Storage
**Version:** 0.1 Draft
**Status:** DRAFT — Pending Jeff Moore review and approval

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
