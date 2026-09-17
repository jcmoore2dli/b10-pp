// test/tts/storageUpload.test.js
// Interview audio upload planning and verification against a fake bucket.

"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { storagePathFor, eligibleClips, planUploads, uploadClip } = require("../../scripts/toeflTts/storageUpload");

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

function fakeBucket({ corrupt = false } = {}) {
  const objects = new Map();
  const notFound = () => Object.assign(new Error("No such object"), { code: 404 });
  return {
    objects,
    file: (p) => ({
      getMetadata: async () => {
        if (!objects.has(p)) throw notFound();
        return [objects.get(p)];
      },
    }),
    upload: async (local, { destination, metadata }) => {
      let body = fs.readFileSync(local);
      if (corrupt) body = Buffer.concat([body, Buffer.from("x")]);
      objects.set(destination, {
        bucket: "fake-bucket", name: destination, size: String(body.length), generation: "17",
        md5Hash: crypto.createHash("md5").update(body).digest("base64"),
        contentType: metadata.contentType, metadata: metadata.metadata,
      });
    },
  };
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "int-upload-"));
  const clips = {};
  for (const clip of ["intro", "q1"]) {
    const file = `int/INT-001/INT-001_${clip}.mp3`;
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    const body = Buffer.from(`audio ${clip}`);
    fs.writeFileSync(path.join(root, file), body);
    clips[clip] = { file, confirmation: "confirmed", loudness: { ok: true, lufsOut: -20.01, normalizedSha256: sha(body) } };
  }
  return { root, manifest: { items: { "INT-001": { voiceConstant: "TOEFL_TTS_VOICE_UK_F", clips } } } };
}

describe("Interview audio upload", () => {
  it("maps local files under audio/toefl/ and refuses raw or escaping paths", () => {
    assert.strictEqual(storagePathFor("int/INT-001/INT-001_q1.mp3"), "audio/toefl/int/INT-001/INT-001_q1.mp3");
    for (const bad of ["int_raw/INT-001/x.mp3", "../x.mp3", "/abs/x.mp3"]) assert.throws(() => storagePathFor(bad));
  });

  it("only accepts clips normalised and unchanged since", () => {
    const { root, manifest } = setup();
    assert.strictEqual(eligibleClips(manifest, root).problems.length, 0);
    fs.appendFileSync(path.join(root, "int/INT-001/INT-001_q1.mp3"), "edited");
    delete manifest.items["INT-001"].clips.intro.loudness;
    const { clips, problems } = eligibleClips(manifest, root);
    assert.strictEqual(clips.length, 0);
    assert.strictEqual(problems.length, 2);
  });

  it("uploads new clips with type, token and metadata, verifies them, then skips them", async () => {
    const { root, manifest } = setup();
    const bucket = fakeBucket();
    const { clips } = eligibleClips(manifest, root);
    const plan = await planUploads(bucket, clips);
    assert.deepStrictEqual(plan.map((p) => p.action), ["upload", "upload"]);
    const rec = await uploadClip(bucket, plan[0], { now: new Date("2026-09-17T12:00:00Z") });
    assert.deepStrictEqual(Object.keys(rec).sort(), ["bucket", "generation", "md5Hash", "path", "sha256", "size", "uploadedOn"]);
    assert.strictEqual(rec.uploadedOn, "2026-09-17");
    const obj = bucket.objects.get(plan[0].storagePath);
    assert.strictEqual(obj.contentType, "audio/mpeg");
    assert.match(obj.metadata.firebaseStorageDownloadTokens, /^[0-9a-f-]{36}$/);
    assert.strictEqual(obj.metadata.sha256, plan[0].sha256);
    assert.strictEqual(obj.metadata.voiceConstant, "TOEFL_TTS_VOICE_UK_F");
    const again = await planUploads(bucket, clips);
    assert.deepStrictEqual(again.map((p) => p.action), ["skip", "upload"]);
  });

  it("reports a different remote file as a conflict", async () => {
    const { root, manifest } = setup();
    const bucket = fakeBucket();
    const { clips } = eligibleClips(manifest, root);
    await uploadClip(bucket, clips[0]);
    bucket.objects.get(clips[0].storagePath).metadata.sha256 = "something-else";
    assert.strictEqual((await planUploads(bucket, clips))[0].action, "conflict");
  });

  it("fails when the uploaded object doesn't match the local file", async () => {
    const { root, manifest } = setup();
    const { clips } = eligibleClips(manifest, root);
    await assert.rejects(uploadClip(fakeBucket({ corrupt: true }), clips[0]), /size/);
  });
});
