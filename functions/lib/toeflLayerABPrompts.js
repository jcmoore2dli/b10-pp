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

module.exports = { EM_RUBRIC_PROMPT };
