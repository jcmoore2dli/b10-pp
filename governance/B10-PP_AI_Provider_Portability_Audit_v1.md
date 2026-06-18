# B10-PP AI Provider Portability Audit

**Version:** 1.0
**Date:** June 18, 2026
**Status:** Confirmed — read-only code audit, no code changed
**Recommended location:** `governance/` (companion to `B10-PP_SCORING_PIPELINE_ARCHITECTURE_v1_5.txt`)

---

## Purpose

This document exists to answer one question, on the record, in case it is ever asked formally: **if B10-PP were required to stop depending on Anthropic's API — for example as a response to an NSM-driven AI vendor diversification or supply-chain-risk requirement — how hard would that be, and what exactly would have to change?**

B10-PP's privacy compliance supplemental already asserts that the platform's model-agnostic architecture is a mitigation against this risk. This audit confirms that the assertion is accurate at the code level, not just directionally true, and documents precisely what a swap would and would not touch. It was produced by walking the actual production code (`functions/index.js` and `functions/lib/claudeScorer.js`) rather than relying on memory of original design intent.

This is a feasibility record, not a migration plan. No code was changed in the course of this audit, and no swap is being proposed or scheduled. The hope, as stated at the time this was requested, is that it never has to be acted on.

---

## Scope and Method

The audit traced every place in the Cloud Functions backend that calls the Anthropic API, by searching the full repository (excluding `node_modules`) for references to "anthropic," "Anthropic," and "claude-" across `.js`, `.txt`, and `.md` files, then narrowing to the two files that contain actual API call code: `functions/index.js` and `functions/lib/claudeScorer.js`. For each call site, the audit examined the SDK import, the client constructor, the request parameters sent to the API, and the way the response was parsed and used downstream.

No `.env` files or secret values were read or displayed as part of this audit. Anthropic API key handling is referenced below only by variable and secret name, never by value.

---

## Findings

**There are exactly three places in the entire backend that call the Anthropic API**, and all three follow the identical pattern:

1. **`scoreTranscript`** in `functions/lib/claudeScorer.js` (client constructed at line 775, model/call parameters at lines 787–790) — the main scoring function for every task type (ESO, PARAPHRASE, NARRATION, DESCRIPTION, INSTRUCTIONS), including scaffold feedback generation, which is folded into the same prompt/response rather than requiring a separate call.

2. **`validateFeedbackGrammar`** in the same file (client constructed at line 821, model/call parameters at lines 831–834) — a secondary grammar-cleanup pass run on the strengths/gaps/language_feedback strings after initial scoring.

3. **`generateProgressSummary`** in `functions/index.js` (around lines 1288–1296) — the callable function behind the instructor-facing B2 progress summary feature, which takes a pre-built prompt from the client and returns plain text.

Each of the three follows this exact shape:

```
const Anthropic = require("@anthropic-ai/sdk");
const client = new Anthropic({ apiKey });
const response = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: <1000 or 1024>,
  temperature: 0,
  messages: [{ role: "user", content: prompt }],
});
const text = response.content[0]?.text || <fallback>;
```

None of the three use Anthropic's tool-use/function-calling feature, none use the `system` parameter, and none rely on any Claude-specific prompting convention at the API-call level — every prompt is built as a single plain-text string and sent as one user-role message. The response is read as a plain string and, in the two scoring functions, has markdown code-fence stripping applied (`replace(/\`\`\`json|\`\`\`/g, "")`) before `JSON.parse`. That post-processing logic is provider-agnostic; it would work unchanged regardless of which model produced the text.

API key handling is centralized through Firebase's Secret Manager binding: `const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY")` (declared once near the top of `functions/index.js`), referenced via `.value()` at each call site, and listed in the `secrets: [...]` array of each Cloud Function definition that needs it (currently at least four such declarations across `processSubmission`-type functions and `generateProgressSummary`).

---

## What Would Need to Change

A full Anthropic-to-OpenAI swap touches exactly three call sites, with the same five mechanical edits repeated at each:

- Swap the SDK import: `require("@anthropic-ai/sdk")` → `require("openai")`
- Swap the constructor: `new Anthropic({ apiKey })` → `new OpenAI({ apiKey })`
- Swap the call method: `client.messages.create({...})` → `client.chat.completions.create({...})` — the `messages: [{ role: "user", content: prompt }]` array shape carries over unchanged, since this is also OpenAI's chat completions message format
- Swap the response-extraction line: `response.content[0]?.text` → `response.choices[0]?.message?.content`
- Swap the hardcoded model string `"claude-sonnet-4-6"` for a chosen OpenAI model identifier

On the secrets/operations side: add a parallel `OPENAI_API_KEY` secret in Firebase Secret Manager (`firebase functions:secrets:set OPENAI_API_KEY`), and update the `secrets: [...]` arrays in the function definitions currently listing `ANTHROPIC_API_KEY` to reference the new secret instead.

It is worth double-checking the exact parameter names OpenAI expects (`max_tokens` vs. `max_completion_tokens`, depending on which API surface and model family is targeted) against current OpenAI documentation at the time of an actual swap, since that detail can shift between API versions. This is a verification step, not a structural obstacle.

---

## What Would NOT Need to Change

- `buildPrompt()`, `validateScore()`, and `validateScoreLabel()` in `claudeScorer.js` — all local JavaScript logic, with no dependency on which provider generated the response
- `computeDisfluencyMetadata()` — local computation, unrelated to the LLM call
- The scaffold feedback data structure (`scaffold_feedback.primary` / `.secondary`, target/level/descriptor/evidence fields) — this is just the shape of the JSON the prompt asks for; the same prompt asking the same JSON shape works regardless of provider
- Task routing logic — which prompt gets built for which `taskType` is decided entirely in `buildPrompt()`, before any API call happens
- Firestore schema, submission document structure, or anything client-side (frontend reads the same fields regardless of which model wrote them)

---

## Caveats

This audit confirms code-level portability, not scoring-quality portability. The scoring rubric prose and scaffold descriptors were written and calibrated against Claude's response tendencies through the project's norming process (Snorkl inter-rater benchmarking, REDS framework v1.5 Rev4, etc.). If a provider swap were ever executed, a renewed norming pass against real or sample transcripts would be warranted to confirm a different model family interprets the same rubric language consistently before trusting it in production. That is a scoring-calibration question, separate from the architectural portability question this document addresses, and should not be conflated with it if this document is cited in a compliance context.

---

## Conclusion

The claim that B10-PP has a model-agnostic architecture, made in the privacy compliance supplemental as a mitigation against Anthropic/DoD supply-chain-risk exposure, is accurate as implemented. The entire Anthropic dependency surface is three structurally identical call sites in two files, none using provider-specific API features, with API key access already centralized through Firebase Secret Manager. A swap, if ever required, is a small and well-bounded mechanical change — not a redesign.
