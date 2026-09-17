// scripts/toeflTts/ltcAudioPlan.js
// Listen to a Conversation (LTC) audio: one clip per item, the whole two-voice
// conversation, generated natively.
//
// APPROACH: ElevenLabs /v1/text-to-dialogue with eleven_v3 — one call per item,
// one turn per input, a voice per speaker. JC 2026-09-17 after an A/B on
// LTC-001: the native version had correct falling intonation on the closing
// turn and no splice artefact, where the per-turn build (multilingual_v2, then
// concatenated) had both faults. That outweighed the earlier
// consistency-with-other-types argument. Cost is identical: $0.10 per 1,000
// characters for both models.
//
// Consequences recorded on purpose, since this is the one type that departs
// from the rest of the corpus:
//   · model: eleven_v3, not eleven_multilingual_v2 as every other clip uses;
//     the dialogue endpoint supports no other model.
//   · voice settings: v3's stability scale is not multilingual_v2's, so the
//     preset's 0.45 is snapped to v3's middle value (0.5) and recorded as
//     such. Everything generated here is flagged "default applied, not
//     individually confirmed".
//
// Voices come from audio/toefl/manifests/ltc_voice_manifest.json: two per item,
// one man and one woman (LTC_Content_Spec v1.1 §2.2, confirmed 15/15 real
// conversations), same accent for both, assigned by rotation because the
// corpus carries no voice fields.
//
// Speaker labels come from the item's own [Man]: / [Woman]: turn markers.

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const LTC_FOLDER = "08_listen_conversation";
const PRESET = "toefl_ltc_conversation";
const MODEL_ID = "eleven_v3";
const V3_STABILITY = 0.5; // v3's middle setting; see the note above

const collapse = (s) => s.replace(/\s+/g, " ").trim();
const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

function readStatus(dir, itemId) {
  for (const name of ["STATUS.txt", `STATUS_${itemId}.txt`, `${itemId}_STATUS.txt`]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  return null;
}

// CONVERSATION TEXT, as [Speaker]: line turns — the same block
// importToeflCorpus.js reads, kept as turns rather than flattened.
function parseLtcTurns(body) {
  const m = /^CONVERSATION TEXT:\s*\n([\s\S]*?)(?=\n\s*\n[A-Z][A-Z0-9 \-/']*:|(?![\s\S]))/m.exec(body);
  if (!m) throw new Error("no CONVERSATION TEXT block");
  const turns = [...m[1].matchAll(/^\[([^\]]+)\]:\s*(.+)$/gm)].map((t) => ({
    speakerLabel: collapse(t[1]),
    text: collapse(t[2]),
  }));
  if (turns.length < 2) throw new Error(`expected at least 2 turns, found ${turns.length}`);
  const labels = [...new Set(turns.map((t) => t.speakerLabel))];
  if (labels.length !== 2) throw new Error(`expected exactly 2 speakers, found ${labels.length}: ${labels.join(", ")}`);
  return turns;
}

// Returns { items, excluded }. Each item's single clip carries `turns`, each
// turn already resolved to the voice that speaks it.
function buildLtcPlan(corpusRoot, voiceManifest, { only = null } = {}) {
  const base = path.join(corpusRoot, LTC_FOLDER);
  const assigned = new Map((voiceManifest?.items ?? []).map((i) => [i.itemId, i]));
  const items = [];
  const excluded = [];
  const dirs = fs
    .readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^LTC-\d+$/.test(e.name))
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

    let turns, entry, byLabel;
    try {
      turns = parseLtcTurns(fs.readFileSync(layer1, "utf8"));
      entry = assigned.get(itemId);
      if (!entry) throw new Error("not in ltc_voice_manifest.json");
      if (entry.voices.length !== 2) throw new Error(`voice manifest has ${entry.voices.length} voices, expected 2`);
      byLabel = new Map(entry.voices.map((v) => [v.speakerLabel.toLowerCase(), v]));
      for (const t of turns) {
        if (!byLabel.has(t.speakerLabel.toLowerCase())) {
          throw new Error(`speaker ${JSON.stringify(t.speakerLabel)} has no voice (manifest has ${[...byLabel.keys()].join(", ")})`);
        }
      }
    } catch (err) {
      skip(err.message);
      continue;
    }

    const resolved = turns.map((t, i) => {
      const v = byLabel.get(t.speakerLabel.toLowerCase());
      return { turnIndex: i + 1, speakerLabel: t.speakerLabel, text: t.text, voiceConstant: v.voiceConstant };
    });
    const text = resolved.map((t) => `[${t.speakerLabel}] ${t.text}`).join(" ");
    items.push({
      itemId,
      accent: entry.accent,
      voiceConstants: entry.voices.map((v) => v.voiceConstant),
      preset: PRESET,
      modelId: MODEL_ID,
      stability: V3_STABILITY,
      clips: [{
        clip: "stimulus",
        file: path.join("ltc", itemId, `${itemId}_stimulus.mp3`),
        turns: resolved,
        text,                               // for provenance and the dry run
        textSent: resolved.map((t) => t.text).join(" "),
        textSha256: sha256(text),
        chars: resolved.reduce((n, t) => n + t.text.length, 0),
        words: resolved.reduce((n, t) => n + t.text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length, 0),
      }],
    });
  }

  if (only) {
    for (const id of only) if (!dirs.includes(id)) excluded.push({ itemId: id, reason: "no such item folder" });
  }
  return { items, excluded };
}

module.exports = { PRESET, MODEL_ID, V3_STABILITY, parseLtcTurns, buildLtcPlan, sha256 };
