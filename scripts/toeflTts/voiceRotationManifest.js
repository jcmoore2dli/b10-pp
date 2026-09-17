// scripts/toeflTts/voiceRotationManifest.js
// Voice assignment for the types whose corpus carries no voice fields at all:
// LTA and LTC. Gender and accent are both assigned by rotation over the item
// number and recorded in a manifest, exactly as LCR's gender and LAR's gender
// already are.
//
// JC 2026-09-17: neither gender nor accent exists for these types anywhere in
// the corpus or their Content Specs, so both are DEFAULTS — every item's entry
// carries assignmentStatus "default" and every clip generated from it is
// flagged "default applied, not individually confirmed" in the audio manifest.
// A later ruling can replace the rotation; the manifest is the record of what
// was actually used.
//
//   gender  alternates F, M, F, M ... by item number (LCR's convention)
//   accent  rotates NA, UK, AU, NZ, advancing every TWO items (the four
//           regions confirmed by corpus 2026-09-15). Advancing every item
//           would pair each accent with only one gender and so use just four
//           of the eight voices; every two items uses all eight.
//
// LTC is a two-speaker type: each item gets two voices, one per speaker label,
// same accent for both (one conversation, one place), genders opposite — the
// spec's "always one man and one woman".

"use strict";

const fs = require("fs");
const path = require("path");
const { voiceConstantFor } = require("./config");

const TYPES = Object.freeze({
  lta: { folder: "10_listen_announcement", prefix: "LTA", speakers: 1 },
  ltc: { folder: "08_listen_conversation", prefix: "LTC", speakers: 2 },
});
const GENDER_CYCLE = Object.freeze(["F", "M"]);
const ACCENT_CYCLE = Object.freeze(["NA", "UK", "AU", "NZ"]);
const RULE =
  "Gender and accent assigned by rotation over the item number (gender F/M, accent NA/UK/AU/NZ). " +
  "DEFAULT, not confirmed: neither field exists in the corpus or the Content Spec for this type " +
  "(JC 2026-09-17). Clips generated from these assignments are flagged default in the audio manifest.";

const idNumber = (itemId) => Number(/-(\d+)$/.exec(itemId)[1]);
const rotate = (n, cycle) => cycle[(n - 1) % cycle.length];
const rotateSlow = (n, cycle) => cycle[Math.floor((n - 1) / 2) % cycle.length];

function readStatus(dir, itemId) {
  for (const name of ["STATUS.txt", `STATUS_${itemId}.txt`, `${itemId}_STATUS.txt`]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  return null;
}

// Active item IDs in numeric order: a layer1 file, a STATUS file, no REJECT.
function listActiveItems(corpusRoot, taskType) {
  const cfg = TYPES[taskType];
  const base = path.join(corpusRoot, cfg.folder);
  const re = new RegExp(`^${cfg.prefix}-\\d+$`);
  const active = [];
  const excluded = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || !re.test(entry.name)) continue;
    const itemId = entry.name;
    const dir = path.join(base, itemId);
    if (!fs.existsSync(path.join(dir, `${itemId}_layer1_generation.md`))) { excluded.push({ itemId, reason: "no layer1 file" }); continue; }
    const status = readStatus(dir, itemId);
    if (status === null) { excluded.push({ itemId, reason: "no STATUS file" }); continue; }
    const verdict = /^(?:REVIEW STATUS|Review status):\s*(.*)$/im.exec(status);
    if (verdict && /\bREJECT\b/i.test(verdict[1])) { excluded.push({ itemId, reason: `review status: ${verdict[1].trim()}` }); continue; }
    active.push(itemId);
  }
  active.sort((a, b) => idNumber(a) - idNumber(b));
  return { active, excluded };
}

// Pure: build the manifest. Existing entries are kept, so an assignment never
// changes under an item once recorded.
function assignVoices(taskType, activeIds, previous, today) {
  const speakers = TYPES[taskType].speakers;
  const prior = new Map((previous?.items ?? []).map((i) => [i.itemId, i]));
  const items = activeIds.map((itemId) => {
    const kept = prior.get(itemId);
    if (kept) return kept;
    const n = idNumber(itemId);
    const accent = rotateSlow(n, ACCENT_CYCLE);
    const first = rotate(n, GENDER_CYCLE);
    const voices =
      speakers === 1
        ? [{ speakerLabel: null, gender: first, accent, voiceConstant: voiceConstantFor(accent, first) }]
        : [
            { speakerLabel: "Man", gender: "M", accent, voiceConstant: voiceConstantFor(accent, "M") },
            { speakerLabel: "Woman", gender: "F", accent, voiceConstant: voiceConstantFor(accent, "F") },
          ];
    return { itemId, accent, voices, assignmentStatus: "default", assignedOn: today };
  });

  const activeSet = new Set(activeIds);
  const removedItems = [...(previous?.removedItems ?? [])];
  for (const [itemId, it] of prior) {
    if (!activeSet.has(itemId) && !removedItems.some((r) => r.itemId === itemId)) {
      removedItems.push({ itemId, voices: it.voices, removedOn: today });
    }
  }
  return {
    manifest: { schema: `toefl-${taskType}-voice-manifest/1`, rule: RULE, genderCycle: GENDER_CYCLE.join(""), accentCycle: `${ACCENT_CYCLE.join(",")} (advancing every two items)`, items, removedItems },
    added: items.filter((it) => !prior.has(it.itemId)).map((it) => it.itemId),
  };
}

function readManifest(file, taskType) {
  if (!fs.existsSync(file)) return null;
  const m = JSON.parse(fs.readFileSync(file, "utf8"));
  if (m.schema !== `toefl-${taskType}-voice-manifest/1`) throw new Error(`${file}: unexpected schema ${m.schema}`);
  return m;
}

function writeManifest(file, manifest) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

module.exports = { TYPES, GENDER_CYCLE, ACCENT_CYCLE, RULE, listActiveItems, assignVoices, readManifest, writeManifest };
