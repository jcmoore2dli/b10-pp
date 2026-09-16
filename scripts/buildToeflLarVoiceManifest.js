#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────
// B10-PP · scripts/buildToeflLarVoiceManifest.js
// Assigns LAR speaker gender and NA voice (M F M F M by item number) and records it in a manifest.
// See scripts/toeflTts/larVoiceManifest.js for the rule.
//
// Reads the corpus only. No Firestore, no ElevenLabs calls.
//
// Usage:
//   node scripts/buildToeflLarVoiceManifest.js            dry run (default)
//   node scripts/buildToeflLarVoiceManifest.js --write    write the manifest
//   ... --corpus <dir>    corpus root (default ~/toefl/corpus)
//   ... --out <file>      manifest path (default audio/toefl/manifests/lar_voice_manifest.json)
// ─────────────────────────────────────────────────

const os = require("os");
const path = require("path");
const {
  listActiveLarItems,
  assignLarVoices,
  readManifest,
  writeManifest,
} = require("./toeflTts/larVoiceManifest");

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}

const corpusRoot = argValue("--corpus", path.join(os.homedir(), "toefl", "corpus"));
const outFile = path.resolve(
  argValue("--out", path.join(__dirname, "..", "audio", "toefl", "manifests", "lar_voice_manifest.json"))
);
const write = process.argv.includes("--write");
const today = new Date().toISOString().slice(0, 10);

const { active, excluded } = listActiveLarItems(corpusRoot);
const previous = readManifest(outFile);
const { manifest, added, warnings } = assignLarVoices(active, previous, today);

const count = (g) => manifest.items.filter((it) => it.gender === g).length;
console.log(`corpus:   ${corpusRoot}`);
console.log(`manifest: ${outFile} (${previous ? "existing" : "new"})`);
console.log(`active LAR items: ${active.length}  (F ${count("F")}, M ${count("M")})`);
console.log(`newly assigned:   ${added.length}${added.length ? ` — ${added.join(", ")}` : ""}`);
console.log(`voices: M ${manifest.items.find((i) => i.gender === "M")?.voiceConstant ?? "-"}, F ${manifest.items.find((i) => i.gender === "F")?.voiceConstant ?? "-"}`);
console.log(`order:  ${manifest.items.map((i) => i.gender).join("")}`);
for (const e of excluded) console.log(`excluded: ${e.itemId} (${e.reason})`);
for (const r of manifest.removedItems) console.log(`removed since assignment: ${r.itemId} (${r.gender}, ${r.removedOn})`);
for (const w of warnings) console.log(`WARNING: ${w}`);

if (write) {
  writeManifest(outFile, manifest);
  console.log("written.");
} else {
  console.log("dry run — pass --write to write the manifest.");
}
