"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// B10-PP · scripts/toeflImport/itemAudio.js
// Builds a toeflItems document's `audio` field from the audio manifests, per
// TOEFL_Firestore_Data_Model_Spec_v1_18.md (Collection 1 `audio` row,
// Appendix B). Pure: no Firestore or Storage here. The importer supplies the
// Storage check (verifyClips) and decides what to write.
//
//   audio: null | { clips: [{ role, index, storagePath, durationSeconds,
//                             sha256, voices: [{voiceConstant, gender,
//                             accent, speakerLabel}] }] }
//
// Appendix B rules applied here:
//   - clips in playback order, exactly the type's required set
//     (AT/LTA/LCR/LTC: stimulus; INT: intro + question 1-4; LAR: intro +
//     utterance 1-7). index is 1-based for question/utterance, null otherwise.
//   - values DERIVED, never typed: storagePath and sha256 from the manifest's
//     `storage` record (the uploaded, normalised file), durationSeconds from
//     `loudness.durationOut` (the measured duration of that same file),
//     gender/accent read from the voice constant TOEFL_TTS_VOICE_<ACCENT>_<GENDER>.
//   - voices: 1 per clip (INT, LAR: identical on every clip; LAR's must match
//     the item's introduction speaker gender); LTC: 2, speakerLabel
//     "speakerA"/"speakerB", matched to the item's stimulus.speakerA/B.
//   - any mismatch -> audio null, with every reason reported. Never a partial
//     audio field.
// ─────────────────────────────────────────────────────────────────────────────

const AUDIO_TYPES = {
  AT: { manifest: "at", clips: [["stimulus", null]] },
  LTA: { manifest: "lta", clips: [["stimulus", null]] },
  LCR: { manifest: "lcr", clips: [["stimulus", null]] },
  LTC: { manifest: "ltc", clips: [["stimulus", null]] },
  INT: { manifest: "int", clips: [["intro", null], ...[1, 2, 3, 4].map((n) => ["question", n])] },
  LAR: { manifest: "lar", clips: [["intro", null], ...[1, 2, 3, 4, 5, 6, 7].map((n) => ["utterance", n])] },
};

// Manifest clip key for a (role, index): INT q1..q4, LAR u1..u7.
function manifestKey(role, index) {
  if (role === "question") return `q${index}`;
  if (role === "utterance") return `u${index}`;
  return role;
}

function voiceFromConstant(constant) {
  const m = /^TOEFL_TTS_VOICE_(NA|UK|AU|NZ)_(M|F)$/.exec(constant || "");
  if (!m) return null;
  return { voiceConstant: constant, gender: m[2], accent: m[1] };
}

/**
 * @param {string} taskType
 * @param {object} manifestEntry - manifests/<type>_audio_manifest.json items[itemId], or undefined
 * @param {object} item - { stimulus, utterances } as parsed by the importer
 * @param {object} [expect] - { speakerGender } for LAR (from INTRODUCTION SPEAKER GENDER)
 * @returns {{ audio: object|null, problems: string[] }}
 */
function buildItemAudio(taskType, manifestEntry, item, expect = {}) {
  const spec = AUDIO_TYPES[taskType];
  if (!spec) return { audio: null, problems: [] };          // text-only type: null, nothing to report
  const problems = [];
  if (!manifestEntry) return { audio: null, problems: [`no entry in ${spec.manifest}_audio_manifest.json`] };

  // Voices for this item (identical on every clip for the one-voice types).
  let voices = null;
  if (taskType === "LTC") {
    const byLabel = new Map((manifestEntry.turns || []).map((t) => [t.speakerLabel, t.voiceConstant]));
    const a = item?.stimulus?.speakerA, b = item?.stimulus?.speakerB;
    const va = voiceFromConstant(byLabel.get(a)), vb = voiceFromConstant(byLabel.get(b));
    if (!a || !b) problems.push("item has no stimulus.speakerA/speakerB");
    else if (!va || !vb) problems.push(`manifest has no voice for speaker ${!va ? JSON.stringify(a) : JSON.stringify(b)} (manifest speakers: ${[...byLabel.keys()].join(", ")})`);
    else if (byLabel.size !== 2) problems.push(`manifest has ${byLabel.size} speakers, expected 2`);
    else voices = [{ ...va, speakerLabel: "speakerA" }, { ...vb, speakerLabel: "speakerB" }];
  } else {
    const v = voiceFromConstant(manifestEntry.voiceConstant);
    if (!v) problems.push(`unrecognised voiceConstant ${JSON.stringify(manifestEntry.voiceConstant)}`);
    else voices = [{ ...v, speakerLabel: null }];
    if (v && taskType === "LAR" && expect.speakerGender && v.gender !== expect.speakerGender) {
      problems.push(`LAR voice gender ${v.gender} (${v.voiceConstant}) does not match INTRODUCTION SPEAKER GENDER ${expect.speakerGender}`);
    }
  }

  // LAR: utterance indices on the item must be exactly 1..7, the audio's indices.
  if (taskType === "LAR") {
    const idx = (item?.utterances || []).map((u) => u.utteranceIndex).join(",");
    if (idx !== "1,2,3,4,5,6,7") problems.push(`item utteranceIndex values ${idx} are not 1..7`);
  }

  const manifestClips = manifestEntry.clips || {};
  const required = spec.clips.map(([r, i]) => manifestKey(r, i));
  const extra = Object.keys(manifestClips).filter((k) => !required.includes(k));
  if (extra.length) problems.push(`manifest has clips outside Appendix B: ${extra.join(", ")}`);

  const clips = [];
  for (const [role, index] of spec.clips) {
    const key = manifestKey(role, index);
    const c = manifestClips[key];
    if (!c) { problems.push(`clip ${key}: missing from manifest`); continue; }
    const st = c.storage, lo = c.loudness;
    if (!st || !st.path) { problems.push(`clip ${key}: no storage record (not uploaded)`); continue; }
    if (typeof st.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(st.sha256)) { problems.push(`clip ${key}: storage.sha256 missing or malformed`); continue; }
    if (!lo || lo.normalizedSha256 !== st.sha256) {
      problems.push(`clip ${key}: uploaded file (storage.sha256) is not the recorded normalised file (loudness.normalizedSha256)`);
      continue;
    }
    if (typeof lo.durationOut !== "number" || !(lo.durationOut > 0)) { problems.push(`clip ${key}: no measured duration (loudness.durationOut)`); continue; }
    clips.push({
      role,
      index,
      storagePath: st.path,
      durationSeconds: lo.durationOut,
      sha256: st.sha256,
      voices,
      // Kept only for the Storage check; stripped before writing.
      _verify: { size: st.size, md5Hash: st.md5Hash },
    });
  }

  if (problems.length || !voices) return { audio: null, problems };
  return { audio: { clips }, problems: [] };
}

/**
 * Appendix B's "verified upload": Storage size and MD5 match the manifest,
 * and the object's sha256 metadata matches. `getMetadata(path)` returns the
 * object's metadata ({ size, md5Hash, metadata: { sha256 } }) or throws.
 * Returns the problems found; empty means every clip verified.
 */
async function verifyClips(audio, getMetadata) {
  const problems = [];
  for (const c of audio.clips) {
    const label = c.index == null ? c.role : `${c.role} ${c.index}`;
    let meta;
    try { meta = await getMetadata(c.storagePath); } catch (err) { problems.push(`clip ${label}: Storage object unreadable (${err.message})`); continue; }
    if (Number(meta.size) !== Number(c._verify.size)) problems.push(`clip ${label}: Storage size ${meta.size} != manifest ${c._verify.size}`);
    if (meta.md5Hash !== c._verify.md5Hash) problems.push(`clip ${label}: Storage md5 ${meta.md5Hash} != manifest ${c._verify.md5Hash}`);
    if (meta.metadata?.sha256 !== c.sha256) problems.push(`clip ${label}: Storage sha256 metadata ${meta.metadata?.sha256} != manifest ${c.sha256}`);
  }
  return problems;
}

// The written shape: exactly the Appendix B fields.
function stripForWrite(audio) {
  if (!audio) return null;
  return { clips: audio.clips.map(({ _verify, ...c }) => c) };
}

module.exports = { AUDIO_TYPES, buildItemAudio, verifyClips, stripForWrite, voiceFromConstant, manifestKey };
