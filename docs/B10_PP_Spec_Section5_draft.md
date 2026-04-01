# B10-PP Spec — Section 5: Passage Menu and Selection
**Version:** 0.1 Draft
**Status:** DRAFT — Pending Jeff Moore review and approval

---

## SECTION 5 — PASSAGE MENU AND SELECTION

### 5.1 Overview

After entering the platform via access code, students land on the Passage Menu. This screen serves two functions:

1. **Assigned set view** — displays the passages the instructor has assigned via the access code, with completion status and navigation
2. **Browse library** — provides access to the full B10 passage corpus for independent practice beyond the assigned set

These two views are presented on the same screen, with the assigned set displayed prominently and the browse library accessible as a secondary option.

---

### 5.2 Assigned Set View

The assigned set is displayed at the top of the Passage Menu immediately upon entry. It contains only the passages associated with the student's access code.

**Passage card — information displayed:**

| Field | Display |
|-------|---------|
| Passage ID | e.g., B10-COR-HLT-004 |
| Domain label | e.g., Health & Medicine |
| Layer | ORIENT / CORE / EXT |
| Tier | Tier 0 / Tier 1 / Tier 2 (CORE passages only) |
| EXT band + PIL level | e.g., EXT-M / PIL-F (EXT passages only) |
| Completion status | Not Started / In Progress / Completed |

**What is NOT displayed on the passage card:**
- Passage text (never shown in the menu)
- Word count
- Score from previous attempt (visible on Feedback Screen only, not in menu)

**Completion status logic:**
- **Not Started** — student has not yet played the audio for this passage
- **In Progress** — student has played the audio but not yet submitted a response
- **Completed** — student has submitted at least one response for this passage

Completed passages remain accessible and selectable for retry. Completion status does not lock a passage.

---

### 5.3 Browse Library

The browse library gives students access to the full B10 passage corpus beyond their assigned set. It is available as a secondary view on the Passage Menu.

**Organization — three-axis browsing:**

Students can filter and browse by any combination of:

| Filter axis | Options |
|-------------|---------|
| Domain cluster | L&W (Learning & Work) / H&E (Health & Environment) / G&S (Governance & Society) / T&S (Technology & Science) / C&B (Culture & Behavior) |
| Layer | ORIENT / CORE / EXT |
| Tier / Band | Tier 0 / Tier 1 / Tier 2 (CORE) — EXT-S / EXT-M / EXT-L (EXT) |

Passage cards in the browse library display the same fields as assigned set cards (Section 5.2).

**Access model — open with session tagging:**

Students may attempt any passage in the browse library. Browse library attempts are fully functional — audio plays, response is recorded, Whisper transcribes, Claude scores, feedback is returned.

However, browse library session data is tagged differently from assigned set data:

| Data field | Assigned set | Browse library |
|------------|-------------|----------------|
| Session type tag | `assigned` | `independent_practice` |
| Visible in instructor dashboard | ✅ Yes — under assigned results | ✅ Yes — under separate independent practice view |
| Counted toward assigned set completion | ✅ Yes | ❌ No |

This tagging ensures instructors can distinguish between required assigned work and student-initiated independent practice, while still having visibility into all activity.

---

### 5.4 Passage Selection and Navigation

**Selecting a passage:**
- Student taps or clicks a passage card to open the Passage Detail screen (Section 3.4)
- No confirmation step required — selection goes directly to Passage Detail

**Returning to the menu:**
- Available at any point via a clearly labeled "Return to Menu" option
- From the Feedback Screen, "Return to Menu" is one of three post-feedback navigation options (Section 3.6)

**Passage ordering in assigned set:**
- Passages are displayed in the order defined by the instructor at code creation
- Default order follows B10 curriculum sequence (Set → Phase → Tier progression) unless instructor specifies otherwise

---

### 5.5 Design Notes

- The passage text is never displayed in the Passage Menu. Domain, layer, tier, and status only.
- The browse library does not display passages that have not yet been canonized or released. Only validated, production-ready passages appear.
- Students with no assigned set (edge case — access code with browse-only configuration) land directly on the browse library view. This is not a standard use case in MVP.
- Passage card design must be mobile-optimized — large tap targets, readable at small screen sizes, clear status indicators that do not rely on color alone.

---

### 5.6 Passage Menu Summary

```
PASSAGE MENU
│
├── ASSIGNED SET (top / primary view)
│     └── Passage cards filtered by access code
│           Fields: ID / Domain / Layer / Tier or EXT band+PIL / Status
│           Status: Not Started / In Progress / Completed
│           All passages selectable including completed (retry allowed)
│
└── BROWSE LIBRARY (secondary view)
      └── Full B10 corpus
            Organized by: Domain cluster / Layer / Tier or Band
            Attempts allowed — tagged as independent_practice
            Not counted toward assigned set completion
            Visible to instructor under separate dashboard view
```

---
*B10 Practice Platform Spec — Section 5 — DLIELC — Jeff Moore — March 2026*
