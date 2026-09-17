// scripts/toeflTts/atAudioPlan.js
// Academic Talk (AT) audio: one clip per item, the whole transcript.
//
// One clip per item (data model v1.18 draft, Appendix B: AT takes exactly one
// `stimulus` clip). Listening questions and options are on-screen text, never
// spoken — corpus verified that against the 2026 Test Specification on
// 2026-09-17 — so no question clips exist.
//
// Voice comes from the item's own STATUS fields, not from a manifest: AT items
// carry SPEAKER GENDER and ACCENT per item (AT_Content_Spec v1.7 §2.2: gender
// alternates across the corpus; accent is assigned per item). Both spellings
// appear in the corpus ("Female"/"F", "North American"/"NA"), so both are
// accepted and normalised to the config's accent/gender codes.
//
// Preset follows the item's REGISTER: "Academic lecture" -> toefl_at_lecture,
// "Popular academic (podcast)" -> toefl_at_podcast (AT_Content_Spec §2.2's two
// registers, and the two presets JC calibrated on 2026-09-15).
//
// Item selection: a layer1 file, a STATUS file, and a review verdict that is
// not REJECT — the same gate as the other types.

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { voiceConstantFor } = require("./config");

const AT_FOLDER = "02_academic_talk";
const REGISTER_PRESETS = Object.freeze({
  lecture: "toefl_at_lecture",
  podcast: "toefl_at_podcast",
});
const GENDERS = Object.freeze({ f: "F", female: "F", m: "M", male: "M" });
const ACCENTS = Object.freeze({
  na: "NA", "north american": "NA", "north-american": "NA",
  uk: "UK", british: "UK",
  au: "AU", australian: "AU",
  nz: "NZ", "new zealand": "NZ",
});

const collapse = (s) => s.replace(/\s+/g, " ").trim();
const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

function readStatus(dir, itemId) {
  for (const name of ["STATUS.txt", `STATUS_${itemId}.txt`, `${itemId}_STATUS.txt`]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  return null;
}

// The **TRANSCRIPT:** block, same boundaries as importToeflCorpus.js.
function parseAtTranscript(body) {
  const m = new RegExp(
    "^\\*\\*TRANSCRIPT:\\*\\*[^\\n]*\\n([\\s\\S]*?)(?=\\n\\*\\*(?!Q\\d)[A-Z][^\\n]*:\\*\\*|\\n---|(?![\\s\\S]))",
    "m"
  ).exec(body);
  if (!m) throw new Error("no **TRANSCRIPT:** block");
  const text = collapse(m[1]);
  if (!text) throw new Error("empty **TRANSCRIPT:** block");
  return text;
}

// STATUS carries the voice: SPEAKER GENDER and ACCENT, and REGISTER picks the preset.
function parseAtVoice(status) {
  const field = (label) => {
    const m = new RegExp(`^${label}:\\s*(.+)$`, "im").exec(status);
    return m ? collapse(m[1]) : null;
  };
  const rawGender = field("SPEAKER GENDER");
  const rawAccent = field("ACCENT");
  const rawRegister = field("REGISTER");
  if (!rawGender) throw new Error("no SPEAKER GENDER in STATUS");
  if (!rawAccent) throw new Error("no ACCENT in STATUS");
  if (!rawRegister) throw new Error("no REGISTER in STATUS");
  const gender = GENDERS[rawGender.toLowerCase()];
  const accent = ACCENTS[rawAccent.toLowerCase()];
  if (!gender) throw new Error(`unrecognised SPEAKER GENDER: ${JSON.stringify(rawGender)}`);
  if (!accent) throw new Error(`unrecognised ACCENT: ${JSON.stringify(rawAccent)}`);
  const register = /podcast|popular academic/i.test(rawRegister) ? "podcast" : /lecture/i.test(rawRegister) ? "lecture" : null;
  if (!register) throw new Error(`unrecognised REGISTER: ${JSON.stringify(rawRegister)}`);
  return { gender, accent, register, preset: REGISTER_PRESETS[register], rawGender, rawAccent, rawRegister };
}

// Returns { items, excluded }. Each item: { itemId, voiceConstant, preset, clips: [one] }.
function buildAtPlan(corpusRoot, { only = null } = {}) {
  const base = path.join(corpusRoot, AT_FOLDER);
  const items = [];
  const excluded = [];
  const dirs = fs
    .readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^AT-\d+$/.test(e.name))
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
      text = parseAtTranscript(fs.readFileSync(layer1, "utf8"));
      voice = parseAtVoice(status);
    } catch (err) {
      skip(err.message);
      continue;
    }

    items.push({
      itemId,
      gender: voice.gender,
      accent: voice.accent,
      register: voice.register,
      voiceConstant: voiceConstantFor(voice.accent, voice.gender),
      preset: voice.preset,
      clips: [{
        clip: "stimulus",
        file: path.join("at", itemId, `${itemId}_stimulus.mp3`),
        text,
        textSent: text, // no pause tags, no SSML
        textSha256: sha256(text),
        words: text.split(/\s+/).filter((t) => /[A-Za-z0-9]/.test(t)).length,
      }],
    });
  }

  if (only) {
    for (const id of only) {
      if (!dirs.includes(id)) excluded.push({ itemId: id, reason: "no such item folder" });
    }
  }
  return { items, excluded };
}

module.exports = { REGISTER_PRESETS, parseAtTranscript, parseAtVoice, buildAtPlan, sha256 };
