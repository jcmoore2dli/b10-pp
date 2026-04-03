/**
 * ClaudeScorer — Phase 2 stub
 *
 * Input:  { transcript: string, passageText: string, passageId: string }
 * Output: { score: number, score_label: string, strengths: string, gaps: string, language_note: string }
 *
 * Phase 3+: will call a backend proxy that forwards to Claude API.
 * API keys must NEVER appear in frontend code.
 */
export async function evaluate(input) {
  await new Promise((resolve) => setTimeout(resolve, 1500))
  return {
    score: 3,
    score_label: 'Good',
    strengths:
      'You accurately identified the main finding and mentioned the age-related effect.',
    gaps:
      'The specific risk percentage and the blood pressure connection were not clearly stated.',
    language_note:
      "Good use of reporting language. Consider using 'the researchers found' to signal the source.",
  }
}
