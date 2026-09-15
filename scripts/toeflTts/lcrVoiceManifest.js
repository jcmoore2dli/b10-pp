// scripts/toeflTts/lcrVoiceManifest.js
// LCR speaker-gender assignment and its manifest.
//
// Rule: LCR Content Spec v1.4 §TTS — "single speaker per prompt; alternate
// gender across items". No per-item field records it, so gender is assigned
// by corpus ID order (approved by JC 2026-09-15) and written to a manifest.
//
// The manifest is the record. Once an item has a gender it keeps it across
// reruns; new items continue the alternation from the item before them.
// Adjacent same-gender pairs (e.g. after an item is retired) are reported as
// warnings, never silently re-assigned. Accent and voice stay null until
// LCR's accent rule is decided.

"use strict";

const fs = require("fs");
const path = require("path");

const SCHEMA = "toefl-lcr-voice-manifest/1";
const LCR_FOLDER = "07_listen_choose_response";
const START_GENDER = "F";
const RULE =
  "Alternate speaker gender across LCR items in corpus ID order " +
  "(LCR Content Spec v1.4 §TTS; ID-order alternation approved by JC 2026-09-15).";

const otherGender = (g) => (g === "F" ? "M" : "F");
const idNumber = (itemId) => Number(/^LCR-(\d+)$/.exec(itemId)[1]);

// STATUS filename varies by batch; same three patterns as importToeflCorpus.js.
function readStatus(dir, itemId) {
  for (const name of ["STATUS.txt", `STATUS_${itemId}.txt`, `${itemId}_STATUS.txt`]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  return null;
}

// Active LCR item IDs in ID order. An item is excluded if it has no layer1
// file, no STATUS file, or a REJECT verdict (imported as retired, never served).
function listActiveLcrItems(corpusRoot) {
  const base = path.join(corpusRoot, LCR_FOLDER);
  const excluded = [];
  const active = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^LCR-\d+$/.test(entry.name)) continue;
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
function assignGenders(activeIds, previous, today) {
  const prior = new Map((previous?.items ?? []).map((it) => [it.itemId, it]));
  const items = [];
  for (const itemId of activeIds) {
    const kept = prior.get(itemId);
    if (kept) {
      items.push(kept);
      continue;
    }
    const before = items[items.length - 1];
    items.push({
      itemId,
      gender: before ? otherGender(before.gender) : START_GENDER,
      accent: null,
      voiceConstant: null,
      assignedOn: today,
    });
  }

  const activeSet = new Set(activeIds);
  const removedItems = [...(previous?.removedItems ?? [])];
  for (const [itemId, it] of prior) {
    if (!activeSet.has(itemId) && !removedItems.some((r) => r.itemId === itemId)) {
      removedItems.push({ itemId, gender: it.gender, removedOn: today });
    }
  }

  const warnings = [];
  for (let i = 1; i < items.length; i++) {
    if (items[i].gender === items[i - 1].gender) {
      warnings.push(
        `${items[i - 1].itemId} and ${items[i].itemId} are adjacent and both ${items[i].gender}`
      );
    }
  }

  return {
    manifest: { schema: SCHEMA, rule: RULE, startGender: START_GENDER, items, removedItems },
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
  START_GENDER,
  listActiveLcrItems,
  assignGenders,
  readManifest,
  writeManifest,
};
