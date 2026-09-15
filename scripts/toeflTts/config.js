// scripts/toeflTts/config.js
// TOEFL TTS configuration: the eight ElevenLabs voices and the four delivery
// presets applied to them at generation time.
//
// Voices: final list confirmed by JC 2026-09-15 and re-verified against
// ElevenLabs. One voice per accent/gender slot.
//
// Presets: PROPOSED starting values (2026-09-15), derived from the prose in
// TOEFL_ElevenLabs_Voice_Requirements.pdf §2. Not yet approved and not yet
// used in any API call. Calibrate by listening and by measured WPM before the
// first real batch (AT: 120-160 WPM, AT Content Spec §11).

"use strict";

const VOICES = Object.freeze({
  TOEFL_TTS_VOICE_NA_M: { voiceId: "uFIXVu9mmnDZ7dTKCBTX", name: "Justin Time" },
  TOEFL_TTS_VOICE_NA_F: { voiceId: "DIS307HFaAvJZzq496qM", name: "Cecilia O'Connor" },
  TOEFL_TTS_VOICE_UK_M: { voiceId: "mZ8K1MPRiT5wDQaasg3i", name: "Alexander Kensington" },
  TOEFL_TTS_VOICE_UK_F: { voiceId: "6fZce9LFNG3iEITDfqZZ", name: "Charlotte" },
  TOEFL_TTS_VOICE_AU_M: { voiceId: "WLKp2jV6nrS8aMkPPDRO", name: "Paul" },
  TOEFL_TTS_VOICE_AU_F: { voiceId: "56bWURjYFHyYyVf490Dp", name: "Emma" },
  TOEFL_TTS_VOICE_NZ_M: { voiceId: "3Mb3pRhm3AnXiPCSQNXS", name: "Joel" },
  TOEFL_TTS_VOICE_NZ_F: { voiceId: "A3TiUH9xcSptIzvOUBnB", name: "Cassandra Woodhouse" },
});

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
    speed: 0.95,
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
    speed: 0.92,
  },
});

const ACCENTS = Object.freeze(["NA", "UK", "AU", "NZ"]);
const GENDERS = Object.freeze(["F", "M"]);

function voiceConstantFor(accent, gender) {
  if (!ACCENTS.includes(accent)) throw new Error(`unknown accent: ${accent}`);
  if (!GENDERS.includes(gender)) throw new Error(`unknown gender: ${gender}`);
  return `TOEFL_TTS_VOICE_${accent}_${gender}`;
}

module.exports = { VOICES, PRESETS, MODEL_ID, OUTPUT_FORMAT, ACCENTS, GENDERS, voiceConstantFor };
