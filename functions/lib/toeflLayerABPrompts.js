"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// B10-PP · functions/lib/toeflLayerABPrompts.js
// Layer A/B rubric prompts for the constructed-response TOEFL types.
//
// The rubric text is NOT in this file. Each prompt lives beside it under
// prompts/ as a byte-verbatim copy of its governing document's `## PROMPT`
// section — extracted with sed, never retyped — and is read from disk here.
//
// Why a separate file per prompt rather than a string literal:
//   1. Rubric content is governed (CLAUDE.md, Data) — never edited for grammar
//      or wording without JC sign-off. A standalone .md makes any edit show up
//      in review as a plain markdown diff, instead of hiding inside a JS
//      string where an escaped character reads like a wording change.
//   2. The rubric text is full of backticks and fenced code blocks. A template
//      literal would require escaping them, and an escaped copy is no longer
//      verbatim.
//   3. A new version is a file drop plus a one-line filename change here.
//
// Read once at module load (cold start), not per invocation.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");

function loadPrompt(filename) {
  return fs.readFileSync(path.join(__dirname, "prompts", filename), "utf8").trim();
}

// EM — Write an Email.
// Source: TOEFL_Email_Scoring_Prompt_LayerAB_v1_2.md, lines 20–192 — the
// `## Input contract` section through the end of `## PROMPT` (SYSTEM ROLE,
// LAYER A, LAYER B, OUTPUT).
//
// The range starts at the input contract, not at `## PROMPT`, and that is
// deliberate. Two rules the model needs live above the PROMPT heading: what an
// absent RELATIONSHIP TYPE line means (score normally, raise INCOMPLETE_DATA,
// never guess a type) and the literal `band0Gate: "no response"` for an empty
// submission. Extracting from `## PROMPT` left both out — the model was given
// INCOMPLETE_DATA's definition with no rule for when it applies, and an
// emulator run against an item with no relationshipType duly scored the email
// correctly and raised nothing (Sep 9). Widening the range fixes both; no
// rubric text was edited to do it.
//
// v1.2 is the enum fix — "Student/subordinate to authority figure" — matching
// Email_Content_Spec_v1_5.md §3.1 and real corpus content (EM-001).
const EM_RUBRIC_PROMPT = loadPrompt("TOEFL_Email_Scoring_LayerAB_v1_2.prompt.md");

// DISC — Write for an Academic Discussion.
// Source: TOEFL_Discussion_Scoring_Prompt_LayerAB_v1_1.md, lines 22-172 — the
// `## Input contract` section through the end of `## PROMPT`.
//
// Same range choice as EM, and for the same reason rather than by imitation:
// two rules the model needs sit ABOVE the `## PROMPT` heading. Missing peer
// posts ("score Layer A normally... Raise INCOMPLETE_DATA... Do not treat
// missing posts as a reason to lower the placement") and the literal
// band0Gate: "no response" for an empty submission. Cutting from `## PROMPT`
// would hand the model INCOMPLETE_DATA's definition with no rule for when it
// applies — the exact defect the Sep 9 EM emulator run surfaced.
//
// Verified byte-identical to the source range at extraction time (diff, not
// eyeball). No rubric text edited — rubric content is governed, CLAUDE.md.
const DISC_RUBRIC_PROMPT = loadPrompt(
  "TOEFL_Discussion_Scoring_LayerAB_v1_1.prompt.md"
);

// INT — Interview. Four questions, one attempt, one call.
// Source: TOEFL_Interview_Scoring_Prompt_LayerAB_v1_1.md, lines 20-206 — the
// `## Input contract` section through the end of `## PROMPT`.
//
// Same range choice as EM and DISC, and again for a reason verified against
// this document rather than carried over: two rules the model needs sit ABOVE
// the `## PROMPT` heading, and both are INT-specific. (1) The no-recording
// rule — the trigger passes `TRANSCRIPT: [NO RECORDING]` and the model scores
// that question band 0, versus a transcription failure where the model is
// never called at all. (2) The missing-delivery-evidence rule — score from the
// transcript alone, say so in the rationale, raise INCOMPLETE_DATA, never
// substitute a default. Cutting from `## PROMPT` would drop both.
//
// Verified byte-identical to the source range at extraction time (diff, not
// eyeball). No rubric text edited — rubric content is governed, CLAUDE.md.
const INT_RUBRIC_PROMPT = loadPrompt(
  "TOEFL_Interview_Scoring_LayerAB_v1_1.prompt.md"
);

module.exports = { EM_RUBRIC_PROMPT, DISC_RUBRIC_PROMPT, INT_RUBRIC_PROMPT };
