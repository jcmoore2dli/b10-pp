// scripts/toeflTts/larAudioPlan.js
// Listen and Repeat (LAR) audio: which clips each item needs, in which voice.
//
// Eight clips per item, all in the item's one voice with the
// toefl_lar_trainer preset:
//   intro   — the INTRODUCTION field (LAR_Content_Spec v1.4 §2.3: the scenario
//             introduction, delivered aurally and in print, same voice as the
//             trainer's lines — no voice switch).
//   u1–u7   — the seven utterances, in the fixed 4-part order
//             (greeting / facilities / services / closing).
//
// Voice comes from audio/toefl/manifests/lar_voice_manifest.json: North
// American only, M F M F M by item number (JC 2026-09-16), so NA_M Justin Time
// or NA_F Cecilia O'Connor. The item's own INTRODUCTION SPEAKER GENDER must
// agree with the manifest, and the he/she in the introduction must agree with
// both; a disagreement excludes the item rather than guessing.
//
// No pause tags: the Interview short-question rule is Interview-specific. LAR
// utterances are delivered as written, at the preset's speed.
//
// Item selection: a layer1 file, a STATUS file, and a Review status that is not
// REJECT — the same gate the importer and the voice manifest use.

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { PRESETS, voiceConstantFor } = require("./config");

const LAR_FOLDER = "12_listen_repeat";
const PRESET = "toefl_lar_trainer";
const UTTERANCE_COUNT = 7;
const PARTS = Object.freeze(["greeting", "facilities", "services", "closing"]);
const ACCENT = "NA";

const collapse = (s) => s.replace(/\s+/g, " ").trim();
const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

// STATUS filename varies by batch; same three patterns as importToeflCorpus.js.
function readStatus(dir, itemId) {
  for (const name of ["STATUS.txt", `STATUS_${itemId}.txt`, `${itemId}_STATUS.txt`]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  return null;
}

// The INTRODUCTION field, the gender field, and the seven utterances.
function parseLarLayer1(body) {
  const intro = /^INTRODUCTION:\s*(.+)$/m.exec(body);
  if (!intro) throw new Error("no INTRODUCTION field");
  const genderLine = /^INTRODUCTION SPEAKER GENDER:\s*([MF])\s*$/m.exec(body);
  if (!genderLine) throw new Error("no INTRODUCTION SPEAKER GENDER field (M or F)");

  const section = /^UTTERANCE SET[^\n]*\n([\s\S]*?)\n\s*WORD COUNT PER UTTERANCE/m.exec(body);
  if (!section) throw new Error("no UTTERANCE SET block");
  const headers = [...section[1].matchAll(/^Part (\d) -- ([^\n:]+):\s*$/gm)];
  if (headers.length !== PARTS.length) throw new Error(`expected ${PARTS.length} Part headers, found ${headers.length}`);

  const utterances = [];
  headers.forEach((h, i) => {
    if (Number(h[1]) !== i + 1) throw new Error(`Part headers out of order at Part ${h[1]}`);
    const end = i + 1 < headers.length ? headers[i + 1].index : section[1].length;
    for (const line of section[1].slice(h.index + h[0].length, end).split(/\r?\n/)) {
      const text = collapse(line);
      if (text) utterances.push({ utteranceIndex: utterances.length + 1, text, part: PARTS[i] });
    }
  });
  if (utterances.length !== UTTERANCE_COUNT) {
    throw new Error(`expected ${UTTERANCE_COUNT} utterances, found ${utterances.length}`);
  }
  return { introduction: collapse(intro[1]), gender: genderLine[1], utterances };
}

// The introduction says "repeat what he says" or "what she says"; it must match.
function pronounGender(introduction) {
  const m = /\brepeat what (he|she) says\b/i.exec(introduction);
  if (!m) throw new Error('introduction has no "repeat what he/she says" instruction');
  return m[1].toLowerCase() === "he" ? "M" : "F";
}

// Returns { items, excluded }. Each item: { itemId, gender, voiceConstant, preset, clips }.
function buildLarPlan(corpusRoot, voiceManifest, { only = null } = {}) {
  const base = path.join(corpusRoot, LAR_FOLDER);
  const assigned = new Map((voiceManifest?.items ?? []).map((i) => [i.itemId, i]));
  const items = [];
  const excluded = [];
  const dirs = fs
    .readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^LAR-\d+$/.test(e.name))
    .map((e) => e.name)
    .sort();

  for (const itemId of dirs) {
    if (only && !only.includes(itemId)) continue;
    const dir = path.join(base, itemId);
    const skip = (reason) => excluded.push({ itemId, reason });

    const layer1Path = path.join(dir, `${itemId}_layer1_generation.md`);
    if (!fs.existsSync(layer1Path)) { skip("no layer1 file"); continue; }
    const status = readStatus(dir, itemId);
    if (status === null) { skip("no STATUS file"); continue; }
    const verdict = /^Review status:\s*(.*)$/im.exec(status);
    if (verdict && /\bREJECT\b/i.test(verdict[1])) { skip(`Review status: ${collapse(verdict[1])}`); continue; }

    let parsed;
    try {
      parsed = parseLarLayer1(fs.readFileSync(layer1Path, "utf8"));
      const fromVoiceManifest = assigned.get(itemId);
      if (!fromVoiceManifest) throw new Error("not in lar_voice_manifest.json");
      if (fromVoiceManifest.accent !== ACCENT) throw new Error(`manifest accent ${fromVoiceManifest.accent}, expected ${ACCENT}`);
      if (fromVoiceManifest.gender !== parsed.gender) {
        throw new Error(`gender mismatch: layer1 ${parsed.gender}, voice manifest ${fromVoiceManifest.gender}`);
      }
      const fromPronoun = pronounGender(parsed.introduction);
      if (fromPronoun !== parsed.gender) {
        throw new Error(`gender mismatch: field ${parsed.gender}, introduction pronoun implies ${fromPronoun}`);
      }
    } catch (err) {
      skip(err.message);
      continue;
    }

    const texts = [["intro", parsed.introduction], ...parsed.utterances.map((u) => [`u${u.utteranceIndex}`, u.text])];
    const settings = { ...PRESETS[PRESET] };
    items.push({
      itemId,
      gender: parsed.gender,
      voiceConstant: voiceConstantFor(ACCENT, parsed.gender),
      preset: PRESET,
      clips: texts.map(([clip, text], i) => ({
        clip,
        file: path.join("lar", itemId, `${itemId}_${clip}.mp3`),
        text,
        textSha256: sha256(text),
        words: text.split(/\s+/).filter((t) => /[A-Za-z0-9]/.test(t)).length,
        part: i === 0 ? null : parsed.utterances[i - 1].part,
        textSent: text, // no pause tags for LAR
        settings,
      })),
    });
  }

  if (only) {
    for (const id of only) {
      if (!dirs.includes(id)) excluded.push({ itemId: id, reason: "no such item folder" });
    }
  }
  return { items, excluded };
}

module.exports = { PRESET, UTTERANCE_COUNT, PARTS, parseLarLayer1, pronounGender, buildLarPlan, sha256 };
