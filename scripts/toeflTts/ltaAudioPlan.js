// scripts/toeflTts/ltaAudioPlan.js
// Listen to an Announcement (LTA) audio: one clip per item, the whole
// announcement, one speaker (LTA_Content_Spec v1.0 §6).
//
// Voice comes from audio/toefl/manifests/lta_voice_manifest.json, where gender
// and accent are both assigned by rotation because neither exists in the
// corpus — see voiceRotationManifest.js. Every clip is therefore flagged
// "default applied, not individually confirmed" in the audio manifest.
//
// Preset: toefl_lta_announcement, itself a documented default (config.js).
// No question clips: listening questions and options are on-screen text,
// verified by corpus against the 2026 Test Specification (2026-09-17).

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const LTA_FOLDER = "10_listen_announcement";
const PRESET = "toefl_lta_announcement";

const collapse = (s) => s.replace(/\s+/g, " ").trim();
const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

function readStatus(dir, itemId) {
  for (const name of ["STATUS.txt", `STATUS_${itemId}.txt`, `${itemId}_STATUS.txt`]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  return null;
}

// The ANNOUNCEMENT TEXT block: a bare LABEL: line, then text until a blank
// line followed by the next bare label — the same shape importToeflCorpus.js
// reads with plainBlock().
function parseLtaAnnouncement(body) {
  const m = /^ANNOUNCEMENT TEXT:\s*\n([\s\S]*?)(?=\n\s*\n[A-Z][A-Z0-9 \-/']*:|\n\s*\nQ\d|$)/m.exec(body);
  if (!m) throw new Error("no ANNOUNCEMENT TEXT block");
  const text = collapse(m[1]);
  if (!text) throw new Error("empty ANNOUNCEMENT TEXT block");
  return text;
}

// Returns { items, excluded }. Each item: { itemId, voiceConstant, preset, clips: [one] }.
function buildLtaPlan(corpusRoot, voiceManifest, { only = null } = {}) {
  const base = path.join(corpusRoot, LTA_FOLDER);
  const assigned = new Map((voiceManifest?.items ?? []).map((i) => [i.itemId, i]));
  const items = [];
  const excluded = [];
  const dirs = fs
    .readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^LTA-\d+$/.test(e.name))
    .map((e) => e.name)
    .sort();

  for (const itemId of dirs) {
    if (only && !only.includes(itemId)) continue;
    const dir = path.join(base, itemId);
    const skip = (reason) => excluded.push({ itemId, reason });

    const layer1 = path.join(dir, `${itemId}_layer1_generation.md`);
    if (!fs.existsSync(layer1)) { skip("no layer1 file"); continue; }
    const status = readStatus(dir, itemId);
    if (status === null) { skip("no STATUS file"); continue; }
    const verdict = /^(?:REVIEW STATUS|Review status):\s*(.*)$/im.exec(status);
    if (verdict && /\bREJECT\b/i.test(verdict[1])) { skip(`review status: ${collapse(verdict[1])}`); continue; }

    let text, voice;
    try {
      text = parseLtaAnnouncement(fs.readFileSync(layer1, "utf8"));
      const entry = assigned.get(itemId);
      if (!entry) throw new Error("not in lta_voice_manifest.json");
      if (entry.voices.length !== 1) throw new Error(`voice manifest has ${entry.voices.length} voices, expected 1`);
      voice = entry.voices[0];
    } catch (err) {
      skip(err.message);
      continue;
    }

    items.push({
      itemId,
      gender: voice.gender,
      accent: voice.accent,
      voiceConstant: voice.voiceConstant,
      preset: PRESET,
      clips: [{
        clip: "stimulus",
        file: path.join("lta", itemId, `${itemId}_stimulus.mp3`),
        text,
        textSent: text,
        textSha256: sha256(text),
        words: text.split(/\s+/).filter((t) => /[A-Za-z0-9]/.test(t)).length,
      }],
    });
  }

  if (only) {
    for (const id of only) if (!dirs.includes(id)) excluded.push({ itemId: id, reason: "no such item folder" });
  }
  return { items, excluded };
}

module.exports = { PRESET, parseLtaAnnouncement, buildLtaPlan, sha256 };
