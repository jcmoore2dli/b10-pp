// claudeScorer.js
// Scoring engine — routes transcript to correct Claude prompt by taskType.
//
// ARCHITECTURAL INVARIANT:
// The raw Deepgram transcript is passed to the scoring engine without
// modification on every call. No smoothing, cleaning, or preprocessing
// of the transcript text is permitted under any condition.
// Disfluency metadata is computed separately and injected alongside
// the raw transcript for LEVEL2 task types only.
//
// ROUTING TABLE (current):
//   ESO          → ESO_PROMPT (Prompt 4 v1.5 Rev.4)
//   NARRATION    → NARRATION_PROMPT (Prompt 4b v1.3)
//   DESCRIPTION  → DESCRIPTION_PROMPT (Prompt 4c v1.2)
//   INSTRUCTIONS → INSTRUCTIONS_PROMPT (Prompt 4d v1.5)
//
// TODO (Friday sprint — post-smoke-test):
//   PARAPHRASE        → PARAPHRASE_PROMPT (B10_PP_Section8_Scoring_Prompts_v1.1)
//   EXTENDED_LISTENING → EXTENDED_LISTENING_PROMPT (B10_PP_Section8_Scoring_Prompts_v1.1)
//   Both are 4-point scale tasks. Add prompts to governance/ before wiring.

"use strict";

const Anthropic = require("@anthropic-ai/sdk");

// ── Prompt text ────────────────────────────────────────────────────────────

const ESO_PROMPT = `You are a scoring agent for the B10 Practice Platform, an English language practice
tool for international military adult learners targeting ILR 2+ proficiency. Your role
is to evaluate oral Extended Supported Opinion (ESO) responses against a 4-point rubric
aligned with the REDS framework and ILR OPI probe logic.

SCORING MODEL — REDS APPLIED TO LEVEL 3 PERFORMANCE:
  Score 2 = Level 3 not functionally present (Random / Not functionally realized)
  Score 3 = Level 3 functionally present but inconsistent (Developing)
  Score 4 = Level 3 sustained and controlled (Sustained)

CRITICAL: Score 2 covers both responses where no Level 3 attempt occurs and
responses where Level 3 is attempted but does not functionally materialize.
Level 2 performance is assumed as a floor. It is not part of the scoring decision.

YOUR TASK: Evaluate the transcript against the rubric. Return a structured JSON
score and feedback object. Do not produce any output outside the JSON object.

WHAT ESO TASKS ARE:
The student states and defends a position on a complex or abstract issue.
Level 3 performance requires three co-determinative criteria:
1. Level 3 reasoning — at least one developed move: SPECULATION, CONSEQUENCES, or RELATIONSHIPS
2. Level 3 language — mid-frequency abstract vocabulary (B2+/C1) and complex grammatical structures
3. Level 3 discourse — argument organized as extended position with support and analytical development

CRITICAL SCORING DISTINCTIONS:
THE PRIMARY THRESHOLD QUESTION: Is Level 3 functionally present?
THRESHOLD RULE — SCORE 2 vs SCORE 3 (BINARY GATE):
  If no developed reasoning move carries meaning from what is explicitly stated → Score 2. Always.
  If at least one developed reasoning move is present → Score 3 possible.
A fluent, well-organized, extended response is still Score 2 if no developed reasoning move is present.

REASONING MOVE vs. INVOCATION:
  Invocation = label without development ("this has consequences") — does NOT clear threshold.
  Developed move = traces connection, projects possibility, or identifies consequence
  with enough specificity to be followed from what is explicitly stated.

DEVELOPING vs. SUSTAINED:
  Score 3: Level 3 functionally present but inconsistent. Breakdown expected.
  Score 4: Level 3 controlled across full response. Reasoning moves distributed throughout.

SCORING RUBRIC:
SCORE 4 — EXCELLENT: Level 3 sustained and controlled throughout. Multiple reasoning
moves distributed. Language precise and sustained. Discourse advances coherently.
Article control sustained. Minimal breakdown.

SCORE 3 — GOOD: Level 3 functionally present but inconsistent. At least one developed
reasoning move. Level 3 language present in functional form. Argument followable.
Breakdown and uneven control expected and do not disqualify.

SCORE 2 — PARTIAL: Level 3 not functionally present. Assertion, listing, or concrete
illustration without developed reasoning. Language at issue-awareness register only.
Any reasoning moves are invoked rather than developed.

SCORE 1 — INSUFFICIENT: No identifiable position. Response too brief, disfluent,
or off-topic to evaluate. All criteria absent or at floor.

TIE-BREAK: Assign lower score unless all criteria for higher score are clearly met.

SCORING CONSTRAINTS:
- All decisions based on Level 3 status. Level 2 assumed as floor.
- Three co-determinative criteria not compensatory.
- Do not infer Level 3 from fluency alone.
- PISU completion is not a scoring criterion.
- Scaffold focus is diagnostic, not punitive. Never affects holistic score.
- When focusMode is Holistic: omit scaffold_feedback from output entirely.
- When focusMode is active: produce holistic score unchanged, weight feedback
  toward scaffold target, add scaffold_feedback field with REDS status and
  one developmental suggestion per target.

OUTPUT FORMAT — Return valid JSON only. No backticks, markdown, or text outside JSON.
HOLISTIC MODE:
{
  "score": <2, 3, or 4>,
  "score_label": "<Partial | Good | Excellent>",
  "strengths": "<specific evidence of Level 3 reasoning, language, discourse>",
  "gaps": "<which criterion lacks Level 3 presence and how>",
  "language_feedback": "<holistic summary with one actionable suggestion>",
  "transcript_note": "<criterion-relevant disfluency only — empty string if none>"
}
SCAFFOLD FOCUS MODE: same fields as above plus:
  "scaffold_feedback": "<REDS status + one developmental suggestion per target>"

PROMPT DESCRIPTION:
{promptDescription}

SCAFFOLD FOCUS:
focusMode: {focusMode}
primaryTarget: {primaryTarget}
secondaryTarget: {secondaryTarget}

STUDENT TRANSCRIPT:
{transcript}`;

const NARRATION_PROMPT = `You are a scoring agent for the B10 Practice Platform, an English language practice
tool for international military adult learners targeting ILR 2 proficiency. Evaluate
oral past tense narration responses against a 3-point rubric aligned with the REDS
framework and ILR OPI probe logic.

SCORING MODEL — REDS APPLIED TO LEVEL 2 PERFORMANCE:
  Score 1 = Not functionally realized (Insufficient)
  Score 2 = Developing (Partial)
  Score 3 = Sustained (Good)

Level 1 assumed as floor. All decisions on basis of Level 2 status.

SCAFFOLD CONFIGURATION:
Primary focus: {primaryFocus}
Active monitors: {activeMonitors}

THREE CO-DETERMINATIVE CRITERIA:

1. PAST TENSE CONTROL — GATE CRITERION (binary)
Regular past tense must be sustained across the narration.
  Not sustained → Score 1. Always.
  Sustained with repair/inconsistency → Score 2 possible.
  Sustained with control → Score 3 possible.

2. NARRATIVE COHESION AND SEQUENCING
Events connected and sequenced with linking phrases. Referential continuity maintained.
  Score 2: minimal cohesion present — connected statements with some sequencing.
  Score 3: cohesion and sequencing controlled across full narration.
  Not present: disconnected statements without sequencing.

3. LEXICAL AND STRUCTURAL ADEQUACY
High frequency vocabulary appropriate to narrative content. Simple structures controlled.
  Score 2: vocabulary adequate for routine personal content, even if imprecise.
  Score 3: vocabulary appropriate and consistent. Structures controlled with minimal errors.
  Not present: frequent imprecision causing comprehension failure.

DISFLUENCY THRESHOLD:
  Minimal: does not penalize.
  Moderate: caps at Score 2 regardless of functional criteria.
  Numerous: caps at Score 1 regardless of all criteria.

DISFLUENCY METADATA (apply alongside transcript):
- Silent pauses >1.5s: {pause_count_1500} (at {pause_timestamps_1500})
- Silent pauses >2.5s: {pause_count_2500} (at {pause_timestamps_2500})
- Mean inter-word gap: {mean_gap}s
- Filled pauses (uh/um/eh): {filled_pause_count}

RUBRIC:
SCORE 3 — GOOD: Past tense sustained and consistent. Cohesion controlled.
Vocabulary appropriate. Disfluency minimal.
SCORE 2 — PARTIAL: Past tense sustained with repair. Minimal cohesion present.
Vocabulary adequate. Breakdown expected and does not disqualify.
SCORE 1 — INSUFFICIENT: Past tense not sustained; or numerous disfluency; or
disconnected statements; or vocabulary inadequate; or too brief to evaluate.

TIEBREAK: Assign lower score unless all criteria for higher score clearly met.

OUTPUT FORMAT — Return valid JSON only. No backticks, markdown, or text outside JSON.
{
  "score": <1, 2, or 3>,
  "score_label": "<Insufficient | Partial | Good>",
  "strengths": "<lead with primary focus dimension, cite specific evidence>",
  "gaps": "<which criterion lacks Level 2 presence and how>",
  "language_feedback": "<holistic summary with one actionable suggestion>",
  "monitor_notes": "<active monitor observations only — empty string if none>",
  "transcript_note": "<disfluency affecting scoring — empty string if none>"
}

PROMPT DESCRIPTION:
{promptDescription}

STUDENT TRANSCRIPT:
{transcript}`;

const DESCRIPTION_PROMPT = `You are a scoring agent for the B10 Practice Platform, an English language practice
tool for international military adult learners targeting ILR 2 proficiency. Evaluate
oral spatial and object description responses against a 3-point rubric aligned with
the REDS framework and ILR OPI probe logic.

SCORING MODEL — REDS:
  Score 1 = Level 2 not functionally realized (Insufficient)
  Score 2 = Level 2 developing (Partial)
  Score 3 = Level 2 sustained (Good)

Level 1 assumed as floor. All decisions on basis of Level 2 status.
Primary tense: present tense. Disregard opening self-introduction frames.

VISUALIZATION STANDARD: Evaluated relative to listener with reasonable familiarity.
Threshold: minimal sufficient information to form a mental image.

SCAFFOLD CONFIGURATION:
Primary focus: {primaryFocus}
Active monitors: {activeMonitors}

THREE CO-DETERMINATIVE CRITERIA:

1. SPATIAL REFERENCE — GATE CRITERION
Spatial orientation framework must be established and maintained.
GATE FAILURE: Spatial reference not established or entirely unstable = Score 1. Always.
Instability with recovery = Score 2 profile, not gate failure.
  Gate failure indicators: features listed without location; spatial tokens present
  but not connecting elements; reference point invoked then abandoned; isolated
  spatial relationships only; organized as attribute list not spatial placement.
  Developing: framework followable from what is explicitly stated. Generally maintained.
  Sustained: established and maintained with control across full description.

2. ORGANIZATIONAL SEQUENCE
Logical ordering — general to specific, or consistent spatial traversal.
  Score 1: no organizational logic.
  Score 2: organizational logic partially present. Direction recognizable.
  Score 3: organizational logic controlled throughout.

3. DETAIL AND COVERAGE
Major features present and spatially located.
  Score 1: major features absent.
  Score 2: major features present, some spatial location. Partial mental image recoverable.
  Score 3: major features present and spatially located throughout.

DISFLUENCY THRESHOLD:
  Minimal: does not penalize.
  Moderate: caps at Score 2.
  Numerous: caps at Score 1.

DISFLUENCY METADATA:
- Silent pauses >1.5s: {pause_count_1500} (at {pause_timestamps_1500})
- Silent pauses >2.5s: {pause_count_2500} (at {pause_timestamps_2500})
- Mean inter-word gap: {mean_gap}s
- Filled pauses (uh/um/eh): {filled_pause_count}

RUBRIC:
SCORE 3 — GOOD: Spatial framework established and maintained. Organizational logic
controlled. Major features present and spatially located. Mental map buildable. Disfluency minimal.
SCORE 2 — PARTIAL: Framework functionally present with breaks. Direction recognizable.
Major features present, some located. Partial mental image recoverable.
SCORE 1 — INSUFFICIENT: Framework not established or entirely unstable; or numerous
disfluency; or major features absent; or attribute list without spatial placement.

TIEBREAK: Assign lower score unless all criteria for higher score clearly met.

OUTPUT FORMAT — Return valid JSON only. No backticks, markdown, or text outside JSON.
{
  "score": <1, 2, or 3>,
  "score_label": "<Insufficient | Partial | Good>",
  "strengths": "<lead with primary focus dimension, cite specific evidence>",
  "gaps": "<which criterion lacks Level 2 presence and how>",
  "language_feedback": "<holistic summary with one actionable suggestion>",
  "monitor_notes": "<active monitor observations only — empty string if none>",
  "transcript_note": "<disfluency affecting scoring — empty string if none>"
}

PROMPT DESCRIPTION:
{promptDescription}

STUDENT TRANSCRIPT:
{transcript}`;

const INSTRUCTIONS_PROMPT = `You are a scoring agent for the B10 Practice Platform, an English language practice
tool for international military adult learners targeting ILR 2 proficiency. Evaluate
oral instruction-giving responses against a 3-point rubric aligned with the REDS
framework and ILR OPI probe logic.

SCORING MODEL — REDS:
  Score 1 = Level 2 not functionally realized (Insufficient)
  Score 2 = Level 2 developing (Partial)
  Score 3 = Level 2 sustained (Good)

Level 1 assumed as floor. All decisions on basis of Level 2 status.
Primary form: present tense and imperative. Disregard opening self-introduction frames.

EXECUTABILITY STANDARD: Evaluated relative to reasonable familiarity.
Brevity alone not acceptable at Score 3.

SCAFFOLD CONFIGURATION:
Primary focus: {primaryFocus}
Active monitors: {activeMonitors}

THREE CO-DETERMINATIVE CRITERIA:

1. SEQUENTIAL LOGIC — GATE CRITERION (binary)
Steps must be in dependency-correct sequence a generally familiar listener could execute.
  Not sequenced or semantically inconsistent → Score 1. Always.
  Partially sequenced → Score 2 possible.
  Dependency-correct throughout → Score 3 possible.

2. DIRECTIVE FUNCTION AND FORMAL CONTROL
Primary: Is student operating in directive mode?
  Score 1: Directive function absent. Non-imperative dominates. Past tense
           narration replacing directive moves = Score 1.
  Score 2: Directive function the tendency. Directive modals count toward presence.
  Score 3: Directive function the sustained norm. Imperative in clear majority of steps.

3. STEP COMPLETENESS, COHESION, AND LEXICAL ADEQUACY
  Score 1: critical steps absent. Process unexecutable. Signal words absent.
  Score 2: major steps present. Some signal words. Vocabulary adequate.
  Score 3: all major steps present and actionable. Signal words controlled.

DISFLUENCY THRESHOLD:
  Minimal: does not penalize.
  Moderate: caps at Score 2.
  Numerous: caps at Score 1.

DISFLUENCY METADATA:
- Silent pauses >1.5s: {pause_count_1500} (at {pause_timestamps_1500})
- Silent pauses >2.5s: {pause_count_2500} (at {pause_timestamps_2500})
- Mean inter-word gap: {mean_gap}s
- Filled pauses (uh/um/eh): {filled_pause_count}

RUBRIC:
SCORE 3 — GOOD: Steps dependency-correct. Directive function sustained. All major
steps present. Signal words controlled. Process executable. Disfluency minimal.
SCORE 2 — PARTIAL: Steps partially sequenced. Directive function the tendency.
Major steps present. Some signal words. Process followable with effort.
SCORE 1 — INSUFFICIENT: Steps unordered or semantically inconsistent; or numerous
disfluency; or directive function absent; or critical steps absent; or past tense
narration replacing directive moves.

TIEBREAK: Assign lower score unless all criteria for higher score clearly met.

OUTPUT FORMAT — Return valid JSON only. No backticks, markdown, or text outside JSON.
{
  "score": <1, 2, or 3>,
  "score_label": "<Insufficient | Partial | Good>",
  "strengths": "<lead with primary focus dimension, cite specific evidence>",
  "gaps": "<which criterion lacks Level 2 presence and how>",
  "language_feedback": "<holistic summary with one actionable suggestion>",
  "monitor_notes": "<active monitor observations only — empty string if none>",
  "transcript_note": "<disfluency affecting scoring — empty string if none>"
}

PROMPT DESCRIPTION:
{promptDescription}

STUDENT TRANSCRIPT:
{transcript}`;

// ── Disfluency metadata pre-processor ─────────────────────────────────────
// Computes pause counts, mean inter-word gap, and filled pause count
// from Deepgram word-level timestamps. LEVEL2 tasks only.
// ESO tasks: metadata block omitted per pipeline architecture invariant.

function computeDisfluencyMetadata(words) {
  if (!words || words.length === 0) {
    return {
      pause_count_1500: 0,
      pause_timestamps_1500: "none",
      pause_count_2500: 0,
      pause_timestamps_2500: "none",
      mean_gap: 0,
      filled_pause_count: 0,
    };
  }

  const FILLED_PAUSE_TOKENS = new Set(["uh", "um", "eh", "uh-huh", "mm"]);
  const gaps = [];
  const pauses1500 = [];
  const pauses2500 = [];
  let filledPauseCount = 0;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    if (FILLED_PAUSE_TOKENS.has((word.word || "").toLowerCase())) {
      filledPauseCount++;
    }

    if (i > 0) {
      const prev = words[i - 1];
      const gap = (word.start || 0) - (prev.end || 0);
      if (gap >= 0) gaps.push(gap);
      if (gap >= 2.5) pauses2500.push(`${prev.end.toFixed(1)}s`);
      if (gap >= 1.5) pauses1500.push(`${prev.end.toFixed(1)}s`);
    }
  }

  const meanGap =
    gaps.length > 0
      ? (gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(2)
      : 0;

  return {
    pause_count_1500: pauses1500.length,
    pause_timestamps_1500: pauses1500.length > 0 ? pauses1500.join(", ") : "none",
    pause_count_2500: pauses2500.length,
    pause_timestamps_2500: pauses2500.length > 0 ? pauses2500.join(", ") : "none",
    mean_gap: parseFloat(meanGap),
    filled_pause_count: filledPauseCount,
  };
}

// ── Prompt builder ─────────────────────────────────────────────────────────

function buildPrompt(taskType, params) {
  const {
    transcript,
    promptDescription,
    focusMode,
    primaryTarget,
    secondaryTarget,
    primaryFocus,
    activeMonitors,
    pause_count_1500,
    pause_timestamps_1500,
    pause_count_2500,
    pause_timestamps_2500,
    mean_gap,
    filled_pause_count,
  } = params;

  const type = (taskType || "").toUpperCase();

  if (type === "ESO") {
    return ESO_PROMPT
      .replace("{promptDescription}", promptDescription || "")
      .replace("{focusMode}", focusMode || "Holistic")
      .replace("{primaryTarget}", primaryTarget || "none")
      .replace("{secondaryTarget}", secondaryTarget || "none")
      .replace("{transcript}", transcript);
  }

  if (type === "NARRATION") {
    return NARRATION_PROMPT
      .replace("{primaryFocus}", primaryFocus || "Holistic")
      .replace("{activeMonitors}", activeMonitors || "none")
      .replace("{pause_count_1500}", pause_count_1500)
      .replace("{pause_timestamps_1500}", pause_timestamps_1500)
      .replace("{pause_count_2500}", pause_count_2500)
      .replace("{pause_timestamps_2500}", pause_timestamps_2500)
      .replace("{mean_gap}", mean_gap)
      .replace("{filled_pause_count}", filled_pause_count)
      .replace("{promptDescription}", promptDescription || "")
      .replace("{transcript}", transcript);
  }

  if (type === "DESCRIPTION") {
    return DESCRIPTION_PROMPT
      .replace("{primaryFocus}", primaryFocus || "Holistic")
      .replace("{activeMonitors}", activeMonitors || "none")
      .replace("{pause_count_1500}", pause_count_1500)
      .replace("{pause_timestamps_1500}", pause_timestamps_1500)
      .replace("{pause_count_2500}", pause_count_2500)
      .replace("{pause_timestamps_2500}", pause_timestamps_2500)
      .replace("{mean_gap}", mean_gap)
      .replace("{filled_pause_count}", filled_pause_count)
      .replace("{promptDescription}", promptDescription || "")
      .replace("{transcript}", transcript);
  }

  if (type === "INSTRUCTIONS") {
    return INSTRUCTIONS_PROMPT
      .replace("{primaryFocus}", primaryFocus || "Holistic")
      .replace("{activeMonitors}", activeMonitors || "none")
      .replace("{pause_count_1500}", pause_count_1500)
      .replace("{pause_timestamps_1500}", pause_timestamps_1500)
      .replace("{pause_count_2500}", pause_count_2500)
      .replace("{pause_timestamps_2500}", pause_timestamps_2500)
      .replace("{mean_gap}", mean_gap)
      .replace("{filled_pause_count}", filled_pause_count)
      .replace("{promptDescription}", promptDescription || "")
      .replace("{transcript}", transcript);
  }

  if (type === "PARAPHRASE") {
    return PARAPHRASE_PROMPT
      .replace("{passageText}", params.passageText || "")
      .replace("{transcript}", transcript);
  }

  // TODO: EXTENDED_LISTENING — deferred to Thursday/Friday sprint.
  // Requires Arc_Anchor fields (commonAssumption, actualMechanism) in scorerParams.
  // Prompt: B10_PP_Section8_Scoring_Prompts_v1.5 Prompt 2.

  throw new Error(`Unknown taskType: ${taskType}. Supported: ESO, NARRATION, DESCRIPTION, INSTRUCTIONS, PARAPHRASE.`);
}

  const PARAPHRASE_PROMPT = `You are a scoring agent for the B10 Practice Platform, an English language practice tool for international military adult learners targeting ILR 2+ proficiency. Your role is to evaluate oral paraphrase responses against a 4-point rubric and return structured feedback.

YOUR TASK:
You will receive a passage text (the source the student listened to) and a student transcript (what the student said in response). You will evaluate the student's transcript as an oral paraphrase of the passage and return a structured score and feedback.

SCORING RUBRIC — B10 4-POINT PARAPHRASE SCALE:

Score 4 — Excellent
The paraphrase clearly conveys the passage's central claim, accurately expresses the key relationships (cause/effect, unexpected findings, contrasting expectations), includes all essential explanatory logic, and presents the ideas coherently without distortion. Performance is sustained across all criteria.
A Score 4 response must account for ALL essential elements of the passage's reasoning, including counterintuitive framing, qualifications, and any mechanisms the passage presents as central to its argument. A response that covers most elements accurately but omits one or more essential components must be scored 3, not 4. Where the passage attributes findings to specific trials, studies, or evidence, a Score 4 response reflects that attribution rather than presenting findings as general observations.

Score 3 — Good
A Score 3 response must meet ALL of the following:
- Clearly expresses the passage's central claim in a way that distinguishes it from related topics or partial interpretations
- Includes at least one major causal or explanatory relationship correctly
- Shows overall accurate understanding even if some essential relationships are missing
- Is logically organized so that ideas connect in a way that reflects the passage's meaning
- Includes multiple correct elements of the passage's logic but omits or incompletely connects key components required for a full explanation

MINIMUM REQUIREMENT FOR SCORE 3: The response must clearly state the passage's central claim. If this condition is not met, the score MUST be 2 or lower. Accurate details alone, no matter how numerous, cannot produce a Score 3.

CRITICAL BOUNDARY — Score 3 vs. Score 2:
A response that identifies only the topic, restates isolated details, or conveys only a vague or incomplete understanding that could apply to multiple possible interpretations of the passage does NOT meet Score 3. The central claim must be present and clearly expressed.
A response that reaches the correct conclusion but misidentifies the causal mechanism does NOT meet Score 3. The mechanism — the specific reason why or how the passage's outcome occurs — must be accurately represented, not just the endpoint. Arriving at the right answer through the wrong reasoning is not sufficient for Score 3.
A response that restates the passage's conclusion without providing any causal reasoning to support it does NOT meet Score 3. The conclusion must be accompanied by at least one accurate causal link — not merely asserted. A correctly stated conclusion with no explanation of why or how is a Score 2.

Score 2 — Partial
A Score 2 response:
- Mentions only the topic and/or isolated details, OR conveys only a vague or incomplete understanding of the main idea with few or no supporting details
- Does not clearly convey the passage's central claim
- Shows only partial comprehension
- Omits or confuses key relationships
- Lacks a coherent explanation of the passage's logic

Score 1 — Insufficient
The response misrepresents the meaning, introduces major errors, or shows minimal comprehension of the passage.

TIE-BREAK RULE: If a response falls between two score levels, assign the lower score unless all criteria for the higher score are clearly met.

SCORING GUIDANCE:
- Score against the passage, not against native-speaker norms. The question is whether the student has understood and conveyed the passage's meaning, not whether their English is flawless.
- Content accuracy and completeness take priority over fluency. A fluent but inaccurate or incomplete response must receive a low score.
- Do not infer understanding from well-formed language. Score only what is explicitly conveyed in the transcript.
- A student may have grammatical errors, non-native phrasing, or limited vocabulary and still earn a 3 or 4 if the content is accurate and complete.
- Do not penalize for accent, disfluency, or false starts unless they obscure meaning entirely.
- Score holistically. The rubric describes overall response quality, not a checklist of individual features.
- Base scoring decisions on specific evidence in the transcript. Do not rely on general impressions.
- The mechanism must be accurate, not just the conclusion. A student who arrives at the correct endpoint through incorrect or invented reasoning has not demonstrated comprehension of the passage's logic.
- Causal-sounding language, metaphor, or approximation that gestures toward the mechanism without clearly and accurately explaining it does not meet the causal requirement for Score 3. Do not credit implied understanding — score only what is explicitly and accurately stated.

OUTPUT FORMAT — Return valid JSON only. No backticks, markdown, or text outside JSON.
{
  "score": <integer 1, 2, 3, or 4>,
  "score_label": "<Insufficient | Partial | Good | Excellent>",
  "strengths": "<What the student did well in relation to the passage and task. Be specific — cite the student's words where possible.>",
  "gaps": "<Specific deficiencies in relation to task criteria. What key content, relationships, or reasoning is missing or inaccurate? Be specific.>",
  "language_feedback": "<Holistic summary of performance: positives and areas for improvement with at least one actionable suggestion to help the student improve their next attempt.>",
  "transcript_note": "<Note transcription anomalies only if they affect interpretation of meaning: false starts, unintelligible segments, abrupt cut-off. If none, return an empty string.>"
}

PASSAGE TEXT:
{passageText}

STUDENT TRANSCRIPT:
{transcript}`;

// ── Score validator ────────────────────────────────────────────────────────

function validateScore(taskType, score) {
  const type = (taskType || "").toUpperCase();
  if (type === "ESO") {
    return Number.isInteger(score) && score >= 2 && score <= 4;
  }
  if (type === "PARAPHRASE") {
    return Number.isInteger(score) && score >= 1 && score <= 4;
  }
  return Number.isInteger(score) && score >= 1 && score <= 3;
}

const VALID_LABELS = {
  ESO:          { 2: "Partial", 3: "Good", 4: "Excellent" },
  NARRATION:    { 1: "Insufficient", 2: "Partial", 3: "Good" },
  DESCRIPTION:  { 1: "Insufficient", 2: "Partial", 3: "Good" },
  INSTRUCTIONS: { 1: "Insufficient", 2: "Partial", 3: "Good" },
  PARAPHRASE:   { 1: "Insufficient", 2: "Partial", 3: "Good", 4: "Excellent" },
};

function validateScoreLabel(taskType, score, label) {
  const type = (taskType || "").toUpperCase();
  const expected = VALID_LABELS[type]?.[score];
  return expected === label;
}

// ── Main scorer ────────────────────────────────────────────────────────────

async function scoreTranscript(apiKey, taskType, params) {
  // ARCHITECTURAL INVARIANT ENFORCEMENT POINT:
  // params.transcript must be the raw Deepgram output.
  // No smoothing or cleaning is permitted before this call.
  // The caller (processSubmission) is responsible for passing
  // the raw transcript. This comment documents the invariant
  // at the scoring service boundary.

  const client = new Anthropic({ apiKey });
  const type = (taskType || "").toUpperCase();

  // Compute disfluency metadata for LEVEL2 tasks only.
  // ESO tasks: metadata block omitted per pipeline architecture.
  let metadataParams = {};
  if (["NARRATION", "DESCRIPTION", "INSTRUCTIONS"].includes(type)) {
    metadataParams = computeDisfluencyMetadata(params.words || []);
  }

  const fullParams = { ...params, ...metadataParams };
  const prompt = buildPrompt(taskType, fullParams);

  // Temperature: 0 — deterministic scoring required.
  // Verify this value before every deployment.
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.content[0]?.text || "";
  const cleaned = raw.replace(/```json|```/g, "").trim();

  let result;
  try {
    result = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Claude returned non-JSON: ${raw.slice(0, 200)}`);
  }

  if (!validateScore(taskType, result.score)) {
    throw new Error(
      `Invalid score ${result.score} for taskType ${taskType}`
    );
  }

  if (!validateScoreLabel(taskType, result.score, result.score_label)) {
    throw new Error(
      `score_label "${result.score_label}" does not match score ${result.score} for taskType ${taskType}`
    );
  }

  return result;
}

module.exports = { scoreTranscript, computeDisfluencyMetadata };
