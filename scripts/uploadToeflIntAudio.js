#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────
// B10-PP · scripts/uploadToeflIntAudio.js
// Uploads the normalised Interview clips (audio/toefl/int/, never int_raw/) to
// Firebase Storage under audio/toefl/int/... and records each upload in the
// manifest as `storage`. See scripts/toeflTts/storageUpload.js.
//
// Dry run by default. Credentials: Application Default Credentials
// (gcloud auth application-default login), like importToeflCorpus.js.
// Does not touch Firestore; linking items to these paths waits on the
// data-model decision for Interview question audio.
//
// Usage:
//   node scripts/uploadToeflIntAudio.js                 dry run: plan only
//   node scripts/uploadToeflIntAudio.js --upload        upload new clips
//   ... --force        also replace clips whose remote copy differs
//   ... --verify       re-check every remote copy against the local file
// ─────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const { eligibleClips, planUploads, uploadClip, verifyRemote } = require("./toeflTts/storageUpload");

const BUCKET = process.env.TOEFL_STORAGE_BUCKET || "b10-practice-platform.firebasestorage.app";
const PROJECT = process.env.GCLOUD_PROJECT || "b10-practice-platform";
const audioRoot = path.join(__dirname, "..", "audio", "toefl");
const manifestFile = path.join(audioRoot, "manifests", "int_audio_manifest.json");
const upload = process.argv.includes("--upload");
const force = process.argv.includes("--force");
const verifyAll = process.argv.includes("--verify");

function writeManifest(m) {
  const tmp = `${manifestFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(m, null, 2) + "\n");
  fs.renameSync(tmp, manifestFile);
}

async function main() {
  admin.initializeApp({ projectId: PROJECT, storageBucket: BUCKET });
  const bucket = admin.storage().bucket();
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));

  const { clips, problems } = eligibleClips(manifest, audioRoot);
  if (problems.length) {
    for (const p of problems) console.log(`NOT ELIGIBLE: ${p}`);
    throw new Error(`${problems.length} clip(s) not eligible; run normalizeToeflIntAudio.py first`);
  }
  const plan = await planUploads(bucket, clips);
  const count = (a) => plan.filter((p) => p.action === a).length;
  const mb = (plan.filter((p) => p.action === "upload").reduce((n, p) => n + p.size, 0) / 1e6).toFixed(1);
  console.log(`bucket: gs://${BUCKET}  prefix: audio/toefl/`);
  console.log(`clips: ${plan.length}  to upload: ${count("upload")} (${mb} MB)  already uploaded: ${count("skip")}  conflicts: ${count("conflict")}`);
  for (const p of plan.filter((x) => x.action === "conflict")) {
    console.log(`CONFLICT${force ? " (will replace)" : " (use --force)"}: ${p.storagePath} remote sha256 ${p.remote.metadata?.sha256 ?? "none"}`);
  }

  let changed = 0;
  for (const p of plan.filter((x) => x.action === "skip")) {
    const entry = manifest.items[p.itemId].clips[p.clip];
    if (!entry.storage || verifyAll) {
      entry.storage = await verifyRemote(bucket, p, entry.storage ? new Date(entry.storage.uploadedOn) : new Date());
      changed++;
    }
  }
  if (!upload) {
    for (const p of plan.filter((x) => x.action === "upload").slice(0, 5)) console.log(`  would upload ${p.file} -> ${p.storagePath}`);
    if (changed) writeManifest(manifest);
    console.log("dry run — pass --upload to write to Storage.");
    return;
  }

  const todo = plan.filter((p) => p.action === "upload" || (force && p.action === "conflict"));
  let done = 0;
  const queue = [...todo];
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      manifest.items[p.itemId].clips[p.clip].storage = await uploadClip(bucket, p);
      writeManifest(manifest);
      console.log(`[${++done}/${todo.length}] ${p.storagePath}`);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (changed && !todo.length) writeManifest(manifest);
  console.log("done.");
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
