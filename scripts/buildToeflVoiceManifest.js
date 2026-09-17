#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────
// B10-PP · scripts/buildToeflVoiceManifest.js
// Assigns gender and accent by rotation for the types whose corpus carries no
// voice fields (LTA, LTC) and records them in a manifest. Both fields are
// DEFAULTS — see scripts/toeflTts/voiceRotationManifest.js.
//
// Reads the corpus only. No Firestore, no ElevenLabs calls.
//
// Usage:
//   node scripts/buildToeflVoiceManifest.js --type lta            dry run
//   node scripts/buildToeflVoiceManifest.js --type lta --write    write it
//   ... --corpus <dir>   corpus root (default ~/toefl/corpus)
//   ... --out <file>     manifest path (default audio/toefl/manifests/<type>_voice_manifest.json)
// ─────────────────────────────────────────────────

const os = require("os");
const path = require("path");
const { TYPES, listActiveItems, assignVoices, readManifest, writeManifest } = require("./toeflTts/voiceRotationManifest");

const argValue = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
};

const taskType = argValue("--type", null);
if (!taskType || !TYPES[taskType]) {
  console.error(`ERROR: --type is required, one of: ${Object.keys(TYPES).join(", ")}`);
  process.exit(1);
}
const corpusRoot = argValue("--corpus", path.join(os.homedir(), "toefl", "corpus"));
const outFile = path.resolve(argValue("--out", path.join(__dirname, "..", "audio", "toefl", "manifests", `${taskType}_voice_manifest.json`)));
const write = process.argv.includes("--write");
const today = new Date().toISOString().slice(0, 10);

const { active, excluded } = listActiveItems(corpusRoot, taskType);
const previous = readManifest(outFile, taskType);
const { manifest, added } = assignVoices(taskType, active, previous, today);

const counts = (key) => {
  const out = {};
  for (const it of manifest.items) for (const v of it.voices) out[v[key]] = (out[v[key]] || 0) + 1;
  return Object.entries(out).sort().map(([k, n]) => `${k} ${n}`).join(", ");
};
console.log(`type:     ${taskType}`);
console.log(`corpus:   ${corpusRoot}`);
console.log(`manifest: ${outFile} (${previous ? "existing" : "new"})`);
console.log(`active items: ${active.length}  voices per item: ${TYPES[taskType].speakers}`);
console.log(`genders: ${counts("gender")}`);
console.log(`accents: ${counts("accent")}`);
console.log(`newly assigned: ${added.length}${added.length ? ` — ${added.join(", ")}` : ""}`);
console.log("ALL ASSIGNMENTS ARE DEFAULTS, not confirmed: neither gender nor accent exists for this type in the corpus.");
for (const e of excluded) console.log(`excluded: ${e.itemId} (${e.reason})`);
for (const r of manifest.removedItems) console.log(`removed since assignment: ${r.itemId} (${r.removedOn})`);

if (write) {
  writeManifest(outFile, manifest);
  console.log("written.");
} else {
  console.log("dry run — pass --write to write the manifest.");
}
