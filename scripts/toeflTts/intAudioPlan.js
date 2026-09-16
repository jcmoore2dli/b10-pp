// scripts/toeflTts/intAudioPlan.js
// Interview (INT) audio: which clips each item needs, in which voice.
//
// Each item gets five clips, all in the item's one interviewer voice with the
// toefl_int_interviewer preset:
//   intro  — the INTERVIEW CONTEXT framing. ETS 2026 Test Specifications,
//            Speaking "Stimulus": "Each task begins with a scenario
//            introduction, delivered both aurally and in print". Same voice as
//            the questions (JC 2026-09-16: no second, unexplained voice).
//   q1–q4  — the four question stems.
//
// Voice comes from the item's SPEAKER VOICE PROFILE ("Female, UK accent").
// The layer1 file and the STATUS file must agree. Item selection follows the
// importer's gate: LAYER 2 verdict PASS, CROSS-MODEL CHECK not failed.

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { voiceConstantFor } = require("./config");

const INT_FOLDER = "03_interview";
const PRESET = "toefl_int_interviewer";

const ACCENT_CODES = Object.freeze({
  "north american": "NA",
  uk: "UK",
  australian: "AU",
  "new zealand": "NZ",
});
const GENDER_CODES = Object.freeze({ female: "F", male: "M" });

const collapse = (s) => s.replace(/\s+/g, " ").trim();
const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

// "Female, UK accent — single consistent voice across all 4 questions"
function parseVoiceProfile(raw) {
  const m = /^\s*(Female|Male)\s*,\s*(North American|UK|Australian|New Zealand)\s+accent\b/i.exec(raw || "");
  if (!m) throw new Error(`unrecognised SPEAKER VOICE PROFILE: ${JSON.stringify(raw)}`);
  return { gender: GENDER_CODES[m[1].toLowerCase()], accent: ACCENT_CODES[m[2].toLowerCase()] };
}

// Text between a bold label line and the next bold label (not a **Qn** header)
// or a --- rule. Same boundaries as importToeflCorpus.js boldBlock().
function boldBlock(body, label) {
  const re = new RegExp(
    `^\\*\\*${label}:\\*\\*[^\\n]*\\n([\\s\\S]*?)(?=\\n\\*\\*(?!Q\\d)[A-Z][^\\n]*:\\*\\*|\\n---|(?![\\s\\S]))`,
    "m"
  );
  const m = re.exec(body);
  if (!m) throw new Error(`no **${label}:** block`);
  return m[1].trim();
}

function parseIntLayer1(body) {
  const profile = /^\*\*SPEAKER VOICE PROFILE:\*\*\s*(.*)$/m.exec(body);
  if (!profile) throw new Error("no **SPEAKER VOICE PROFILE:** line");
  const contextSentence = collapse(boldBlock(body, "INTERVIEW CONTEXT"));
  if (!contextSentence) throw new Error("empty INTERVIEW CONTEXT");

  const section = boldBlock(body, "QUESTIONS");
  const headers = [...section.matchAll(/^\*\*Q(\d+)\s*(?:\[[^\]]*\])?:\*\*\s*$/gm)];
  if (headers.length !== 4) throw new Error(`expected 4 questions, found ${headers.length}`);
  const stems = headers.map((h, i) => {
    const end = i + 1 < headers.length ? headers[i + 1].index : section.length;
    const chunk = section.slice(h.index + h[0].length, end);
    const stem = /^Stem:\s*(.*)$/m.exec(chunk);
    if (!stem || !collapse(stem[1])) throw new Error(`Q${h[1]} has no Stem:`);
    if (Number(h[1]) !== i + 1) throw new Error(`question headers out of order at Q${h[1]}`);
    return collapse(stem[1]);
  });

  return { voice: parseVoiceProfile(profile[1]), contextSentence, stems };
}

function readStatus(dir, itemId) {
  for (const name of ["STATUS.txt", `STATUS_${itemId}.txt`, `${itemId}_STATUS.txt`]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  return null;
}

const statusField = (text, re) => {
  const m = re.exec(text);
  return m ? m[1].trim() : null;
};

// Returns { items, excluded }. Each item: { itemId, voice, voiceConstant, clips }.
function buildIntPlan(corpusRoot, { only = null } = {}) {
  const base = path.join(corpusRoot, INT_FOLDER);
  const items = [];
  const excluded = [];
  const dirs = fs
    .readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^INT-\d+$/.test(e.name))
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

    const layer2 = statusField(status, /^LAYER 2[^:]*:\s*(.*)$/im);
    if (!layer2 || !/^PASS\b/i.test(layer2)) { skip(`LAYER 2 verdict: ${layer2 ?? "missing"}`); continue; }
    const crossModel = statusField(status, /^CROSS-MODEL CHECK:\s*(.*)$/im);
    if (crossModel && !/^PASS\b/i.test(crossModel)) { skip(`CROSS-MODEL CHECK: ${crossModel}`); continue; }

    let parsed;
    try {
      parsed = parseIntLayer1(fs.readFileSync(layer1Path, "utf8"));
      const statusProfile = statusField(status, /^SPEAKER VOICE PROFILE:\s*(.*)$/im);
      if (statusProfile) {
        const sv = parseVoiceProfile(statusProfile);
        if (sv.gender !== parsed.voice.gender || sv.accent !== parsed.voice.accent) {
          throw new Error(
            `voice mismatch: layer1 ${parsed.voice.gender}/${parsed.voice.accent}, STATUS ${sv.gender}/${sv.accent}`
          );
        }
      }
    } catch (err) {
      skip(err.message);
      continue;
    }

    const texts = [["intro", parsed.contextSentence], ...parsed.stems.map((s, i) => [`q${i + 1}`, s])];
    items.push({
      itemId,
      voice: parsed.voice,
      voiceConstant: voiceConstantFor(parsed.voice.accent, parsed.voice.gender),
      preset: PRESET,
      clips: texts.map(([clip, text]) => ({
        clip,
        file: path.join("int", itemId, `${itemId}_${clip}.mp3`),
        text,
        textSha256: sha256(text),
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

module.exports = { PRESET, parseVoiceProfile, parseIntLayer1, buildIntPlan, sha256 };
