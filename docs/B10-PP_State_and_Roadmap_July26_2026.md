# B10-PP State and Roadmap — July 26, 2026
(Supersedes June 29, 2026 version)

---

## PLATFORM STATUS

**Live URL:** https://b10-practice-platform.web.app/b10_practice_platform/
**Firebase project:** b10-practice-platform (nam5, Blaze plan)
**Repo:** github.com/jcmoore2dli/b10-pp
**Project root:** ~/b10_corpus/b10_practice_platform/
**Frontend:** frontend/src/
**Functions:** functions/index.js, functions/lib/claudeScorer.js
**Latest commit:** ba69f883 (Remove duplicate scoring prompt copies from docs/ and docs/repo_upload/ — governance/ is canon location)
**Pilot launch date:** July 27, 2026 (tomorrow) — confirmed hard date, unchanged from prior entry

No deploys occurred during this session. All work below is documentation, a new read-only export script, local archive scaffolding, and a git housekeeping pass — the live platform, Firestore data, and Firebase configuration were not modified.

---

## PILOT LAUNCH STATUS (NEW — July 26, 2026)

- Pilot launches tomorrow, July 27, 2026.
- Roster: 8 students in two sections of 4, two main instructors plus one emergency substitute.
- Group 1 (Quentin's): starting at Set 1.1 (partial prior CORE-listening-only exposure, framed as still building skills through repetition).
- Group 2 (vocabulary-focused instructor's): starting at Set 7, so the full 6-week pilot window lands in the mid-frequency (T2) vocabulary band rather than the T1-heavy Sets 1–6.
- LF (Linguistic Flexibility) scope change: moved from SLT pull-out only (infeasible at this student/instructor ratio) to running in the main class. Instructor Weekly Check-In v1.1 reflects this.

---

## PILOT DATA CAPTURE PROTOCOL (NEW — July 26, 2026)

**Framing:** the pilot's primary deliverable is feasibility, not efficacy. n=8, six weeks, informative attrition (students leave the cohort ~4 weeks in when they pass their official test), no access to official proficiency scores. The defensible claims are that it ran six weeks, what it cost, and where it broke — not growth claims.

**Audio:** none retained. Platform deletes student audio after 72 hours by design. Any future audio capture (e.g., a possible TESOL 2027 paper) would need prospective consent starting next cycle, not retroactively.

**Transcripts are the dataset.** `submissions.transcriptText` is automatically nulled by the existing `cleanupAudio` scheduled Cloud Function 30 days after `createdAt` — this was already implemented prior to tonight, not newly built, and enforces the 4-week retention policy without any additional code.

**No deploys during the pilot window** unless something is actively broken (no `npm run build`/`deploy`, no rsync, no Firebase Cloud Function or Firestore rules changes).

**Auth:** Application Default Credentials set up on the home machine (`gcloud auth application-default login`, project set to `b10-practice-platform`). Revocable at pilot end via `gcloud auth application-default revoke` (recorded in the archive MANIFEST).

**Archive location:** `~/b10_pilot_archive/{W1–W6}/{transcripts,scores}/`, plus `MANIFEST.txt`, `session_log.csv`, `exit_log.csv` — deliberately outside the git repo. `.gitignore` also hardened (`b10_pilot_archive/`, `*.transcripts.csv`, `serviceAccount*.json`) as belt-and-suspenders, though the archive's location alone already keeps it out of git.

**Export script:** `export_week.js` (repo root). Read-only by construction — verified via `grep` to contain no `.set()`/`.update()`/`.delete()`/`.add()`/`batch()` calls, only `.get()`. Node + `firebase-admin`, run as:

```bash
node export_week.js <weekNumber 1-6>
```

Schema notes discovered while building this:
- `assignments` docs use field `studentId`; `submissions` docs use field `b10Id` for the same underlying identifier — a genuine naming inconsistency across collections, not a bug.
- Frames/ESO assignments carry `aesopWeek` but no explicit day-within-week field (unlike CORE's `dayNumber`). Day-within-week is inferred by sorting a student's matching submissions by `createdAt` in memory. The script deliberately avoids Firestore's `orderBy()` for this to prevent triggering a composite-index requirement on the live project — sorting happens client-side after a single-field `.get()`.
- Tested successfully July 26, 2026 against live Week 1 data: found 4 real submission rows. Surfaced two things worth checking manually: one submission with a blank score (possible scoring failure, worth checking Cloud Function logs), and one submission dated before the pilot's July 27 launch (likely leftover test data, should probably be excluded from analysis).

**Pull schedule:** weekly, each Monday pulling the week that just concluded — see `docs/B10PP_Pilot_Export_Schedule.md` for the full command list and dated schedule through the pilot's end (~Sept 7, 2026).

**Workflow reference doc corrected:** `docs/B10PP_Workflow_Reference.md` had swapped machine labels (now correctly: `moore-Inspiron-3505` = home, `jcmoore2-Inspiron-15-3567` = work, matching `B10-PP_Project_Reference_and_Deploy_Governance.md`) and a wrong platform URL (now correctly includes the required `/b10_practice_platform/` subpath).

---

## CANON SCORING PROMPTS CONFIRMED (NEW — July 26, 2026)

Verified against the live code comments in `functions/lib/claudeScorer.js` and cross-checked with `md5sum` where duplicates existed:

| Task Type | Canon File | Location |
|---|---|---|
| ESO | `B10-PP_SECTION_8_PROMPT_4_ESO_v1_5_Rev4.txt` | `governance/` (no duplicates found) |
| NARRATION | `B10-PP_SECTION_8_PROMPT_4b_NARRATION_v1_3.txt` | `governance/` |
| DESCRIPTION | `B10-PP_Description_Scoring_Prompt_4c_v1_2.txt` | `governance/` |
| INSTRUCTIONS | `B10-PP_Instructions_Scoring_Prompt_4d_v1_5.txt` | `governance/` |
| PARAPHRASE + EXT | `B10_PP_Section8_Scoring_Prompts_v1.5.md` | `docs/` |

Duplicate copies of the three `governance/`-canon files previously also sat in `docs/` and `docs/repo_upload/`. Confirmed byte-identical via `md5sum` before removal; removed July 26, 2026 so `governance/` is the single source of truth. `docs/B10_PP_Section8_Scoring_Prompts_v1.4.md` is superseded by v1.5 and remains in place but should be treated as historical only.

---

## PILOT PARAMETERS (updated)

- **Launch:** July 27, 2026
- **Duration:** 6 weeks
- **Students:** 8, in two sections of 4 (narrower than the earlier 10–20 estimate)
- **Instructors:** 2 Main + 1 emergency substitute
- **Scaffold criteria for norming:** 17 (unchanged)

---

## KEY FILES — ADDITIONS (July 26, 2026)

### Pilot Data Capture
- `export_week.js` — read-only transcript/score export script (repo root)
- `docs/B10PP_Workflow_Reference.md` — corrected terminal/git/deploy reference
- `docs/B10PP_Pilot_Export_Schedule.md` — pull commands and weekly schedule

### Governance (confirmed canon, no path changes)
- `governance/B10-PP_SECTION_8_PROMPT_4_ESO_v1_5_Rev4.txt`
- `governance/B10-PP_SECTION_8_PROMPT_4b_NARRATION_v1_3.txt`
- `governance/B10-PP_Description_Scoring_Prompt_4c_v1_2.txt`
- `governance/B10-PP_Instructions_Scoring_Prompt_4d_v1_5.txt`

All other Key Files entries from the June 29, 2026 version are unchanged and still current — not reproduced here to avoid duplication; see that file for the full application/instructional-materials/deploy/audio-pipeline listing.
