#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────
// B10-PP · scripts/generateToeflStimulusAudio.js
// Audio generation for the single-clip listening types: one `stimulus` clip
// per item, the whole spoken text. Interview and LAR have their own scripts
// because they need several clips per item and type-specific delivery rules.
//
// Listening questions and options are on-screen text, never spoken (corpus
// verified against the 2026 Test Specification, 2026-09-17), so no type here
// has question clips.
//
// Each type supplies a plan module that decides the voice and preset per item:
//   at   — scripts/toeflTts/atAudioPlan.js    voice and register from the item's STATUS
//   lta  — scripts/toeflTts/ltaAudioPlan.js   voice from lta_voice_manifest.json (rotation default)
//   lcr  — scripts/toeflTts/lcrAudioPlan.js   voice from lcr_voice_manifest.json (gender confirmed, accent default)
//
// Dry run by default. With --generate, calls ElevenLabs using
// TOEFL_TTS_API_KEY only (never B10-PP's ELEVENLABS_API_KEY), sends the fixed
// seed TTS_SEED, and writes MP3s plus audio/toefl/manifests/<type>_audio_manifest.json.
// A clip whose rendering is unchanged is skipped; a changed one is reported and
// left alone unless --force is given.
//
// Usage:
//   node scripts/generateToeflStimulusAudio.js --type at              dry run
//   ... --type at --generate                                          write files
//   ... --items AT-001,AT-002 | --force | --corpus <dir> | --out <dir>
// ─────────────────────────────────────────────────

const fs = require("fs");
const os = require("os");
const path = require("path");
const { VOICES, PRESETS, API_KEY_ENV, B10_API_KEY_ENV, MODEL_ID, OUTPUT_FORMAT, TTS_SEED } = require("./toeflTts/config");
const { sha256 } = require("./toeflTts/atAudioPlan");

// Per type: the plan builder, and which (preset, voice) pairs a human has
// actually heard. Anything else is generated but flagged in the manifest as
// "default applied, not individually confirmed" — the standard used for the
// Interview pause defaults and LAR's voices.
const TYPES = {
  at: {
    schema: "toefl-at-audio-manifest/1",
    build: (corpusRoot, opts) => require("./toeflTts/atAudioPlan").buildAtPlan(corpusRoot, opts),
    confirmed: new Set(["toefl_at_lecture|TOEFL_TTS_VOICE_NA_F", "toefl_at_lecture|TOEFL_TTS_VOICE_UK_M"]),
    confirmedNote: "toefl_at_lecture heard on Cecilia (NA_F) and Alexander (UK_M) 2026-09-15; JC confirmed speed 0.97 by ear",
    defaultNote:
      "default applied, not individually confirmed: this preset/voice pair has not been heard. The 2026-09-15 AT " +
      "calibration covered toefl_at_lecture on NA_F and UK_M only; toefl_at_podcast and the other voices are " +
      "calibration values",
  },
  lta: {
    schema: "toefl-lta-audio-manifest/1",
    build: (corpusRoot, opts) => {
      const fs = require("fs");
      const file = path.join(outRoot, "manifests", "lta_voice_manifest.json");
      if (!fs.existsSync(file)) throw new Error(`no ${file} — run: node scripts/buildToeflVoiceManifest.js --type lta --write`);
      return require("./toeflTts/ltaAudioPlan").buildLtaPlan(corpusRoot, JSON.parse(fs.readFileSync(file, "utf8")), opts);
    },
    confirmed: new Set(),
    confirmedNote: null,
    defaultNote:
      "default applied, not individually confirmed: LTA had no voice fields and no preset. Gender and accent come " +
      "from the rotation in lta_voice_manifest.json and the preset toefl_lta_announcement is a documented starting " +
      "value (JC 2026-09-17); nothing here has been heard",
  },
  lcr: {
    schema: "toefl-lcr-audio-manifest/1",
    build: (corpusRoot, opts) => {
      const fs = require("fs");
      const file = path.join(outRoot, "manifests", "lcr_voice_manifest.json");
      if (!fs.existsSync(file)) throw new Error(`no ${file} — run: node scripts/buildToeflLcrVoiceManifest.js --write`);
      return require("./toeflTts/lcrAudioPlan").buildLcrPlan(corpusRoot, JSON.parse(fs.readFileSync(file, "utf8")), opts);
    },
    confirmed: new Set(),
    confirmedNote: null,
    defaultNote:
      "default applied, not individually confirmed: gender follows LCR's confirmed alternation, but the accent comes " +
      "from a rotation default (LCR's accent rule is undecided) and the preset toefl_lcr_prompt is a documented " +
      "starting value (JC 2026-09-17); nothing here has been heard",
  },
};

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}

const taskType = argValue("--type", null);
if (!taskType || !TYPES[taskType]) {
  console.error(`ERROR: --type is required, one of: ${Object.keys(TYPES).join(", ")}`);
  process.exit(1);
}
const cfg = TYPES[taskType];
const corpusRoot = argValue("--corpus", path.join(os.homedir(), "toefl", "corpus"));
const outRoot = path.resolve(argValue("--out", path.join(__dirname, "..", "audio", "toefl")));
const manifestFile = path.join(outRoot, "manifests", `${taskType}_audio_manifest.json`);
const only = argValue("--items", null)?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const generate = process.argv.includes("--generate");
const force = process.argv.includes("--force");

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

function resolveApiKey() {
  const dotenv = readEnvFile(path.join(__dirname, "..", ".env"));
  const key = process.env[API_KEY_ENV] || dotenv[API_KEY_ENV];
  if (!key) throw new Error(`No ${API_KEY_ENV} in the environment or .env. B10-PP's ${B10_API_KEY_ENV} is deliberately not used.`);
  if ([process.env[B10_API_KEY_ENV], dotenv[B10_API_KEY_ENV]].filter(Boolean).includes(key)) {
    throw new Error(`${API_KEY_ENV} holds the same value as B10-PP's ${B10_API_KEY_ENV}. Refusing to run.`);
  }
  return key;
}

function readManifest() {
  if (!fs.existsSync(manifestFile)) return { schema: cfg.schema, items: {} };
  const m = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (m.schema !== cfg.schema) throw new Error(`unexpected manifest schema: ${m.schema}`);
  return m;
}

function writeManifest(manifest) {
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  const tmp = `${manifestFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + "\n");
  fs.renameSync(tmp, manifestFile);
}

const renderSha256 = (voiceId, clip, settings) =>
  sha256(JSON.stringify({ voiceId, text: clip.textSent, settings, modelId: MODEL_ID, seed: TTS_SEED }));

async function synthesize(apiKey, voiceId, text, settings) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${encodeURIComponent(OUTPUT_FORMAT)}`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: settings, seed: TTS_SEED }),
    }
  );
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const { items, excluded } = cfg.build(corpusRoot, { only });
  const manifest = readManifest();
  const rows = items.map((item) => {
    const clip = item.clips[0];
    const settings = { ...PRESETS[item.preset] };
    const pair = `${item.preset}|${item.voiceConstant}`;
    const heard = cfg.confirmed.has(pair);
    return {
      item, clip, settings,
      confirmation: heard ? "confirmed" : "default",
      confirmationNote: heard ? cfg.confirmedNote : `${cfg.defaultNote} (${pair})`,
    };
  });

  const todo = [];
  const changed = [];
  let upToDate = 0;
  for (const row of rows) {
    const { item, clip, settings } = row;
    const voiceId = VOICES[item.voiceConstant].voiceId;
    const onDisk = fs.existsSync(path.join(outRoot, clip.file));
    const prev = manifest.items[item.itemId];
    if (onDisk && prev && prev.clips?.[clip.clip]?.renderSha256 === renderSha256(voiceId, clip, settings)) upToDate++;
    else if (onDisk && prev && !force) changed.push(row);
    else todo.push(row);
  }

  const chars = todo.reduce((n, r) => n + r.clip.textSent.length, 0);
  const count = (key, val) => rows.filter((r) => (key === "voice" ? r.item.voiceConstant : key === "preset" ? r.item.preset : r.confirmation) === val).length;
  console.log(`type:      ${taskType}`);
  console.log(`corpus:    ${corpusRoot}`);
  console.log(`audio out: ${outRoot}`);
  console.log(`manifest:  ${manifestFile}`);
  console.log(`seed:      ${TTS_SEED}   one stimulus clip per item, no pause tags, no question clips`);
  console.log(`items: ${rows.length}  clips: ${rows.length}  up to date: ${upToDate}  to generate: ${todo.length} (${chars} chars)`);
  console.log(`presets: ${[...new Set(rows.map((r) => r.item.preset))].map((p) => `${p} ${count("preset", p)}`).join(", ")}`);
  console.log(`voices:  ${[...new Set(rows.map((r) => r.item.voiceConstant))].sort().map((v) => `${v.slice(-4)} ${count("voice", v)}`).join(", ")}`);
  console.log(`confirmation: confirmed ${count("c", "confirmed")}, default ${count("c", "default")} (default applied, not individually confirmed)`);
  for (const e of excluded) console.log(`excluded: ${e.itemId} (${e.reason})`);
  for (const r of changed) console.log(`CHANGED, not regenerated (use --force): ${r.clip.file}`);

  if (!generate) {
    for (const r of rows) {
      console.log(`${r.item.itemId} ${r.item.voiceConstant.slice(-4)} ${r.item.preset.padEnd(18)} ${String(r.clip.words).padStart(3)}w ${r.confirmation.padEnd(9)} | ${r.clip.textSent.slice(0, 60)}…`);
    }
    const defs = rows.filter((r) => r.confirmation === "default");
    if (defs.length) {
      console.log("\nDEFAULT APPLIED, NOT INDIVIDUALLY CONFIRMED:");
      for (const pair of new Set(defs.map((r) => `${r.item.preset}|${r.item.voiceConstant}`))) {
        console.log(`  ${pair}  (${defs.filter((r) => `${r.item.preset}|${r.item.voiceConstant}` === pair).length} items)`);
      }
    }
    console.log("dry run — pass --generate to call ElevenLabs.");
    return;
  }

  const apiKey = resolveApiKey();
  const today = new Date().toISOString().slice(0, 10);
  let done = 0;
  for (const { item, clip, settings, confirmation, confirmationNote } of todo) {
    const voice = VOICES[item.voiceConstant];
    const audio = await synthesize(apiKey, voice.voiceId, clip.textSent, settings);
    const dest = path.join(outRoot, clip.file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, audio);
    const entry = (manifest.items[item.itemId] ??= { clips: {} });
    entry.voiceConstant = item.voiceConstant;
    entry.voiceId = voice.voiceId;
    entry.gender = item.gender;
    entry.accent = item.accent;
    entry.preset = item.preset;
    if (item.register) entry.register = item.register;
    entry.clips[clip.clip] = {
      file: clip.file,
      textSha256: clip.textSha256,
      renderSha256: renderSha256(voice.voiceId, clip, settings),
      textSent: clip.textSent,
      chars: clip.textSent.length,
      words: clip.words,
      bytes: audio.length,
      settings,
      modelId: MODEL_ID,
      seed: TTS_SEED,
      confirmation,
      confirmationNote,
      generatedOn: today,
    };
    writeManifest(manifest);
    console.log(`[${++done}/${todo.length}] ${clip.file} (${audio.length} bytes)`);
  }
  console.log("done.");
  if (done) console.log(`Next: python3 scripts/normalizeToeflAudio.py --type ${taskType}, then node scripts/uploadToeflAudio.js --type ${taskType} --upload`);
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
