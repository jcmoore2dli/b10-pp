// export_week.js
// READ-ONLY export script for B10-PP pilot transcript/score data.
// Contains ONLY .get() calls. No .set(), .update(), .delete(), .add(),
// or batch writes anywhere in this file. Verify with:
//   grep -nE "\.set\(|\.update\(|\.delete\(|\.add\(|batch\(" export_week.js
// (should return nothing)
//
// Usage: node export_week.js <weekNumber>
// Example: node export_week.js 1
//
// Requires: firebase-admin (already a dependency of this repo)
// Auth: uses Application Default Credentials (gcloud auth application-default login)
// Output: CSV written to ~/b10_pilot_archive/W<n>/transcripts/ and
//         ~/b10_pilot_archive/W<n>/scores/, plus a line appended to
//         ~/b10_pilot_archive/MANIFEST.txt

const admin = require("firebase-admin");
const fs = require("fs");
const os = require("os");
const path = require("path");

const weekArg = process.argv[2];
if (!weekArg || !/^[1-6]$/.test(weekArg)) {
  console.error("Usage: node export_week.js <weekNumber 1-6>");
  process.exit(1);
}
const weekLabel = `W${weekArg}`;

// Initialize using Application Default Credentials — no service account
// key file is read or referenced here.
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: "b10-practice-platform",
});

const db = admin.firestore();

const ARCHIVE_ROOT = path.join(os.homedir(), "b10_pilot_archive");
const WEEK_DIR = path.join(ARCHIVE_ROOT, weekLabel);
const TRANSCRIPTS_DIR = path.join(WEEK_DIR, "transcripts");
const SCORES_DIR = path.join(WEEK_DIR, "scores");
const MANIFEST_PATH = path.join(ARCHIVE_ROOT, "MANIFEST.txt");

function csvEscape(val) {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function tsToIso(ts) {
  if (!ts) return "";
  if (typeof ts.toDate === "function") return ts.toDate().toISOString();
  return String(ts);
}

async function main() {
  console.log(`Reading assignments for ${weekLabel} (aesopWeek == "${weekLabel}")...`);

  // Step 1: find all Frames/ESO assignments for this week.
  // READ-ONLY: .get() only.
  const assignmentsSnap = await db
    .collection("assignments")
    .where("aesopWeek", "==", weekLabel)
    .get();

  console.log(`Found ${assignmentsSnap.size} assignment doc(s) for ${weekLabel}.`);

  // Build a map of studentId (b10Id) -> assignment info, and collect the
  // set of passageIds assigned this week so we can match submissions
  // against them if a submission doesn't carry an explicit week field.
  const studentIds = new Set();
  const weekPassageIds = new Set();
  assignmentsSnap.forEach((doc) => {
    const data = doc.data();
    // NOTE: assignments docs use field name "studentId" (confirmed via
    // grep of functions/index.js), while submissions docs use "b10Id"
    // for the same underlying identifier. Do not conflate the two field
    // names — this is a genuine schema inconsistency across collections.
    if (data.studentId) studentIds.add(data.studentId);
    (data.passageIds || []).forEach((pid) => weekPassageIds.add(pid));
  });

  console.log(`Students in ${weekLabel}: ${studentIds.size}. Distinct passageIds: ${weekPassageIds.size}.`);

  // Step 2: pull submissions for each student, filtered to this week's
  // passageIds, ordered by createdAt so day-within-week can be inferred
  // by position (1st = D1 ... last = D4/D5).
  // READ-ONLY: .get() only, no writes.
  const rows = [];
  for (const b10Id of studentIds) {
    // NOTE: no orderBy() here on purpose. Combining where() + orderBy()
    // on different fields requires a Firestore composite index, which
    // would mean modifying the live project's Firestore configuration.
    // Instead: fetch with the where() filter only (single-field, no
    // index needed), then sort by createdAt in memory below.
    const subsSnap = await db
      .collection("submissions")
      .where("b10Id", "==", b10Id)
      .get();

    const studentRows = [];
    subsSnap.forEach((doc) => {
      const d = doc.data();
      if (!weekPassageIds.has(d.passageId)) return; // not this week's frame
      studentRows.push({
        submissionId: doc.id,
        b10Id: d.b10Id || "",
        assignmentId: d.assignmentId || "",
        passageId: d.passageId || "",
        taskType: d.taskType || "",
        score: d.score !== undefined ? d.score : "",
        score_label: d.score_label || "",
        createdAt: tsToIso(d.createdAt),
        _createdAtRaw: d.createdAt,
        transcriptText: d.transcriptText || "",
      });
    });

    // Sort in memory by createdAt (ascending), then assign day-within-week
    // by position: 1st submission for this week = D1, ..., last = D4/D5.
    studentRows.sort((a, b) => {
      const aTime = a._createdAtRaw && a._createdAtRaw.toMillis ? a._createdAtRaw.toMillis() : 0;
      const bTime = b._createdAtRaw && b._createdAtRaw.toMillis ? b._createdAtRaw.toMillis() : 0;
      return aTime - bTime;
    });
    studentRows.forEach((r, idx) => {
      delete r._createdAtRaw;
      r.inferredDayInWeek = idx + 1;
      rows.push(r);
    });
  }

  console.log(`Collected ${rows.length} submission row(s) for ${weekLabel}.`);

  if (rows.length === 0) {
    console.log("No matching submissions found. No files written.");
    process.exit(0);
  }

  // Ensure output directories exist (creating local folders only — not a
  // Firestore write).
  fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
  fs.mkdirSync(SCORES_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  // Full combined CSV (transcripts + scores together) for convenience,
  const combinedHeader = [
    "submissionId", "b10Id", "assignmentId", "passageId", "taskType",
    "inferredDayInWeek", "score", "score_label", "createdAt", "transcriptText",
  ];
  const combinedPath = path.join(TRANSCRIPTS_DIR, `${weekLabel}_export_${timestamp}.csv`);
  const combinedLines = [combinedHeader.join(",")];
  rows.forEach((r) => {
    combinedLines.push(combinedHeader.map((h) => csvEscape(r[h])).join(","));
  });
  fs.writeFileSync(combinedPath, combinedLines.join("\n") + "\n");

  // Scores-only CSV (no transcript text) for quick score analysis without
  // opening the larger transcript file.
  const scoresHeader = [
    "submissionId", "b10Id", "assignmentId", "passageId", "taskType",
    "inferredDayInWeek", "score", "score_label", "createdAt",
  ];
  const scoresPath = path.join(SCORES_DIR, `${weekLabel}_scores_${timestamp}.csv`);
  const scoresLines = [scoresHeader.join(",")];
  rows.forEach((r) => {
    scoresLines.push(scoresHeader.map((h) => csvEscape(r[h])).join(","));
  });
  fs.writeFileSync(scoresPath, scoresLines.join("\n") + "\n");

  // Append a manifest line recording what was pulled and when.
  const manifestLine = `${new Date().toISOString()} | ${weekLabel} | records=${rows.length} | students=${studentIds.size} | cmd=node export_week.js ${weekArg} | transcripts=${combinedPath} | scores=${scoresPath}\n`;
  fs.appendFileSync(MANIFEST_PATH, manifestLine);

  console.log(`Wrote ${rows.length} rows to:`);
  console.log(`  ${combinedPath}`);
  console.log(`  ${scoresPath}`);
  console.log(`Manifest updated: ${MANIFEST_PATH}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("export_week.js failed:", err);
    process.exit(1);
  });
