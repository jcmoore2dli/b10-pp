// scripts/toeflTts/storageUpload.js
// Firebase Storage upload of normalised TOEFL Interview clips (JC 2026-09-17).
//
// Local audio/toefl/<file>  ->  gs://<bucket>/audio/toefl/<file>
// e.g. int/INT-001/INT-001_q1.mp3 -> audio/toefl/int/INT-001/INT-001_q1.mp3
// Under audio/ because storage.rules already allow signed-in reads there (no
// rules deploy). cleanupAudio only deletes paths referenced by `submissions`
// docs, and the bucket has no lifecycle rules, so stimulus files persist.
//
// Only clips with a successful `loudness` record whose local file matches its
// normalizedSha256 are eligible; int_raw/ is never read. `bucket` is any object
// with file(path).getMetadata() and upload(localPath, options), so tests can
// pass a fake.

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const STORAGE_PREFIX = "audio/toefl/";

const digest = (file, algo, enc) => crypto.createHash(algo).update(fs.readFileSync(file)).digest(enc);

function storagePathFor(clipFile) {
  if (/^[a-z]+_raw\//.test(clipFile) || path.isAbsolute(clipFile) || clipFile.includes("..")) {
    throw new Error(`refusing to map ${clipFile} to Storage`);
  }
  return STORAGE_PREFIX + clipFile.split(path.sep).join("/");
}

// Every clip must be normalised and unchanged since normalisation.
function eligibleClips(manifest, audioRoot) {
  const clips = [];
  const problems = [];
  for (const [itemId, item] of Object.entries(manifest.items).sort()) {
    for (const [clip, c] of Object.entries(item.clips).sort()) {
      const local = path.join(audioRoot, c.file);
      const lo = c.loudness;
      if (!lo || !lo.ok) { problems.push(`${c.file}: no successful loudness record`); continue; }
      if (!fs.existsSync(local)) { problems.push(`${c.file}: missing locally`); continue; }
      const sha256 = digest(local, "sha256", "hex");
      if (sha256 !== lo.normalizedSha256) { problems.push(`${c.file}: local file differs from its normalised record`); continue; }
      clips.push({
        itemId, clip, file: c.file, local, sha256,
        md5Hash: digest(local, "md5", "base64"), size: fs.statSync(local).size,
        storagePath: storagePathFor(c.file),
        voiceConstant: item.voiceConstant, lufs: lo.lufsOut, confirmation: c.confirmation,
      });
    }
  }
  return { clips, problems };
}

async function remoteMetadata(bucket, storagePath) {
  try {
    const [meta] = await bucket.file(storagePath).getMetadata();
    return meta;
  } catch (err) {
    if (err.code === 404) return null;
    throw err;
  }
}

// Returns [{...clip, action: "upload" | "skip" | "conflict", remote}]
async function planUploads(bucket, clips) {
  const out = [];
  for (const c of clips) {
    const remote = await remoteMetadata(bucket, c.storagePath);
    const action = !remote ? "upload" : remote.metadata?.sha256 === c.sha256 ? "skip" : "conflict";
    out.push({ ...c, action, remote });
  }
  return out;
}

async function uploadClip(bucket, c, { now = new Date() } = {}) {
  await bucket.upload(c.local, {
    destination: c.storagePath,
    resumable: false,
    metadata: {
      contentType: "audio/mpeg",
      metadata: {
        firebaseStorageDownloadTokens: crypto.randomUUID(),
        sha256: c.sha256,
        itemId: c.itemId,
        clip: c.clip,
        voiceConstant: c.voiceConstant,
        lufs: String(c.lufs),
        confirmation: c.confirmation,
        source: "generateToeflIntAudio.js + normalizeToeflIntAudio.py",
      },
    },
  });
  return verifyRemote(bucket, c, now);
}

// Size and MD5 must match the local file; returns the manifest `storage` record.
async function verifyRemote(bucket, c, now = new Date()) {
  const meta = await remoteMetadata(bucket, c.storagePath);
  if (!meta) throw new Error(`${c.storagePath}: not found after upload`);
  if (Number(meta.size) !== c.size) throw new Error(`${c.storagePath}: size ${meta.size} != local ${c.size}`);
  if (meta.md5Hash !== c.md5Hash) throw new Error(`${c.storagePath}: md5 ${meta.md5Hash} != local ${c.md5Hash}`);
  if (meta.metadata?.sha256 !== c.sha256) throw new Error(`${c.storagePath}: sha256 metadata mismatch`);
  if (!meta.metadata?.firebaseStorageDownloadTokens) throw new Error(`${c.storagePath}: no download token`);
  return {
    bucket: meta.bucket, path: c.storagePath, generation: String(meta.generation),
    md5Hash: meta.md5Hash, size: c.size, sha256: c.sha256, uploadedOn: now.toISOString().slice(0, 10),
  };
}

module.exports = { STORAGE_PREFIX, storagePathFor, eligibleClips, planUploads, uploadClip, verifyRemote };
