#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Spec drift detector — read-only, no network, no emulator.
//
// WHY THIS EXISTS
//
// Four times in one day (Sep 10, 2026) a spec document was found carrying an
// explicit open pointer that a LATER decision had already resolved, with
// nothing linking the two:
//   · AP item list       — descriptive list wrong, structural check right
//   · week map           — import spec said "no such file exists on disk yet";
//                          the file had existed for six hours
//   · CTW §4 + Review    — deferral closed Sep 4 in Data Model v1.12; both
//                          documents still carry the open-item language
//   · BAS §2.2 + Review  — deferral never closed, and duplicated across two
//                          documents
//
// Each was found by accident, mid-build, while doing something else. This
// turns "someone notices eventually" into a list. It decides nothing: it
// reports pointers so a human can check them against the data model's
// changelog. Deliberately dumb, deliberately cheap.
//
// VERSION AWARENESS IS THE WHOLE TRICK. The corpus keeps every version of a
// document side by side (15 of TOEFL_Security_Rules_Spec, 12 of the data
// model). Superseded versions will always contain stale language, and that is
// correct — they are history. Scanning everything yields 104 hit files and is
// useless; scanning only the newest version of each family is actionable.
//
// Usage:
//   node scripts/checkSpecDrift.js              latest version of each doc
//   node scripts/checkSpecDrift.js --all        every version, including superseded
//   node scripts/checkSpecDrift.js --quiet      only the KNOWN-RESOLVED section
//
// Exit code: 1 if any pointer we KNOW was resolved is still open (actionable
// staleness), 0 otherwise. A genuinely-open pointer is informational, not a
// failure — plenty of them are open on purpose.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOTS = [
  path.join(os.homedir(), "toefl", "build"),
  path.join(os.homedir(), "toefl-corpus"),
];

const OPT = {
  all: process.argv.includes("--all"),
  quiet: process.argv.includes("--quiet"),
};

// Phrases that mark an unresolved pointer. Kept literal and few — the goal is
// high signal, not exhaustive coverage of every way English defers a decision.
const PATTERNS = [
  [/not yet resolved/i,                    "not yet resolved"],
  [/\bopen item\b/i,                       "open item"],
  [/never obtained/i,                      "never obtained"],
  [/provenance unconfirmed/i,              "provenance unconfirmed"],
  [/unconfirmed as of this version/i,      "unconfirmed as of this version"],
  [/no such file exists/i,                 "no such file exists"],
  // Apostrophe-tolerant: corpus docs mix ASCII ' and Unicode '. Verb form
  // tolerant too — the real text says "confirmED with the platform".
  [/confirm(?:ed)? with the platform/i,    "confirm with the platform"],
  [/platform[\u2019']s scoring implementation/i, "defers to platform scoring"],
  [/not determinable/i,                    "not determinable"],
  [/needs a real decision/i,               "needs a real decision"],
  [/\bstill open\b/i,                      "still open"],
  [/\bSTILL OPEN:/,                        "STILL OPEN:"],
];

// Pointers we know the resolution for. A hit here is ACTIONABLE staleness: the
// decision exists, the document has not caught up. Matched on filename stem so
// it survives version bumps.
const KNOWN_RESOLVED = [
  {
    stem: "CTW_Content_Spec",
    match: /platform's scoring implementation|not determinable/i,
    resolution:
      "CTW per-gap partial credit — RESOLVED Sep 4, 2026 (JC), recorded in " +
      "TOEFL_Firestore_Data_Model_Spec v1.12: binary per gap, no partial credit.",
  },
  {
    stem: "CTW_Review_Prompt",
    match: /open item|not yet resolved/i,
    resolution:
      "Same CTW partial-credit question — RESOLVED Sep 4, 2026 (Data Model v1.12). " +
      "Check 6's open-item note is stale.",
  },
  {
    stem: "BAS_Content_Spec",
    match: /platform's scoring implementation|not determinable/i,
    resolution:
      "BAS partial credit / order equivalence — RESOLVED Sep 10, 2026 (corpus, with JC): " +
      "exact-match against a single accepted ordering; live grammatical-equivalence " +
      "checking rejected; multi-valid items to be handled by a future reviewer-populated " +
      "array. §2.2 replacement text drafted, pending version-convention decision.",
  },
  {
    stem: "BAS_Review_Prompt",
    match: /open item|not yet resolved/i,
    resolution:
      "Same BAS question — RESOLVED Sep 10, 2026. Check 3's open-item note needs the " +
      "same closure or the fix only relocates.",
  },
  {
    stem: "TOEFL_Import_Script_Spec",
    match: /no such file exists/i,
    resolution:
      "Week map — toefl_week_map_v1_0.json has existed since Sep 8, 2026 08:18, about " +
      "six hours BEFORE the spec version that says it does not exist.",
  },
];

// ── Version-aware file selection ─────────────────────────────────────────────

function collect() {
  const files = [];
  for (const root of ROOTS) {
    if (!fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root)) {
      if (!name.endsWith(".md")) continue;
      files.push(path.join(root, name));
    }
  }
  if (OPT.all) return files.sort();

  // Group by stem, keep the highest _vN_M. Unversioned files always kept.
  const families = new Map();
  const plain = [];
  for (const f of files) {
    const base = path.basename(f);
    const m = base.match(/^(.*)_v(\d+)_(\d+)\.md$/);
    if (!m) { plain.push(f); continue; }
    const [, stem, maj, min] = m;
    const key = path.dirname(f) + "::" + stem;
    const rank = Number(maj) * 10000 + Number(min);
    const cur = families.get(key);
    if (!cur || rank > cur.rank) families.set(key, { file: f, rank });
  }
  return [...plain, ...[...families.values()].map((v) => v.file)].sort();
}

function stemOf(file) {
  return path.basename(file).replace(/_v\d+_\d+\.md$/, "").replace(/\.md$/, "");
}

// ── Scan ─────────────────────────────────────────────────────────────────────

const files = collect();
const hits = [];
for (const file of files) {
  let lines;
  try {
    lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  } catch {
    continue; // unreadable (permissions) — skip rather than crash
  }
  lines.forEach((line, i) => {
    for (const [re, label] of PATTERNS) {
      if (re.test(line)) {
        hits.push({
          file,
          stem: stemOf(file),
          line: i + 1,
          label,
          // FULL line retained deliberately. The first draft stored only a
          // 150-char excerpt and matched KNOWN_RESOLVED against THAT, which
          // silently missed 2 of 5 known instances: the phrases sit at char
          // 236 (CTW_Content_Spec) and char 553 (import spec) of lines 397 and
          // 673 chars long. The report still truncates for display; matching
          // never does.
          full: line.trim(),
          excerpt: line.trim().slice(0, 150),
        });
        break; // one hit per line is enough
      }
    }
  });
}

// Split into known-resolved (actionable) and genuinely open (informational).
const stale = [];
const open = [];
for (const h of hits) {
  const known = KNOWN_RESOLVED.find(
    (k) => h.stem === k.stem && k.match.test(h.full)
  );
  (known ? stale : open).push(known ? { ...h, resolution: known.resolution } : h);
}

// ── Report ───────────────────────────────────────────────────────────────────

console.log("─".repeat(78));
console.log("TOEFL spec drift check");
console.log(
  `scanned ${files.length} document(s)` +
    (OPT.all ? " (--all: every version)" : " (latest version of each family)")
);
console.log("─".repeat(78));

console.log(
  `\n=== STALE: pointer open in the doc, but the decision exists (${stale.length}) ===\n`
);
if (!stale.length) {
  console.log("  none — every known resolution is reflected in its document");
} else {
  const byStem = {};
  for (const s of stale) (byStem[s.stem] = byStem[s.stem] || []).push(s);
  for (const [stem, list] of Object.entries(byStem)) {
    console.log(`  ${stem}`);
    console.log(`    RESOLUTION: ${list[0].resolution}`);
    for (const s of list) {
      console.log(`      ${path.basename(s.file)}:${s.line}  [${s.label}]`);
      console.log(`        ${s.excerpt}`);
    }
    console.log("");
  }
}

if (!OPT.quiet) {
  console.log(`=== OPEN: pointers with no recorded resolution (${open.length}) ===`);
  console.log("  Informational. Many are open on purpose; this is a list to check,");
  console.log("  not a list of defects.\n");
  const byStem = {};
  for (const o of open) (byStem[o.stem] = byStem[o.stem] || []).push(o);
  for (const stem of Object.keys(byStem).sort()) {
    const list = byStem[stem];
    console.log(`  ${stem}  (${list.length})`);
    for (const o of list.slice(0, 4)) {
      console.log(`      :${o.line}  [${o.label}]  ${o.excerpt.slice(0, 108)}`);
    }
    if (list.length > 4) console.log(`      ... and ${list.length - 4} more`);
  }
}

// ── Detector self-check ──────────────────────────────────────────────────────
//
// A KNOWN_RESOLVED entry that finds nothing means one of two things, and they
// are opposite: the document was fixed (success — remove the entry), or the
// detector stopped matching it (failure — a silently blind checker). The first
// draft of this script hit exactly that failure and reported a confident
// "3 stale" while missing two of the five instances it was built for. Never
// let a zero-hit entry pass unremarked.
const unmatched = KNOWN_RESOLVED.filter(
  (k) => !stale.some((s) => s.stem === k.stem)
);
console.log(`=== DETECTOR SELF-CHECK (${KNOWN_RESOLVED.length} known instances) ===\n`);
if (!unmatched.length) {
  console.log(`  all ${KNOWN_RESOLVED.length} known instances still detected`);
} else {
  for (const u of unmatched) {
    console.log(`  NOT DETECTED: ${u.stem}`);
    console.log(`     Either the document was fixed (remove this entry) or the`);
    console.log(`     detector no longer matches it (fix the pattern). Verify by hand.`);
  }
}

console.log(
  `\n${stale.length ? "DRIFT FOUND" : "NO KNOWN DRIFT"} — ` +
    `${stale.length} stale, ${open.length} open, across ${files.length} documents.\n`
);
process.exit(stale.length ? 1 : 0);
