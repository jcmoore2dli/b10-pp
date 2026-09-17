// scripts/toeflTts/lcrAudioPlan.js
// Listen and Choose a Response (LCR) audio: one clip per item, the single
// spoken prompt.
//
// LCR_Content_Spec v1.4 §2.1: "Single spoken utterance, single speaker",
// "audio only, never shown on screen". The four response options are written
// text and have no audio, so one clip per item.
//
// Voice comes from audio/toefl/manifests/lcr_voice_manifest.json: gender by
// the spec's confirmed alternation, accent by rotation as a DEFAULT because
// LCR's accent rule is still undecided (JC 2026-09-17). Clips are therefore
// flagged "default applied, not individually confirmed".
//
// Preset: toefl_lcr_prompt, itself a documented default (config.js), chosen
// because §6 makes intonation the critical property.

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const LCR_FOLDER = "07_listen_choose_response";
const PRESET = "toefl_lcr_prompt";

const collapse = (s) => s.replace(/\s+/g, " ").trim();
const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

function readStatus(dir, itemId) {
  for (const name of ["STATUS.txt", `STATUS_${itemId}.txt`, `${itemId}_STATUS.txt`]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  return null;
}

// **PROMPT TRANSCRIPT:** "…" — the same field importToeflCorpus.js reads,
// quotes stripped.
function parseLcrPrompt(body) {
  const m = /^\*\*PROMPT TRANSCRIPT:\*\*\s*(.+)$/m.exec(body);
  if (!m) throw new Error("no **PROMPT TRANSCRIPT:** line");
  const text = collapse(m[1]).replace(/^"|"$/g, "").trim();
  if (!text) throw new Error("empty **PROMPT TRANSCRIPT:**");
  return text;
}

function buildLcrPlan(corpusRoot, voiceManifest, { only = null } = {}) {
  const base = path.join(corpusRoot, LCR_FOLDER);
  const assigned = new Map((voiceManifest?.items ?? []).map((i) => [i.itemId, i]));
  const items = [];
  const excluded = [];
  const dirs = fs
    .readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^LCR-\d+$/.test(e.name))
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

    let text, entry;
    try {
      text = parseLcrPrompt(fs.readFileSync(layer1, "utf8"));
      entry = assigned.get(itemId);
      if (!entry) throw new Error("not in lcr_voice_manifest.json");
      if (!entry.voiceConstant) throw new Error("voice manifest entry has no voiceConstant");
    } catch (err) {
      skip(err.message);
      continue;
    }

    items.push({
      itemId,
      gender: entry.gender,
      accent: entry.accent,
      voiceConstant: entry.voiceConstant,
      preset: PRESET,
      clips: [{
        clip: "stimulus",
        file: path.join("lcr", itemId, `${itemId}_stimulus.mp3`),
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

module.exports = { PRESET, parseLcrPrompt, buildLcrPlan, sha256 };
