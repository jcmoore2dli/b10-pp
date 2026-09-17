// scripts/toeflTts/config.js
// TOEFL TTS configuration: the eight ElevenLabs voices and the four delivery
// presets applied to them at generation time.
//
// Voices: final list confirmed by JC 2026-09-15 and re-verified against
// ElevenLabs. One voice per accent/gender slot. UK_F changed from Charlotte
// (6fZce9LFNG3iEITDfqZZ) to Lynd on 2026-09-16 (JC, after student listening:
// Charlotte misplaced stress on Interview "...? Why?" questions). UK_M changed
// from Alexander Kensington (mZ8K1MPRiT5wDQaasg3i) to Chris Brift on
// 2026-09-16 (JC: Alexander misplaced the same stress with and without the
// tag; Chris Brift got it right at 0.3s).
//
// Presets: PROPOSED starting values (2026-09-15), derived from the prose in
// TOEFL_ElevenLabs_Voice_Requirements.pdf §2. Not yet approved and not yet
// used in any API call. Calibrate by listening and by measured WPM before the
// first real batch (AT: 120-160 WPM, AT Content Spec §11).

"use strict";

const VOICES = Object.freeze({
  TOEFL_TTS_VOICE_NA_M: { voiceId: "uFIXVu9mmnDZ7dTKCBTX", name: "Justin Time" },
  TOEFL_TTS_VOICE_NA_F: { voiceId: "DIS307HFaAvJZzq496qM", name: "Cecilia O'Connor" },
  TOEFL_TTS_VOICE_UK_M: { voiceId: "UEKYgullGqaF0keqT8Bu", name: "Chris Brift" },
  TOEFL_TTS_VOICE_UK_F: { voiceId: "8z5UhJ1uv7X8TN5yg8oI", name: "Lynd" },
  TOEFL_TTS_VOICE_AU_M: { voiceId: "WLKp2jV6nrS8aMkPPDRO", name: "Paul" },
  TOEFL_TTS_VOICE_AU_F: { voiceId: "56bWURjYFHyYyVf490Dp", name: "Emma" },
  TOEFL_TTS_VOICE_NZ_M: { voiceId: "3Mb3pRhm3AnXiPCSQNXS", name: "Joel" },
  TOEFL_TTS_VOICE_NZ_F: { voiceId: "A3TiUH9xcSptIzvOUBnB", name: "Cassandra Woodhouse" },
});

// API key: TOEFL's own ElevenLabs key, read from this variable only. B10-PP's
// production key (B10_API_KEY_ENV) must never be used for TOEFL calls, not
// even as a fallback: refuse to run if API_KEY_ENV is unset, or if it holds
// the same value as B10_API_KEY_ENV.
const API_KEY_ENV = "TOEFL_TTS_API_KEY";
const B10_API_KEY_ENV = "ELEVENLABS_API_KEY";

// Same model and output format as B10-PP's generate_core_audio.py.
const MODEL_ID = "eleven_multilingual_v2";
const OUTPUT_FORMAT = "mp3_44100_128";

const PRESETS = Object.freeze({
  // "Flat, information-dense, measured pace — a professor lecturing,
  // minimal personal tone"
  toefl_at_lecture: {
    stability: 0.75,
    similarity_boost: 0.8,
    style: 0.0,
    use_speaker_boost: true,
    speed: 0.97, // was 0.95; JC listening 2026-09-15: NA_F slightly slow
  },
  // "Warmer, personal-anecdote opening, more conversational — a
  // general-audience expert"
  toefl_at_podcast: {
    stability: 0.5,
    similarity_boost: 0.8,
    style: 0.15,
    use_speaker_boost: true,
    speed: 1.0,
  },
  // "Natural, unscripted-sounding — a real person, not a broadcast narrator"
  toefl_int_interviewer: {
    stability: 0.45,
    similarity_boost: 0.75,
    style: 0.1,
    use_speaker_boost: true,
    speed: 1.0,
  },
  // "Maximum clarity, even pacing — precision over warmth; avoid stylized
  // delivery"
  toefl_lar_trainer: {
    stability: 0.85,
    similarity_boost: 0.85,
    style: 0.0,
    use_speaker_boost: true,
    // was 0.92; JC 2026-09-17 after a speed ladder on LAR-001 u7 (the longest
    // utterance, 17 words) in both LAR voices, seed 20260915. At 0.92 Justin
    // read it at 184 WPM against Cecilia's 169; at 0.90 they measure 172 and
    // 161. The setting moves in ~0.02 steps, so 0.89 and 0.90 are identical
    // and 0.91 matches 0.92. One value for both voices, no per-voice override.
    speed: 0.90,
  },
});

// Interview short questions (JC 2026-09-16). A question stem of maxWords or
// fewer is too short for the voice to find a natural pause, so it is rendered
// with speed 0.92 and one break tag at its clause break; longer stems and all
// intros use toefl_int_interviewer unchanged. Chosen by ear on Cecilia (NA_F),
// INT-001 Q1, seed 20260915 (0.93 judged slightly fast). The corpus has no
// stem of 27 words: short stems run 15-26, long ones start at 28.
const INT_SHORT_QUESTION = Object.freeze({ maxWords: 26, speed: 0.92, breakTime: "0.3s" });

// Interview short-question pause policy, per voice slot and pause type
// (JC 2026-09-16, from B2/B2+ student listening and PPS stress analysis;
// evidence: tts_calibration_2026-09-16/listening_test*). One question and one
// take per cell, so these are starting values; listen after generation and
// correct single clips with INT_CLIP_OVERRIDES.
//   breakTime: "0.3s" = one tag of that length; null = no tag (speed only).
//   status:    confirmed  - chosen by listening on this voice
//              decided    - JC chose between two imperfect versions
//              inferred   - not heard; follows this voice's other results
//              untested   - not heard; batch has no clips of this type here
//              default    - no setting was confirmed; JC 2026-09-16 ended the
//                           listening work and accepted a documented
//                           default, taken from what similar voices or
//                           question types showed working. Manifest flags
//                           these clips "default applied, not individually
//                           confirmed".
//              unresolved - blocks generation unless the clip has an
//                           override (no cell uses it now)
// Pause types come from intAudioPlan.shortQuestionText: tagOn ("...? Why?"),
// dash, comma. Stems with no clause break get no tag regardless.
const policy = (breakTime, status, note) => Object.freeze({ breakTime, status, note });
const INT_TAG_POLICY = Object.freeze({
  NA_F: Object.freeze({
    dash: policy("0.3s", "confirmed", "INT-001 q1: tag wins; untagged sounds rushed"),
    tagOn: policy("0.3s", "default", "INT-033 q2: wrong stress with and without tag; default = 0.3s, the setting 4 of 6 voices were confirmed with on this type"),
    comma: policy("0.3s", "inferred", "no natural pause at any break without the tag"),
  }),
  NA_M: Object.freeze({
    dash: policy("0.3s", "untested", "INT-001 q1: both versions misplace stress; no dash clips in batch"),
    tagOn: policy(null, "decided", "INT-033 q2: tag gives correct stress, but JC prefers untagged pacing"),
    comma: policy("0.3s", "confirmed", "INT-040 q1: no meaningful difference; both correct"),
  }),
  UK_F: Object.freeze({
    dash: policy("0.3s", "confirmed", "Lynd INT-001 q1: 0.3s best; untagged stresses 'or', 0.6s wrong"),
    tagOn: policy("0.3s", "confirmed", "Lynd INT-033 q2: tagged has correct 2-3-1 stress"),
    comma: policy("0.3s", "untested", "Lynd not heard on a comma stem; no comma clips in batch"),
  }),
  UK_M: Object.freeze({
    dash: policy(null, "default", "Chris Brift not heard on a dash stem; default = no tag, what every male voice judged on the dash type preferred (NZ_M, AU_M, Alexander)"),
    tagOn: policy("0.3s", "confirmed", "Chris Brift INT-033 q2: correct 2-3-1 stress at the 0.3s tag"),
    comma: policy("0.3s", "default", "Chris Brift not heard on a comma stem; default = 0.3s, confirmed for AU_F, NZ_M and NA_M on this type"),
  }),
  AU_F: Object.freeze({
    dash: policy(null, "confirmed", "INT-001 q1: tag adds rising intonation on 'life'"),
    tagOn: policy(null, "confirmed", "INT-033 q2: untagged has correct 2-3-1 stress"),
    comma: policy("0.3s", "confirmed", "INT-040 q1: untagged too fast, no breath"),
  }),
  AU_M: Object.freeze({
    dash: policy(null, "confirmed", "INT-001 q1: tag adds rising intonation on 'relaxing'"),
    tagOn: policy("0.3s", "confirmed", "INT-033 q2: both correct; tagged paces slightly better"),
    comma: policy(null, "confirmed", "INT-040 q1: untagged clean (tagged take had a splice defect)"),
  }),
  NZ_F: Object.freeze({
    dash: policy("0.3s", "untested", "INT-001 q1: tagged slightly more natural; no dash clips in batch"),
    tagOn: policy("0.3s", "default", "INT-033 q2: 'will' stress defect in both versions (voice-specific); default = 0.3s as for NA_F"),
    comma: policy("0.3s", "untested", "INT-040 q1: barely distinguishable; no comma clips in batch"),
  }),
  NZ_M: Object.freeze({
    dash: policy(null, "confirmed", "INT-001 q1: tagged too slow"),
    tagOn: policy("0.3s", "confirmed", "INT-033 q2: tagged has correct 2-3-1 stress; untagged does not"),
    comma: policy("0.3s", "confirmed", "INT-040 q1: tag sounds like a natural breath"),
  }),
});

// Per-clip corrections after listening, keyed "ITEM-ID:clip" (e.g.
// "INT-040:q1"). Each field present replaces the policy/global value for that
// clip only; `reason` is required.
//   breakTime: "0.6s" | "0.3s" | null   seed: number (a different take)
// An override also clears an "unresolved" policy for its clip.
const INT_CLIP_OVERRIDES = Object.freeze({});

// Every TOEFL generation call sends this seed, so an approved rendering
// reproduces in the real batch (JC 2026-09-16).
const TTS_SEED = 20260915;

const ACCENTS = Object.freeze(["NA", "UK", "AU", "NZ"]);
const GENDERS = Object.freeze(["F", "M"]);

function voiceConstantFor(accent, gender) {
  if (!ACCENTS.includes(accent)) throw new Error(`unknown accent: ${accent}`);
  if (!GENDERS.includes(gender)) throw new Error(`unknown gender: ${gender}`);
  return `TOEFL_TTS_VOICE_${accent}_${gender}`;
}

module.exports = {
  VOICES,
  PRESETS,
  API_KEY_ENV,
  B10_API_KEY_ENV,
  MODEL_ID,
  OUTPUT_FORMAT,
  INT_SHORT_QUESTION,
  INT_TAG_POLICY,
  INT_CLIP_OVERRIDES,
  TTS_SEED,
  ACCENTS,
  GENDERS,
  voiceConstantFor,
};
