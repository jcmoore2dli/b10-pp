/**
 * WhisperTranscriber — Phase 2 stub
 *
 * Input:  audioBlob {Blob}
 * Output: { transcript: string }
 *
 * Phase 3+: will call a backend proxy that forwards to Whisper API.
 * API keys must NEVER appear in frontend code.
 */
export async function transcribe(audioBlob) {
  await new Promise((resolve) => setTimeout(resolve, 1000))
  return {
    transcript:
      'The study found that sleep deprivation affects younger adults more strongly than previously thought, increasing blood pressure risk by forty percent.',
  }
}
