// deepgramSTT.js
// Deepgram Pass 1 STT — disfluency-preserved, word-level timestamps.
//
// ARCHITECTURAL INVARIANT:
// Output of this module is the raw transcript passed directly to the
// scoring engine. No smoothing, cleaning, or modification is permitted
// between this output and the scoring engine input.
//
// Configuration:
//   - Disfluency preservation: ENABLED (filler words, false starts retained)
//   - Smart formatting: DISABLED
//   - Punctuation: ENABLED
//   - Speaker diarization: ENABLED (student speaker isolated before scoring)
//   - Word-level timestamps: ENABLED (required for disfluency metadata)
//
// LAR NOTE (Stage 00): `words` below is DIARIZATION-FILTERED to the dominant
// speaker. Listen-and-Repeat must NOT use it. In a LAR recording the played
// stimulus is in the same audio and is near-identical to what the student then
// says, so "dominant speaker" is meaningless and may isolate the wrong half.
// LAR uses `allWords` (unfiltered) and separates stimulus from response with
// `responseBoundaries` instead. See functions/lib/lar/segment.js.

"use strict";

const { createClient } = require("@deepgram/sdk");

/**
 * Transcribe audio buffer using Deepgram.
 * Returns raw transcript (student speaker only), the diarization-filtered
 * word array, and the UNFILTERED word array for boundary-segmented tasks.
 *
 * @param {string} apiKey - Deepgram API key
 * @param {Buffer} audioBuffer - audio file buffer
 * @param {string} mimeType - e.g. "audio/webm", "audio/mp4", "audio/wav"
 * @param {{ allowEmpty?: boolean }} [options] - allowEmpty: return an empty
 *   result instead of throwing when Deepgram hears no words. Off by default,
 *   so B10-PP's pipeline is unchanged. TOEFL needs it: an Interview answer
 *   the student left silent is a real, scorable outcome (band 0), not a
 *   transcription failure, and the TOEFL scorer treats the two differently.
 * @returns {{ transcript: string, words: Array, allWords: Array }}
 */
async function transcribeAudio(apiKey, audioBuffer, mimeType, { allowEmpty = false } = {}) {
  const deepgram = createClient(apiKey);

  const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
    audioBuffer,
    {
      model: "nova-2",
      smart_format: false,       // DISABLED — preserve raw disfluency
      punctuate: true,
      diarize: true,             // ENABLED — isolate student speaker
      filler_words: true,        // ENABLED — retain uh, um, eh
      utterances: true,
      words: true,               // ENABLED — word-level timestamps for metadata
      mimetype: mimeType || "audio/webm",
    }
  );

  if (error) {
    throw new Error(`Deepgram error: ${JSON.stringify(error)}`);
  }

  const channels = result?.results?.channels;
  if (!channels || channels.length === 0) {
    throw new Error("Deepgram returned no channels");
  }

  // Extract all words with speaker labels
  const allWords = channels[0]?.alternatives?.[0]?.words || [];

  if (allWords.length === 0) {
    if (allowEmpty) return { transcript: "", words: [], allWords: [] };
    throw new Error("Deepgram returned empty transcript");
  }

  // Isolate student speaker.
  // With diarization enabled, Deepgram assigns speaker integers.
  // In a B10-PP recording the student is the sole or dominant speaker.
  // Strategy: identify the speaker with the most words — that is the student.
  const speakerWordCounts = {};
  for (const w of allWords) {
    const s = w.speaker ?? 0;
    speakerWordCounts[s] = (speakerWordCounts[s] || 0) + 1;
  }

  const studentSpeaker = parseInt(
    Object.entries(speakerWordCounts).sort((a, b) => b[1] - a[1])[0][0]
  );

  const studentWords = allWords.filter(
    (w) => (w.speaker ?? 0) === studentSpeaker
  );

  // Build raw transcript from student words only.
  // INVARIANT: this string is never modified before reaching the scoring engine.
  const transcript = studentWords.map((w) => w.punctuated_word || w.word).join(" ");

  // `allWords` is additive: nothing downstream of `transcript`/`words` changes.
  return { transcript, words: studentWords, allWords };
}

module.exports = { transcribeAudio };
