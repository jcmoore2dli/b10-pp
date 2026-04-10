// B10-PP Scoring Service
// Reusable scoring function for ORI/COR and EXT task types
// Usage: import { scoreResponse } from './services/scoreResponse.js'

import { EVALUATION_POLICY } from '../config/aiPolicy.js';
import { ORI_COR_PARAPHRASE_PROMPT, EXT_COMPREHENSION_PROMPT } from '../config/scoringPrompts.js';

// ── TASK ROUTING ─────────────────────────────────────────────
function selectPrompt(taskType) {
  switch (taskType) {
    case 'PARA':
      return ORI_COR_PARAPHRASE_PROMPT;
    case 'EXT':
      return EXT_COMPREHENSION_PROMPT;
    default:
      throw new Error(`Unknown taskType: ${taskType}. Must be PARA or EXT.`);
  }
}

// ── BUILD USER MESSAGE ────────────────────────────────────────
function buildUserMessage({ taskType, passageText, transcript, arcAnchor }) {
  if (taskType === 'EXT') {
    if (!arcAnchor?.commonAssumption || !arcAnchor?.actualMechanism) {
      throw new Error('EXT tasks require arcAnchor with commonAssumption and actualMechanism.');
    }
    return `PASSAGE TEXT:\n${passageText}\n\nARC_ANCHOR:\nCommon Assumption: ${arcAnchor.commonAssumption}\nActual Mechanism: ${arcAnchor.actualMechanism}\n\nSTUDENT TRANSCRIPT:\n${transcript}`;
  }

  return `PASSAGE TEXT:\n${passageText}\n\nSTUDENT TRANSCRIPT:\n${transcript}`;
}

// ── RESPONSE VALIDATION ───────────────────────────────────────
function validateResponse(parsed) {
  const requiredFields = [
    'score',
    'score_label',
    'strengths',
    'gaps',
    'language_feedback',
    'transcript_note'
  ];

  const missingFields = requiredFields.filter(field => !(field in parsed));

  if (missingFields.length > 0) {
    throw new Error(`Missing required fields in scoring response: ${missingFields.join(', ')}`);
  }

  if (![1, 2, 3, 4].includes(parsed.score)) {
    throw new Error(`Invalid score value: ${parsed.score}. Must be 1, 2, 3, or 4.`);
  }

  const validLabels = ['Inaccurate', 'Partial', 'Good', 'Excellent'];
  if (!validLabels.includes(parsed.score_label)) {
    throw new Error(`Invalid score_label: ${parsed.score_label}.`);
  }

  return true;
}

// ── MAIN SCORING FUNCTION ─────────────────────────────────────
export async function scoreResponse({ taskType, passageText, transcript, arcAnchor = null }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: 'Missing ANTHROPIC_API_KEY environment variable.' };
  }

  if (!taskType || !passageText || !transcript) {
    return { error: 'Missing required input: taskType, passageText, and transcript are required.' };
  }

  let scoringPrompt;
  try {
    scoringPrompt = selectPrompt(taskType);
  } catch (e) {
    return { error: e.message };
  }

  const systemPrompt = `${EVALUATION_POLICY}\n\n${scoringPrompt}`.trim();

  let userMessage;
  try {
    userMessage = buildUserMessage({ taskType, passageText, transcript, arcAnchor });
  } catch (e) {
    return { error: e.message };
  }

  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    });
  } catch (e) {
    return { error: `Network error: ${e.message}` };
  }

  const data = await response.json();

  if (!response.ok) {
    return { error: `Anthropic API error: ${data?.error?.message || 'Unknown error'}` };
  }

  const raw = data?.content?.[0]?.text;
  if (!raw) {
    return { error: 'Unexpected API response shape — no text content returned.' };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { error: `JSON parse failed. Raw response: ${raw}` };
  }

  try {
    validateResponse(parsed);
  } catch (e) {
    return { error: e.message };
  }

  return { result: parsed };
}
