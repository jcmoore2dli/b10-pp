// B10-PP Scorer Test
// Tests both PARA and EXT scoring branches through scoreResponse.js

import { scoreResponse } from './services/scoreResponse.js';

// ── TEST 1 — ORI/COR PARAPHRASE ──────────────────────────────
const paraTest = {
  taskType: 'PARA',
  passageText: `
Scientists have found that sleep deprivation significantly impairs cognitive
performance. Studies show that people who sleep fewer than six hours per night
make more errors on attention tasks and have slower reaction times.
Researchers attribute this to the brain's reduced ability to clear metabolic
waste during insufficient sleep, which accumulates and disrupts neural function.
  `,
  transcript: `
The passage talks about how not getting enough sleep affects how well people
think. If someone sleeps less than six hours, they make more mistakes and
react more slowly. The reason is that the brain cannot clean out waste
properly when you don't sleep enough, and this buildup interferes with
how the brain works.
  `
};

// ── TEST 2 — EXT COMPREHENSION ───────────────────────────────
const extTest = {
  taskType: 'EXT',
  passageText: `
Many people assume that exercise improves mood simply because it feels good
to be active. However, researchers have found that the primary mechanism is
biochemical. Physical activity triggers the release of endorphins and increases
serotonin levels in the brain. These chemical changes directly regulate mood,
reduce anxiety, and improve emotional resilience — independent of whether the
person enjoys the activity itself.
  `,
  transcript: `
People think exercise makes you feel better just because being active is
enjoyable. But actually the real reason is chemical. When you exercise your
brain releases endorphins and serotonin goes up. These chemicals are what
actually change your mood and reduce anxiety, and this happens even if you
don't enjoy the exercise.
  `,
  arcAnchor: {
    commonAssumption: 'Exercise improves mood because physical activity feels good and enjoyable.',
    actualMechanism: 'Exercise improves mood through biochemical changes — specifically endorphin release and increased serotonin — which regulate mood independently of enjoyment.'
  }
};

// ── RUN BOTH TESTS ────────────────────────────────────────────
async function runTests() {
  console.log('Running PARA test...\n');
  const paraResult = await scoreResponse(paraTest);
  if (paraResult.error) {
    console.error('PARA test failed:', paraResult.error);
  } else {
    console.log('PARA Result:');
    console.log('Score:      ', paraResult.result.score);
    console.log('Label:      ', paraResult.result.score_label);
    console.log('Strengths:  ', paraResult.result.strengths);
    console.log('Gaps:       ', paraResult.result.gaps);
    console.log('Language:   ', paraResult.result.language_feedback);
    console.log('Transcript note:', paraResult.result.transcript_note || '(none)');
  }

  console.log('\n─────────────────────────────────────────\n');

  console.log('Running EXT test...\n');
  const extResult = await scoreResponse(extTest);
  if (extResult.error) {
    console.error('EXT test failed:', extResult.error);
  } else {
    console.log('EXT Result:');
    console.log('Score:      ', extResult.result.score);
    console.log('Label:      ', extResult.result.score_label);
    console.log('Strengths:  ', extResult.result.strengths);
    console.log('Gaps:       ', extResult.result.gaps);
    console.log('Language:   ', extResult.result.language_feedback);
    console.log('Transcript note:', extResult.result.transcript_note || '(none)');
  }
}

runTests().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
