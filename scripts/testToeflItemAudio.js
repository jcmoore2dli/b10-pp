#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// B10-PP · scripts/testToeflItemAudio.js
// Tests scripts/toeflImport/itemAudio.js (the importer's `audio` builder, data
// model v1.18 Appendix B) against the REAL audio manifests, with item fields
// parsed from the REAL corpus the same way the importer reads them. Then
// every failure path on doctored copies, and the Storage check with a fake
// getMetadata. No network. Run: node scripts/testToeflItemAudio.js
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");
const os = require("os");
const { buildItemAudio, verifyClips, stripForWrite } = require("./toeflImport/itemAudio");

let passes = 0, failures = 0;
const ok = (c, m) => { if (c) passes++; else { failures++; console.log("  FAIL:", m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)}`);
const clone = (x) => JSON.parse(JSON.stringify(x));

const MAN = path.join(__dirname, "..", "audio", "toefl", "manifests");
const M = Object.fromEntries(["at", "lta", "lcr", "ltc", "int", "lar"].map((t) => [t, JSON.parse(fs.readFileSync(path.join(MAN, `${t}_audio_manifest.json`), "utf8")).items]));
const CORPUS = path.join(os.homedir(), "toefl", "corpus");

// Item fields the builder reads, taken from the real corpus files.
function ltcSpeakers(id) {
  const body = fs.readFileSync(path.join(CORPUS, "08_listen_conversation", id, `${id}_layer1_generation.md`), "utf8");
  const s = [...new Set([...body.matchAll(/^\[([^\]]+)\]:/gm)].map((m) => m[1]))];
  return { stimulus: { speakerA: s[0], speakerB: s[1] } };
}
function larItem(id) {
  const body = fs.readFileSync(path.join(CORPUS, "12_listen_repeat", id, `${id}_layer1_generation.md`), "utf8");
  return {
    item: { stimulus: {}, utterances: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ utteranceIndex: n })) },
    speakerGender: /^INTRODUCTION SPEAKER GENDER:\s*([MF])/m.exec(body)[1],
  };
}
const KEYS = ["role", "index", "storagePath", "durationSeconds", "sha256", "voices"];

console.log("1. every real manifest item builds, in the exact Appendix B shape");
const counts = {};
for (const [type, key] of [["AT", "at"], ["LTA", "lta"], ["LCR", "lcr"], ["LTC", "ltc"], ["INT", "int"], ["LAR", "lar"]]) {
  let built = 0; const bad = [];
  for (const id of Object.keys(M[key]).sort()) {
    let item = {}, expect = {};
    if (type === "LTC") item = ltcSpeakers(id);
    if (type === "LAR") { const l = larItem(id); item = l.item; expect = { speakerGender: l.speakerGender }; }
    const { audio, problems } = buildItemAudio(type, M[key][id], item, expect);
    if (audio) built++; else bad.push(`${id}: ${problems.join("; ")}`);
  }
  counts[type] = `${built}/${Object.keys(M[key]).length}`;
  ok(bad.length === 0, `${type}: all manifest items build (${bad.slice(0, 2).join(" | ")})`);
}
console.log("   built:", JSON.stringify(counts));

console.log("2. per-type clip order, roles, index bases, derived values");
const at = stripForWrite(buildItemAudio("AT", M.at["AT-001"], {}).audio);
eq(at.clips.map((c) => [c.role, c.index]), [["stimulus", null]], "AT: one stimulus clip, index null");
eq(Object.keys(at.clips[0]), KEYS, "written clip has exactly the Appendix B keys (no _verify)");
eq(at.clips[0].storagePath, M.at["AT-001"].clips.stimulus.storage.path, "storagePath from storage.path");
eq(at.clips[0].sha256, M.at["AT-001"].clips.stimulus.storage.sha256, "sha256 from storage.sha256");
eq(at.clips[0].durationSeconds, M.at["AT-001"].clips.stimulus.loudness.durationOut, "durationSeconds from loudness.durationOut");
eq(at.clips[0].voices, [{ voiceConstant: "TOEFL_TTS_VOICE_NA_F", gender: "F", accent: "NA", speakerLabel: null }], "voice derived from the constant");

const int = stripForWrite(buildItemAudio("INT", M.int["INT-001"], {}).audio);
eq(int.clips.map((c) => [c.role, c.index]), [["intro", null], ["question", 1], ["question", 2], ["question", 3], ["question", 4]], "INT: intro + question 1-4 (1-based)");
eq(int.clips[3].storagePath, "audio/toefl/int/INT-001/INT-001_q3.mp3", "question 3 -> manifest q3");
ok(new Set(int.clips.map((c) => JSON.stringify(c.voices))).size === 1, "INT: identical voice on all five");

const l1 = larItem("LAR-001");
const lar = stripForWrite(buildItemAudio("LAR", M.lar["LAR-001"], l1.item, { speakerGender: l1.speakerGender }).audio);
eq(lar.clips.map((c) => [c.role, c.index]), [["intro", null], ...[1, 2, 3, 4, 5, 6, 7].map((n) => ["utterance", n])], "LAR: intro + utterance 1-7");
eq(lar.clips[7].storagePath, "audio/toefl/lar/LAR-001/LAR-001_u7.mp3", "utterance 7 -> manifest u7");
eq(lar.clips[0].voices[0].gender, l1.speakerGender, "LAR voice gender matches INTRODUCTION SPEAKER GENDER");

const ltc = stripForWrite(buildItemAudio("LTC", M.ltc["LTC-001"], ltcSpeakers("LTC-001")).audio);
eq(ltc.clips[0].voices.map((v) => [v.speakerLabel, v.voiceConstant]), [["speakerA", "TOEFL_TTS_VOICE_NA_M"], ["speakerB", "TOEFL_TTS_VOICE_NA_F"]], "LTC: two voices, speakerA = first speaker in the file (Man)");
// A conversation where the Woman speaks first must map her to speakerA.
const womanFirst = Object.keys(M.ltc).find((id) => ltcSpeakers(id).stimulus.speakerA === "Woman");
if (womanFirst) {
  const w = stripForWrite(buildItemAudio("LTC", M.ltc[womanFirst], ltcSpeakers(womanFirst)).audio);
  eq(w.clips[0].voices.map((v) => [v.speakerLabel, v.voiceConstant.slice(-1)]), [["speakerA", "F"], ["speakerB", "M"]], `LTC ${womanFirst}: Woman first -> speakerA is the F voice`);
} else console.log("   (no real LTC item has the Woman speaking first; mapping covered by the synthetic case below)");
const swapped = clone(ltcSpeakers("LTC-001")); [swapped.stimulus.speakerA, swapped.stimulus.speakerB] = [swapped.stimulus.speakerB, swapped.stimulus.speakerA];
eq(buildItemAudio("LTC", M.ltc["LTC-001"], swapped).audio.clips[0].voices.map((v) => v.voiceConstant.slice(-1)), ["F", "M"], "speaker order follows the item, not the manifest");

console.log("3. text-only types and failure paths -> null, with reasons");
eq(buildItemAudio("AP", undefined, {}), { audio: null, problems: [] }, "text-only type: null, nothing reported");
const cases = {
  "no manifest entry": () => buildItemAudio("AT", undefined, {}),
  "clip missing": () => { const m = clone(M.int["INT-001"]); delete m.clips.q4; return buildItemAudio("INT", m, {}); },
  "not uploaded": () => { const m = clone(M.lcr["LCR-001"]); delete m.clips.stimulus.storage; return buildItemAudio("LCR", m, {}); },
  "uploaded file != normalised file": () => { const m = clone(M.lta["LTA-001"]); m.clips.stimulus.loudness.normalizedSha256 = "0".repeat(64); return buildItemAudio("LTA", m, {}); },
  "no duration": () => { const m = clone(M.at["AT-001"]); delete m.clips.stimulus.loudness.durationOut; return buildItemAudio("AT", m, {}); },
  "bad voice constant": () => { const m = clone(M.at["AT-001"]); m.voiceConstant = "SOMEONE"; return buildItemAudio("AT", m, {}); },
  "LAR gender mismatch": () => buildItemAudio("LAR", M.lar["LAR-001"], l1.item, { speakerGender: l1.speakerGender === "M" ? "F" : "M" }),
  "LAR utterance indices": () => buildItemAudio("LAR", M.lar["LAR-001"], { utterances: [{ utteranceIndex: 0 }] }, {}),
  "LTC unknown speaker": () => buildItemAudio("LTC", M.ltc["LTC-001"], { stimulus: { speakerA: "Man", speakerB: "Narrator" } }),
  "extra clip": () => { const m = clone(M.at["AT-001"]); m.clips.question1 = m.clips.stimulus; return buildItemAudio("AT", m, {}); },
};
for (const [name, fn] of Object.entries(cases)) {
  const r = fn();
  ok(r.audio === null && r.problems.length > 0, `${name}: null with a reason (${r.problems[0]})`);
}

console.log("4. Storage verification (Appendix B: size, MD5, sha256 metadata)");
(async () => {
  const built = buildItemAudio("INT", M.int["INT-001"], {}).audio;
  const good = async (p) => { const c = Object.values(M.int["INT-001"].clips).find((x) => x.storage.path === p).storage; return { size: String(c.size), md5Hash: c.md5Hash, metadata: { sha256: c.sha256 } }; };
  eq(await verifyClips(built, good), [], "all five match -> verified (size compared numerically; GCS returns it as a string)");
  const wrong = (field) => async (p) => { const m = await good(p); if (p.endsWith("_q2.mp3")) { if (field === "sha256") m.metadata.sha256 = "x"; else m[field] = field === "size" ? "1" : "y"; } return m; };
  for (const f of ["size", "md5Hash", "sha256"]) {
    const pr = await verifyClips(built, wrong(f));
    ok(pr.length === 1 && /question 2/.test(pr[0]), `${f} mismatch on q2 reported for that clip only (${pr[0]})`);
  }
  const pr = await verifyClips(built, async (p) => { if (p.endsWith("_intro.mp3")) throw new Error("No such object"); return good(p); });
  ok(pr.length === 1 && /intro: Storage object unreadable/.test(pr[0]), "unreadable object reported");

  console.log(`\n${passes} passed, ${failures} failed`);
  if (!failures) console.log("ITEM AUDIO PASSED — every real manifest item builds in the Appendix B shape; every failure path writes null with a reason.");
  process.exit(failures ? 1 : 0);
})();
