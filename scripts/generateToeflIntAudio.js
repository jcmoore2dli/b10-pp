#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────
// B10-PP · scripts/generateToeflIntAudio.js
// Interview (INT) audio generation: per item, one introduction clip (the
// INTERVIEW CONTEXT framing) and four question clips, all in the item's one
// interviewer voice. See scripts/toeflTts/intAudioPlan.js for the rules.
//
// Dry run by default: prints the plan and character totals, calls nothing.
// With --generate, calls ElevenLabs using TOEFL_TTS_API_KEY only (never
// B10-PP's ELEVENLABS_API_KEY) and writes MP3s plus a manifest.
// Existing clips whose text is unchanged are skipped; a clip whose corpus
// text has changed since it was generated is reported and left alone unless
// --force is given.
//
// Usage:
//   node scripts/generateToeflIntAudio.js                     dry run, all items
//   ... --items INT-001,INT-002                               limit to these items
//   ... --generate                                            call ElevenLabs, write files
//   ... --force                                               regenerate changed-text clips
//   ... --corpus <dir>    corpus root (default ~/toefl/corpus)
//   ... --out <dir>       audio root (default audio/toefl)
// ─────────────────────────────────────────────────

const fs = require("fs");
const os = require("os");
const path = require("path");
const { VOICES, PRESETS, API_KEY_ENV, B10_API_KEY_ENV, MODEL_ID, OUTPUT_FORMAT } = require("./toeflTts/config");
const { buildIntPlan } = require("./toeflTts/intAudioPlan");

const MANIFEST_SCHEMA = "toefl-int-audio-manifest/1";

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}

const corpusRoot = argValue("--corpus", path.join(os.homedir(), "toefl", "corpus"));
const outRoot = path.resolve(argValue("--out", path.join(__dirname, "..", "audio", "toefl")));
const manifestFile = path.join(outRoot, "manifests", "int_audio_manifest.json");
const only = argValue("--items", null)?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const generate = process.argv.includes("--generate");
const force = process.argv.includes("--force");

// Environment first, then the platform .env. Values are never printed.
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
  if (!key) {
    throw new Error(`No ${API_KEY_ENV} in the environment or .env. B10-PP's ${B10_API_KEY_ENV} is deliberately not used.`);
  }
  const b10 = [process.env[B10_API_KEY_ENV], dotenv[B10_API_KEY_ENV]].filter(Boolean);
  if (b10.includes(key)) {
    throw new Error(`${API_KEY_ENV} holds the same value as B10-PP's ${B10_API_KEY_ENV}. Refusing to run.`);
  }
  return key;
}

function readManifest() {
  if (!fs.existsSync(manifestFile)) return { schema: MANIFEST_SCHEMA, items: {} };
  const m = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (m.schema !== MANIFEST_SCHEMA) throw new Error(`unexpected manifest schema: ${m.schema}`);
  return m;
}

function writeManifest(manifest) {
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  const tmp = `${manifestFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + "\n");
  fs.renameSync(tmp, manifestFile);
}

async function synthesize(apiKey, voiceId, text, settings) {
  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}` +
    `?output_format=${encodeURIComponent(OUTPUT_FORMAT)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: settings }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`ElevenLabs ${res.status}: ${detail}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const { items, excluded } = buildIntPlan(corpusRoot, { only });
  const manifest = readManifest();
  const settings = PRESETS[items[0]?.preset ?? "toefl_int_interviewer"];

  // Classify every clip against what's already on disk and in the manifest.
  const todo = [];
  const changed = [];
  let upToDate = 0;
  for (const item of items) {
    const prev = manifest.items[item.itemId];
    for (const clip of item.clips) {
      const onDisk = fs.existsSync(path.join(outRoot, clip.file));
      const prevClip = prev?.clips?.[clip.clip];
      const sameVoice = prev?.voiceConstant === item.voiceConstant;
      if (onDisk && prevClip && prevClip.textSha256 === clip.textSha256 && sameVoice) {
        upToDate++;
      } else if (onDisk && prevClip && !force) {
        changed.push({ item, clip, why: sameVoice ? "text changed" : "voice changed" });
      } else {
        todo.push({ item, clip });
      }
    }
  }

  const chars = todo.reduce((n, t) => n + t.clip.text.length, 0);
  console.log(`corpus:    ${corpusRoot}`);
  console.log(`audio out: ${outRoot}`);
  console.log(`manifest:  ${manifestFile}`);
  console.log(`preset:    toefl_int_interviewer ${JSON.stringify(settings)}`);
  console.log(`items: ${items.length}  clips: ${items.length * 5}  up to date: ${upToDate}  to generate: ${todo.length} (${chars} chars)`);
  for (const e of excluded) console.log(`excluded: ${e.itemId} (${e.reason})`);
  for (const c of changed) console.log(`CHANGED, not regenerated (use --force): ${c.clip.file} (${c.why})`);

  if (!generate) {
    for (const item of items) {
      const v = VOICES[item.voiceConstant];
      console.log(`${item.itemId}  ${item.voiceConstant} (${v.name})  intro: ${item.clips[0].text}`);
    }
    console.log("dry run — pass --generate to call ElevenLabs.");
    return;
  }

  const apiKey = resolveApiKey();
  const today = new Date().toISOString().slice(0, 10);
  let done = 0;
  for (const { item, clip } of todo) {
    const voice = VOICES[item.voiceConstant];
    const audio = await synthesize(apiKey, voice.voiceId, clip.text, settings);
    const dest = path.join(outRoot, clip.file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, audio);

    const entry = (manifest.items[item.itemId] ??= { clips: {} });
    entry.voiceConstant = item.voiceConstant;
    entry.voiceId = voice.voiceId;
    entry.preset = item.preset;
    entry.clips[clip.clip] = {
      file: clip.file,
      textSha256: clip.textSha256,
      chars: clip.text.length,
      bytes: audio.length,
      settings,
      modelId: MODEL_ID,
      generatedOn: today,
    };
    writeManifest(manifest); // after every clip, so an interrupted run keeps its record
    console.log(`[${++done}/${todo.length}] ${clip.file} (${audio.length} bytes)`);
  }
  console.log("done.");
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
