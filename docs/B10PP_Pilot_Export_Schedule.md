# B10-PP Pilot Data Export — Pull Commands & Schedule

**Pilot window:** Monday, July 27, 2026 – six weeks (through approximately Friday, September 4, 2026)
**Script:** `export_week.js` in `~/b10_corpus/b10_practice_platform/`
**Output location:** `~/b10_pilot_archive/W<n>/transcripts/` and `~/b10_pilot_archive/W<n>/scores/`
**Retention constraint:** `transcriptText` is automatically nulled by the platform's Cloud Function 30 days after a submission is created. Pull each week's data well before that window closes — the schedule below builds in a wide safety margin.

---

## How to run a pull

From the repo directory, on the home machine (`moore-Inspiron-3505`):

```bash
cd ~/b10_corpus/b10_practice_platform
node export_week.js <weekNumber>
```

Where `<weekNumber>` is `1` through `6`.

### The six commands

```bash
node export_week.js 1
node export_week.js 2
node export_week.js 3
node export_week.js 4
node export_week.js 5
node export_week.js 6
```

Each run:
- Reads (read-only — no writes to Firestore) that week's `assignments` and matching `submissions`
- Writes two CSVs locally: one scores-only, one with full transcript text
- Appends one line to `~/b10_pilot_archive/MANIFEST.txt` recording what was pulled and when

---

## Suggested pull schedule

Approximate week windows (pilot starts Monday, July 27, 2026):

| Week | Dates (approx.) | Suggested pull date |
|---|---|---|
| W1 | Jul 27 – Jul 31 | Mon, Aug 3 |
| W2 | Aug 3 – Aug 7 | Mon, Aug 10 |
| W3 | Aug 10 – Aug 14 | Mon, Aug 17 |
| W4 | Aug 17 – Aug 21 | Mon, Aug 24 |
| W5 | Aug 24 – Aug 28 | Mon, Aug 31 |
| W6 | Aug 31 – Sep 4 | Mon, Sep 7 (final pull) |

**Habit:** each Monday, pull the week that just concluded. This keeps every pull at least ~25 days inside the 30-day retention window, even accounting for a missed week or two. If a Monday is skipped, catching up the following week is still safe — nothing is lost until 30 days after a given submission's `createdAt`.

---

## After each pull — quick checks worth doing

1. **Scan the scores CSV for blank `score`/`score_label` fields** — this can indicate a submission that was received but never scored (Cloud Function issue). Worth checking Firebase Functions logs for that `submissionId` if found.
2. **Scan `createdAt` for dates before the pilot start (July 27, 2026)** — these are likely leftover test/dev data, not real pilot responses, and should probably be excluded from analysis.
3. To view the scores file in a spreadsheet:
   ```bash
   libreoffice --calc ~/b10_pilot_archive/W<n>/scores/W<n>_scores_*.csv
   ```

---

## End of pilot — auth cleanup

Recorded in `~/b10_pilot_archive/MANIFEST.txt`:

```bash
gcloud auth application-default revoke
```

Run this once the final (Week 6) pull is complete and no further exports are needed.
