// B10-PP Test Evaluation Script
// Tests the ORI/COR paraphrase scoring pipeline end-to-end

import { EVALUATION_POLICY } from './config/aiPolicy.js';
import { ORI_COR_PARAPHRASE_PROMPT } from './config/scoringPrompts.js';

// ── TEST INPUT ───────────────────────────────────────────────
const passageText = `
Scientists have found that sleep deprivation significantly impairs cognitive
performance. Studies show that people who sleep fewer than six hours per night
make more errors on attention tasks and have slower reaction times.
Researchers attribute this to the brain's reduced ability to clear metabolic
waste during insufficient sleep, which accumulates and disrupts neural function.
`;

const transcript = `
The passage talks about how not getting enough sleep affects how well people
think. If someone sleeps less than six hours, they make more mistakes and
react more slowly. The reason is that the brain cannot clean out waste
properly when you don't sleep enough, and this buildup interferes with
how the brain works.
`;

// ── BUILD SYSTEM PROMPT ──────────────────────────────────────
const systemPrompt = `
${EVALUATION_POLICY}

${ORI_COR_PARAPHRASE_PROMPT}
`.trim();

// ── MAIN ─────────────────────────────────────────────────────
async function runTest() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Missing ANTHROPIC_API_KEY environment variable.');
    process.exit(1);
  }

  console.log('Sending test transcript to Claude...\\n');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
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
      messages: [
        {
          role: 'user',
          content: `PASSAGE TEXT:\n${passageText}\n\nSTUDENT TRANSCRIPT:\n${transcript}`
        }
      ]
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Anthropic API error:');
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  const raw = data?.content?.[0]?.text;

  if (!raw) {
    console.error('Unexpected API response shape:');
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log('Raw response:\\n', raw, '\\n');

  try {
    const parsed = JSON.parse(raw);

    console.log('── PARSED RESULT ──────────────────────');
    console.log('Score:           ', parsed.score);
    console.log('Label:           ', parsed.score_label);
    console.log('Strengths:       ', parsed.strengths);
    console.log('Gaps:            ', parsed.gaps);
    console.log('Language:        ', parsed.language_feedback);
    console.log('Transcript note: ', parsed.transcript_note || '(none)');
  } catch (error) {
    console.error('JSON parse failed. Raw output above.');
    process.exit(1);
  }
}

runTest().catch((error) => {
  console.error('Unhandled error:');
  console.error(error);
  process.exit(1);
});
