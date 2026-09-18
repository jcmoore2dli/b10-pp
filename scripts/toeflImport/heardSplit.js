"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// B10-PP · scripts/toeflImport/heardSplit.js
// Splits an item's heard-only text out of its public document, per
// TOEFL_Firestore_Data_Model_Spec_v1_18.md: the restricted subcollection
// (toeflItems/{itemId}/restricted/heard), Change 3a/3c/3d, Change 4 and
// Appendix A.
//
// Firestore has no field-level read security, so anything on the public item
// document is readable by every signed-in user. Text the student is meant to
// HEAR, not read, goes to restricted/heard. Clients have no read rule there,
// and the scorers (Admin SDK) read it server-side.
//
//   AT   stimulus.transcriptText          -> heard.transcriptText
//   LTA  stimulus.talkText                -> heard.talkText
//   LCR  stimulus.dialogueText            -> heard.dialogueText
//   LTC  stimulus.dialogueText            -> heard.dialogueText
//   INT  prompt.questions[].stem          -> heard.questions [{questionIndex, stem}]
//   LAR  utterances[].text                -> heard.utterances [{utteranceIndex, text}]
//
// LCR, beyond v1.18: the importer stores the spoken prompt a SECOND time, as
// the single MCQ question's stem (questions[0].stem === stimulus.dialogueText),
// and MCQRenderer displays stems. Moving dialogueText alone would leave the
// prompt on screen. The public LCR stem is therefore blanked (""); the prompt
// lives only in restricted/heard. This is asserted rather than assumed: if an
// LCR stem ever differs from its dialogueText, the split fails loudly.
//
// Pure: the importer uses it to build what it writes, and the content gate
// uses it to derive what it expects to read back.
// ─────────────────────────────────────────────────────────────────────────────

const STIMULUS_FIELD = { AT: "transcriptText", LTA: "talkText", LCR: "dialogueText", LTC: "dialogueText" };
const HEARD_TYPES = new Set(["AT", "LTA", "LCR", "LTC", "INT", "LAR"]);

class HeardSplitError extends Error {}
const need = (cond, msg) => { if (!cond) throw new HeardSplitError(msg); };
const nonEmpty = (s) => typeof s === "string" && s.trim() !== "";

/**
 * @returns {{ pub: { stimulus, questions, prompt, utterances }, heard: object|null }}
 *   pub: the parsed fields as they go on the public document (copies).
 *   heard: the restricted/heard document, or null for the six text-only types.
 */
function splitHeard(taskType, parsed) {
  const pub = {
    stimulus: { ...(parsed.stimulus || {}) },
    questions: parsed.questions,
    prompt: parsed.prompt,
    utterances: parsed.utterances,
  };
  if (!HEARD_TYPES.has(taskType)) return { pub, heard: null };

  let heard;
  if (STIMULUS_FIELD[taskType]) {
    const key = STIMULUS_FIELD[taskType];
    const text = pub.stimulus[key];
    need(nonEmpty(text), `${taskType}: heard-only stimulus.${key} is missing or empty`);
    heard = { [key]: text };
    delete pub.stimulus[key];
    if (taskType === "LCR") {
      need(Array.isArray(parsed.questions) && parsed.questions.length === 1, "LCR: expected exactly one question");
      need(parsed.questions[0].stem === text, "LCR: question stem differs from the spoken prompt; refusing to blank it blindly");
      pub.questions = parsed.questions.map((q) => ({ ...q, stem: "" }));
    }
  } else if (taskType === "INT") {
    const qs = parsed.prompt && parsed.prompt.questions;
    need(Array.isArray(qs) && qs.length === 4, "INT: expected four prompt.questions");
    for (const q of qs) need(nonEmpty(q.stem), `INT: question ${q.questionIndex} has no stem`);
    heard = { questions: qs.map((q) => ({ questionIndex: q.questionIndex, stem: q.stem })) };
    pub.prompt = { ...parsed.prompt, questions: qs.map(({ stem, ...rest }) => rest) };
  } else if (taskType === "LAR") {
    const us = parsed.utterances;
    need(Array.isArray(us) && us.length === 7, "LAR: expected seven utterances");
    for (const u of us) need(nonEmpty(u.text), `LAR: utterance ${u.utteranceIndex} has no text`);
    heard = { utterances: us.map((u) => ({ utteranceIndex: u.utteranceIndex, text: u.text })) };
    pub.utterances = us.map(({ text, ...rest }) => rest);
  }
  return { pub, heard };
}

// Every heard-only string, for the leak scan: none may appear anywhere in the
// public document once written.
function heardStrings(heard) {
  if (!heard) return [];
  const out = [];
  for (const [k, v] of Object.entries(heard)) {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) for (const e of v) out.push(k === "questions" ? e.stem : e.text);
  }
  return out;
}

// Leak scan over any object: returns the heard strings found in it.
function findLeaks(publicDoc, heard) {
  const hay = JSON.stringify(publicDoc);
  return heardStrings(heard).filter((s) => hay.includes(JSON.stringify(s).slice(1, -1)));
}

module.exports = { splitHeard, heardStrings, findLeaks, HEARD_TYPES, STIMULUS_FIELD, HeardSplitError };
