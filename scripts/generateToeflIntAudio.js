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
// Short question stems get their own speed and, per voice and pause type, a
// break tag or none (config.js INT_TAG_POLICY, per-clip INT_CLIP_OVERRIDES;
// see intAudioPlan.resolveClipDelivery). Each call sends the clip's seed
// (TTS_SEED unless overridden). Every clip's manifest entry records its
// confirmation; "default" means "default applied, not individually
// confirmed" (JC 2026-09-16).
// Existing clips whose rendering is unchanged (text sent, settings, model,
// seed, voice) are skipped; a clip whose rendering has changed since it was
// generated is reported and left alone unless --force is given.
//
// Usage:
//   node scripts/generateToeflIntAudio.js                     dry run, all items
//   ... --items INT-001,INT-002                               limit to these items
//   ... --clips INT-046:q1,INT-047:q2                         limit to these clips
//   ... --generate                                            call ElevenLabs, write files
//   ... --force                                               regenerate changed-text clips
//   ... --corpus <dir>    corpus root (default ~/toefl/corpus)
//   ... --out <dir>       audio root (default audio/toefl)
//   ... --list all        dry run: list every clip, not just short questions
// ─────────────────────────────────────────────────

const fs = require("fs");
const os = require("os");
const path = require("path");
const { VOICES, PRESETS, API_KEY_ENV, B10_API_KEY_ENV, MODEL_ID, OUTPUT_FORMAT, TTS_SEED, INT_SHORT_QUESTION } =
  require("./toeflTts/config");
const { buildIntPlan, sha256 } = require("./toeflTts/intAudioPlan");

const MANIFEST_SCHEMA = "toefl-int-audio-manifest/1";

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}

const corpusRoot = argValue("--corpus", path.join(os.homedir(), "toefl", "corpus"));
const outRoot = path.resolve(argValue("--out", path.join(__dirname, "..", "audio", "toefl")));
const manifestFile = path.join(outRoot, "manifests", "int_audio_manifest.json");
const listArg = (flag) => argValue(flag, null)?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const clipFilter = listArg("--clips");
const only = listArg("--items") ?? (clipFilter ? [...new Set(clipFilter.map((c) => c.split(":")[0]))] : null);
const listAll = argValue("--list", null) === "all";
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

// Everything that decides how a clip sounds. A change to any of it means the
// clip on disk no longer matches what this run would generate.
const renderSha256 = (voiceId, clip) =>
  sha256(JSON.stringify({ voiceId, text: clip.textSent, settings: clip.settings, modelId: MODEL_ID, seed: clip.seed }));

async function synthesize(apiKey, voiceId, text, settings, seed) {
  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}` +
    `?output_format=${encodeURIComponent(OUTPUT_FORMAT)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: settings, seed }),
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
  const wanted = (item, clip) => !clipFilter || clipFilter.includes(`${item.itemId}:${clip.clip}`);

  // Classify every clip against what's already on disk and in the manifest.
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

  const chars = todo.reduce((n, t) => n + t.clip.textSent.length, 0);
  const selected = items.flatMap((item) => item.clips.filter((clip) => wanted(item, clip)).map((clip) => ({ item, clip })));
  const short = selected.filter((s) => s.clip.delivery === "short");
  const byPause = (p) => short.filter((s) => s.clip.pause === p).length;
  const byConfirmation = (c) => selected.filter((s) => s.clip.confirmation === c).length;
  const blocked = selected.filter((s) => s.clip.blocked);
  const defaults = selected.filter((s) => s.clip.confirmation === "default");
  console.log(`corpus:    ${corpusRoot}`);
  console.log(`audio out: ${outRoot}`);
  console.log(`manifest:  ${manifestFile}`);
  console.log(`preset:    toefl_int_interviewer ${JSON.stringify(PRESETS.toefl_int_interviewer)}`);
  console.log(`short questions (<= ${INT_SHORT_QUESTION.maxWords} words): speed ${INT_SHORT_QUESTION.speed}, break ${INT_SHORT_QUESTION.breakTime}`);
  console.log(`seed:      ${TTS_SEED} (per-clip overrides: ${selected.filter((s) => s.clip.seed !== TTS_SEED).length})`);
  console.log(`items: ${items.length}  clips: ${selected.length}  up to date: ${upToDate}  to generate: ${todo.length} (${chars} chars)`);
  console.log(
    `short: ${short.length} (before tag-on ${byPause("tagOn")}, dash ${byPause("dash")}, comma ${byPause("comma")}, speed only ${byPause(null)})  standard: ${selected.length - short.length}`
  );
  console.log(
    `confirmation: confirmed ${byConfirmation("confirmed")}, decided ${byConfirmation("decided")}, ` +
      `override ${byConfirmation("override")}, default ${defaults.length} (default applied, not individually confirmed)`
  );
  for (const e of excluded) console.log(`excluded: ${e.itemId} (${e.reason})`);
  for (const b of blocked) console.log(`BLOCKED: ${b.clip.file} (${b.clip.blocked})`);
  for (const c of changed) console.log(`CHANGED, not regenerated (use --force): ${c.clip.file} (${c.why})`);

  if (!generate) {
    const line = ({ item, clip }) => {
      const how = clip.delivery === "short" ? `short/${clip.pause ?? "none"}/${clip.breakTime ?? "no tag"}` : "standard";
      return `${item.itemId} ${clip.clip.padEnd(5)} ${item.voiceConstant.slice(-4)} ${String(clip.words).padStart(2)}w ${how.padEnd(22)} ${clip.confirmation.padEnd(9)} | ${clip.textSent}`;
    };
    for (const s of listAll ? selected : short) console.log(line(s));
    console.log("\nDEFAULT APPLIED, NOT INDIVIDUALLY CONFIRMED (short stems):");
    for (const s of defaults.filter((d) => d.clip.delivery === "short")) {
      console.log(`  ${s.item.itemId} ${s.clip.clip} ${s.item.voiceConstant.slice(-4)} — ${s.clip.confirmationNote}`);
    }
    console.log(`  + ${defaults.filter((d) => d.clip.clip === "intro").length} intros (preset, not listened to)`);
    console.log("dry run — pass --generate to call ElevenLabs.");
    return;
  }

  if (blocked.length) throw new Error(`${blocked.length} clip(s) blocked by an unresolved policy; see the list above`);
  const apiKey = resolveApiKey();
  const today = new Date().toISOString().slice(0, 10);
  let done = 0;
  for (const { item, clip } of todo) {
    const voice = VOICES[item.voiceConstant];
    const audio = await synthesize(apiKey, voice.voiceId, clip.textSent, clip.settings, clip.seed);
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
      renderSha256: renderSha256(voice.voiceId, clip),
      delivery: clip.delivery,
      pause: clip.pause,
      breakTime: clip.breakTime ?? null,
      policyStatus: clip.policy?.status ?? null,
      confirmation: clip.confirmation,
      confirmationNote: clip.confirmation === "default"
        ? `default applied, not individually confirmed: ${clip.confirmationNote}`
        : clip.confirmationNote,
      override: clip.override,
      textSent: clip.textSent,
      chars: clip.textSent.length,
      bytes: audio.length,
      settings: clip.settings,
      modelId: MODEL_ID,
      seed: clip.seed,
      generatedOn: today,
    };
    writeManifest(manifest); // after every clip, so an interrupted run keeps its record
    console.log(`[${++done}/${todo.length}] ${clip.file} (${audio.length} bytes)`);
  }
  console.log("done.");
  if (done) console.log("Next: python3 scripts/normalizeToeflAudio.py --type int, then node scripts/uploadToeflAudio.js --type int --upload");
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
