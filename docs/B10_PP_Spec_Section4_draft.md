# B10-PP Spec — Section 4: Access, Auth, and Class Code System
**Version:** 0.1 Draft
**Status:** DRAFT — Pending Jeff Moore review and approval

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
