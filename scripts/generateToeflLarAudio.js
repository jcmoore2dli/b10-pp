#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────
// B10-PP · scripts/generateToeflLarAudio.js
// Listen and Repeat (LAR) audio generation: per item, eight clips — the
// INTRODUCTION plus the seven utterances — all in the item's one North
// American voice (M F M F M by item number, per
// audio/toefl/manifests/lar_voice_manifest.json). See
// scripts/toeflTts/larAudioPlan.js for the rules.
//
// Dry run by default: prints the plan and character totals, calls nothing.
// With --generate, calls ElevenLabs using TOEFL_TTS_API_KEY only (never
// B10-PP's ELEVENLABS_API_KEY) and writes MP3s plus a manifest. Each call
// sends the fixed seed TTS_SEED. No pause tags: the Interview short-question
// rule is Interview-specific.
// Existing clips whose rendering is unchanged (text sent, settings, model,
// seed, voice) are skipped; a clip whose rendering has changed since it was
// generated is reported and left alone unless --force is given.
//
// Every clip's manifest entry records its confirmation. The
// toefl_lar_trainer preset was heard on Cecilia (NA_F) on 2026-09-15 and
// judged fine; Justin Time (NA_M) has never been heard on it, so his clips
// are flagged "default applied, not individually confirmed" — the same
// transparency standard as the Interview pause defaults.
//
// Usage:
//   node scripts/generateToeflLarAudio.js                      dry run, all items
//   ... --items LAR-001,LAR-002                                limit to these items
//   ... --clips LAR-001:intro,LAR-001:u3                       limit to these clips
//   ... --generate                                             call ElevenLabs, write files
//   ... --force                                                regenerate changed clips
//   ... --corpus <dir>    corpus root (default ~/toefl/corpus)
//   ... --out <dir>       audio root (default audio/toefl)
//   ... --list all        dry run: list every clip, not just the intros
// ─────────────────────────────────────────────────

const fs = require("fs");
const os = require("os");
const path = require("path");
const { VOICES, PRESETS, API_KEY_ENV, B10_API_KEY_ENV, MODEL_ID, OUTPUT_FORMAT, TTS_SEED } =
  require("./toeflTts/config");
const { buildLarPlan, PRESET, UTTERANCE_COUNT, sha256 } = require("./toeflTts/larAudioPlan");

const MANIFEST_SCHEMA = "toefl-lar-audio-manifest/1";

// Both LAR voices have now been heard on this preset: Cecilia on 2026-09-15,
// and both voices on 2026-09-17's speed ladder, where JC set speed 0.90.
// Recorded per clip so a later reader knows what was actually judged.
const CONFIRMATION = {
  TOEFL_TTS_VOICE_NA_F: {
    confirmation: "confirmed",
    note:
      "toefl_lar_trainer heard on Cecilia (NA_F): 2026-09-15 judged fine, and 2026-09-17 speed " +
      "ladder on LAR-001 u7 where JC confirmed speed 0.90 for both voices",
  },
  TOEFL_TTS_VOICE_NA_M: {
    confirmation: "confirmed",
    note:
      "toefl_lar_trainer heard on Justin Time (NA_M): 2026-09-17 spot check (intro, u1, u7) plus a " +
      "speed ladder on LAR-001 u7; JC confirmed speed 0.90 by direct listening",
  },
};

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}

const corpusRoot = argValue("--corpus", path.join(os.homedir(), "toefl", "corpus"));
const outRoot = path.resolve(argValue("--out", path.join(__dirname, "..", "audio", "toefl")));
const manifestFile = path.join(outRoot, "manifests", "lar_audio_manifest.json");
const voiceManifestFile = path.join(outRoot, "manifests", "lar_voice_manifest.json");
const listArg = (flag) => argValue(flag, null)?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const clipFilter = listArg("--clips");
const only = listArg("--items") ?? (clipFilter ? [...new Set(clipFilter.map((c) => c.split(":")[0]))] : null);
const generate = process.argv.includes("--generate");
const force = process.argv.includes("--force");
const listAll = argValue("--list", null) === "all";

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

// Everything that decides how a clip sounds. A change to any of it means the
// clip on disk no longer matches what this run would generate.
const renderSha256 = (voiceId, clip) =>
  sha256(JSON.stringify({ voiceId, text: clip.textSent, settings: clip.settings, modelId: MODEL_ID, seed: TTS_SEED }));

async function synthesize(apiKey, voiceId, text, settings) {
  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}` +
    `?output_format=${encodeURIComponent(OUTPUT_FORMAT)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: settings, seed: TTS_SEED }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`ElevenLabs ${res.status}: ${detail}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const voiceManifest = JSON.parse(fs.readFileSync(voiceManifestFile, "utf8"));
  const { items, excluded } = buildLarPlan(corpusRoot, voiceManifest, { only });
  const manifest = readManifest();
  const wanted = (item, clip) => !clipFilter || clipFilter.includes(`${item.itemId}:${clip.clip}`);

  const todo = [];
  const changed = [];
  let upToDate = 0;
  for (const item of items) {
    const prev = manifest.items[item.itemId];
    const voiceId = VOICES[item.voiceConstant].voiceId;
    for (const clip of item.clips) {
      if (!wanted(item, clip)) continue;
      const onDisk = fs.existsSync(path.join(outRoot, clip.file));
      const prevClip = prev?.clips?.[clip.clip];
      if (onDisk && prevClip && prevClip.renderSha256 === renderSha256(voiceId, clip)) {
        upToDate++;
      } else if (onDisk && prevClip && !force) {
        const why =
          prev.voiceConstant !== item.voiceConstant ? "voice changed"
          : prevClip.textSha256 !== clip.textSha256 ? "text changed"
          : "delivery changed";
        changed.push({ item, clip, why });
      } else {
        todo.push({ item, clip });
      }
    }
  }

  const selected = items.flatMap((item) => item.clips.filter((c) => wanted(item, c)).map((clip) => ({ item, clip })));
  const chars = todo.reduce((n, t) => n + t.clip.textSent.length, 0);
  const byVoice = (v) => selected.filter((s) => s.item.voiceConstant === v).length;
  const defaults = selected.filter((s) => CONFIRMATION[s.item.voiceConstant].confirmation === "default");
  console.log(`corpus:    ${corpusRoot}`);
  console.log(`audio out: ${outRoot}`);
  console.log(`manifest:  ${manifestFile}`);
  console.log(`preset:    ${PRESET} ${JSON.stringify(PRESETS[PRESET])}`);
  console.log(`seed:      ${TTS_SEED}   pause tags: none (LAR utterances are sent as written)`);
  console.log(`items: ${items.length}  clips: ${selected.length} (intro + ${UTTERANCE_COUNT} utterances each)  up to date: ${upToDate}  to generate: ${todo.length} (${chars} chars)`);
  console.log(
    `voices: NA_F Cecilia ${byVoice("TOEFL_TTS_VOICE_NA_F")} clips (${items.filter((i) => i.gender === "F").length} items), ` +
      `NA_M Justin ${byVoice("TOEFL_TTS_VOICE_NA_M")} clips (${items.filter((i) => i.gender === "M").length} items)`
  );
  console.log(`confirmation: confirmed ${selected.length - defaults.length}, default ${defaults.length} (default applied, not individually confirmed)`);
  for (const e of excluded) console.log(`excluded: ${e.itemId} (${e.reason})`);
  for (const c of changed) console.log(`CHANGED, not regenerated (use --force): ${c.clip.file} (${c.why})`);

  if (!generate) {
    for (const { item, clip } of listAll ? selected : selected.filter((s) => s.clip.clip === "intro")) {
      const v = VOICES[item.voiceConstant];
      console.log(
        `${item.itemId} ${clip.clip.padEnd(5)} ${item.voiceConstant.slice(-4)} (${v.name.split(" ")[0]}) ` +
          `${String(clip.words).padStart(2)}w ${(clip.part ?? "intro").padEnd(10)} | ${clip.textSent}`
      );
    }
    const unheard = [...new Set(defaults.map((d) => d.item.voiceConstant))];
    if (unheard.length) {
      console.log("\nDEFAULT APPLIED, NOT INDIVIDUALLY CONFIRMED:");
      for (const v of unheard) console.log(`  ${v} — ${CONFIRMATION[v].note} (${byVoice(v)} clips)`);
    }
    console.log("dry run — pass --generate to call ElevenLabs.");
    return;
  }

  const apiKey = resolveApiKey();
  const today = new Date().toISOString().slice(0, 10);
  let done = 0;
  for (const { item, clip } of todo) {
    const voice = VOICES[item.voiceConstant];
    const audio = await synthesize(apiKey, voice.voiceId, clip.textSent, clip.settings);
    const dest = path.join(outRoot, clip.file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, audio);

    const entry = (manifest.items[item.itemId] ??= { clips: {} });
    entry.voiceConstant = item.voiceConstant;
    entry.voiceId = voice.voiceId;
    entry.gender = item.gender;
    entry.preset = item.preset;
    entry.clips[clip.clip] = {
      file: clip.file,
      textSha256: clip.textSha256,
      renderSha256: renderSha256(voice.voiceId, clip),
      part: clip.part,
      textSent: clip.textSent,
      chars: clip.textSent.length,
      words: clip.words,
      bytes: audio.length,
      settings: clip.settings,
      modelId: MODEL_ID,
      seed: TTS_SEED,
      confirmation: CONFIRMATION[item.voiceConstant].confirmation,
      confirmationNote: CONFIRMATION[item.voiceConstant].note,
      generatedOn: today,
    };
    writeManifest(manifest);
    console.log(`[${++done}/${todo.length}] ${clip.file} (${audio.length} bytes)`);
  }
  console.log("done.");
  if (done) console.log("Next: python3 scripts/normalizeToeflAudio.py --type lar, then node scripts/uploadToeflAudio.js --type lar --upload");
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
