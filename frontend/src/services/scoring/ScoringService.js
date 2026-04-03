import { evaluate as claudeEvaluate } from './ClaudeScorer'

/**
 * ScoringService — model-agnostic evaluate() interface
 *
 * Input:  { transcript: string, passageText: string, passageId: string }
 * Output: { score: number, score_label: string, strengths: string, gaps: string, language_note: string }
 *
 * RecordingScreen calls only this function — never a scorer directly.
 * Transcription is handled in RecordingScreen before evaluate() is called.
 */
export async function evaluate(input) {
  return claudeEvaluate(input)
}
