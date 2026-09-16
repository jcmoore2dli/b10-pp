// scripts/toeflTts/larVoiceManifest.js
// LAR speaker gender and voice assignment, and its manifest.
//
// Rule (corpus ruling relayed by JC 2026-09-16): LAR uses North American
// voices only, Justin Time (NA_M) and Cecilia O'Connor (NA_F), in a 3:2
// male:female split matching the five ETS practice-test introductions
// (3 "he", 2 "she"). Order approved by JC 2026-09-16: M F M F M repeating by
// item number, so LAR-001 is M, LAR-002 F, ... LAR-006 M again. With 45 items
// that is 27 M and 18 F, never more than two of one gender in a row.
//
// The pattern position comes from the item number, not from the item's place
// among active items, so retiring an item never shifts anyone else. The
// manifest is the record: once an item has a gender it keeps it across reruns.
// The item's introduction text ("repeat what he/she says") must agree with it.

"use strict";

const fs = require("fs");
const path = require("path");
const { voiceConstantFor } = require("./config");

const SCHEMA = "toefl-lar-voice-manifest/1";
const LAR_FOLDER = "12_listen_repeat";
const ACCENT = "NA";
const PATTERN = Object.freeze(["M", "F", "M", "F", "M"]);
const RULE =
  "LAR speaker is North American only (NA_M Justin Time, NA_F Cecilia O'Connor), 3:2 M:F; " +
  "gender by item number, repeating M F M F M from LAR-001 (corpus ruling and JC approval 2026-09-16).";

const idNumber = (itemId) => Number(/^LAR-(\d+)$/.exec(itemId)[1]);
const patternGender = (itemId) => PATTERN[(idNumber(itemId) - 1) % PATTERN.length];

// STATUS filename varies by batch; same three patterns as importToeflCorpus.js.
function readStatus(dir, itemId) {
  for (const name of ["STATUS.txt", `STATUS_${itemId}.txt`, `${itemId}_STATUS.txt`]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  return null;
}

// Active LAR item IDs in ID order. Excluded: no layer1 file, no STATUS file,
// or a REJECT review status.
function listActiveLarItems(corpusRoot) {
  const base = path.join(corpusRoot, LAR_FOLDER);
  const excluded = [];
  const active = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^LAR-\d+$/.test(entry.name)) continue;
    const itemId = entry.name;
    const dir = path.join(base, itemId);
    if (!fs.existsSync(path.join(dir, `${itemId}_layer1_generation.md`))) {
      excluded.push({ itemId, reason: "no layer1 file" });
      continue;
    }
    const status = readStatus(dir, itemId);
    if (status === null) {
      excluded.push({ itemId, reason: "no STATUS file" });
      continue;
    }
    const verdict = /^Review status:\s*(.*)$/im.exec(status);
    if (verdict && /\bREJECT\b/i.test(verdict[1])) {
      excluded.push({ itemId, reason: "REJECT verdict" });
      continue;
    }
    active.push(itemId);
  }
  active.sort((a, b) => idNumber(a) - idNumber(b));
  return { active, excluded };
}

// Pure: build the next manifest from the active IDs and the previous manifest
// (or null). `today` is YYYY-MM-DD, stamped on newly assigned items only.
function assignLarVoices(activeIds, previous, today) {
  const prior = new Map((previous?.items ?? []).map((it) => [it.itemId, it]));
  const items = activeIds.map((itemId) => {
    const kept = prior.get(itemId);
    if (kept) return kept;
    const gender = patternGender(itemId);
    return { itemId, gender, accent: ACCENT, voiceConstant: voiceConstantFor(ACCENT, gender), assignedOn: today };
  });

  const activeSet = new Set(activeIds);
  const removedItems = [...(previous?.removedItems ?? [])];
  for (const [itemId, it] of prior) {
    if (!activeSet.has(itemId) && !removedItems.some((r) => r.itemId === itemId)) {
      removedItems.push({ itemId, gender: it.gender, removedOn: today });
    }
  }

  const warnings = [];
  for (const it of items) {
    if (it.gender !== patternGender(it.itemId)) {
      warnings.push(`${it.itemId} is ${it.gender} in the manifest but ${patternGender(it.itemId)} by the pattern`);
    }
  }
  for (let i = 2; i < items.length; i++) {
    if (items[i].gender === items[i - 1].gender && items[i].gender === items[i - 2].gender) {
      warnings.push(`${items[i - 2].itemId}..${items[i].itemId} are three ${items[i].gender} in a row`);
    }
  }

  return {
    manifest: { schema: SCHEMA, rule: RULE, pattern: PATTERN.join(""), items, removedItems },
    added: items.filter((it) => !prior.has(it.itemId)).map((it) => it.itemId),
    warnings,
  };
}

function readManifest(file) {
  if (!fs.existsSync(file)) return null;
  const m = JSON.parse(fs.readFileSync(file, "utf8"));
  if (m.schema !== SCHEMA) throw new Error(`${file}: unexpected schema ${m.schema}`);
  return m;
}

// Write via a temp file so an interrupted run never leaves a half manifest.
function writeManifest(file, manifest) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

module.exports = {
  SCHEMA,
  PATTERN,
  patternGender,
  listActiveLarItems,
  assignLarVoices,
  readManifest,
  writeManifest,
};
