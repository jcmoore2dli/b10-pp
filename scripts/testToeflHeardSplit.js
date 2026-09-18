#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// B10-PP · scripts/testToeflHeardSplit.js
// Tests scripts/toeflImport/heardSplit.js: the v1.18 restricted/heard split
// the importer writes and its content gate re-derives. Every heard type moves
// exactly its field(s) and nothing else; text-only types are untouched; the
// LCR duplicate-stem case is guarded; the leak scan finds heard text anywhere
// in a public document. The whole-corpus check runs in the emulator import's
// content gate. Run: node scripts/testToeflHeardSplit.js
// ─────────────────────────────────────────────────────────────────────────────

const { splitHeard, findLeaks, heardStrings } = require("./toeflImport/heardSplit");
let passes = 0, failures = 0;
const ok = (c, m) => { if (c) passes++; else { failures++; console.log("  FAIL:", m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)}`);
const throws = (fn, re, m) => { try { fn(); ok(false, `${m}: did not throw`); } catch (e) { ok(re.test(e.message), `${m}: ${e.message}`); } };

console.log("stimulus-field types");
let r = splitHeard("AT", { stimulus: { transcriptText: "Today we discuss tides.", speakerCount: 1 }, questions: [{ questionIndex: 1, stem: "What is the talk about?" }] });
eq(r.pub.stimulus, { speakerCount: 1 }, "AT: transcript off the public stimulus");
eq(r.heard, { transcriptText: "Today we discuss tides." }, "AT: transcript in heard");
eq(r.pub.questions[0].stem, "What is the talk about?", "AT: on-screen question stem stays public");
r = splitHeard("LTA", { stimulus: { talkText: "Attention, students." } });
eq([r.pub.stimulus, r.heard], [{}, { talkText: "Attention, students." }], "LTA");
r = splitHeard("LTC", { stimulus: { dialogueText: "[Man]: Hi.\n[Woman]: Hello.", speakerA: "Man", speakerB: "Woman" } });
eq([r.pub.stimulus, r.heard], [{ speakerA: "Man", speakerB: "Woman" }, { dialogueText: "[Man]: Hi.\n[Woman]: Hello." }], "LTC: speakers stay public");

console.log("LCR: the prompt is also the question stem");
const lcr = { stimulus: { dialogueText: "Could you lend me your notes?" }, questions: [{ questionIndex: 1, stem: "Could you lend me your notes?", options: [{ optionId: "opt_a", text: "Sure, here." }], correctOptionId: "opt_a" }] };
r = splitHeard("LCR", lcr);
eq([r.pub.stimulus, r.pub.questions[0].stem, r.heard], [{}, "", { dialogueText: "Could you lend me your notes?" }], "LCR: prompt removed from stimulus AND stem");
eq(r.pub.questions[0].options, lcr.questions[0].options, "LCR: options untouched");
eq(lcr.questions[0].stem, "Could you lend me your notes?", "input not mutated");
throws(() => splitHeard("LCR", { ...lcr, questions: [{ ...lcr.questions[0], stem: "Something else" }] }), /differs from the spoken prompt/, "LCR stem != prompt refuses");

console.log("INT and LAR");
const intP = { stimulus: { contextSentence: "You are in a study." }, prompt: { questions: [1, 2, 3, 4].map((n) => ({ questionIndex: n, stem: `Stem ${n}?`, questionType: "Opinion" })) } };
r = splitHeard("INT", intP);
eq(r.pub.prompt.questions[0], { questionIndex: 1, questionType: "Opinion" }, "INT: public question keeps index and type, no stem");
eq(r.heard.questions.map((q) => q.stem), ["Stem 1?", "Stem 2?", "Stem 3?", "Stem 4?"], "INT: stems in heard, by questionIndex");
eq(r.pub.stimulus, { contextSentence: "You are in a study." }, "INT: contextSentence (heard AND printed) stays public");
const larP = { stimulus: { introduction: "You are being trained." }, utterances: [1, 2, 3, 4, 5, 6, 7].map((i) => ({ utteranceIndex: i, text: `Sentence ${i}.`, part: "greeting" })) };
r = splitHeard("LAR", larP);
eq(r.pub.utterances[6], { utteranceIndex: 7, part: "greeting" }, "LAR: public utterances keep index and part");
eq(r.heard.utterances[6], { utteranceIndex: 7, text: "Sentence 7." }, "LAR: text in heard");
eq(r.pub.stimulus, { introduction: "You are being trained." }, "LAR: introduction (heard AND printed) stays public");
throws(() => splitHeard("LAR", { utterances: larP.utterances.slice(0, 6) }), /seven/, "LAR must have 7");
throws(() => splitHeard("INT", { prompt: { questions: intP.prompt.questions.map((q, i) => (i === 2 ? { ...q, stem: " " } : q)) } }), /question 3 has no stem/, "INT empty stem refuses");
throws(() => splitHeard("AT", { stimulus: { speakerCount: 1 } }), /transcriptText is missing/, "AT missing transcript refuses");

console.log("text-only types untouched");
for (const t of ["AP", "EM", "DISC", "CTW", "RDL", "BAS"]) {
  const p = { stimulus: { passageText: "x" }, questions: [{ questionIndex: 1, stem: "q" }] };
  r = splitHeard(t, p);
  ok(r.heard === null && JSON.stringify(r.pub.stimulus) === JSON.stringify(p.stimulus) && r.pub.questions === p.questions, `${t}: heard null, public unchanged`);
}

console.log("leak scan");
const h = splitHeard("LAR", larP).heard;
eq(heardStrings(h).length, 7, "7 heard strings for LAR");
eq(findLeaks({ utterances: [{ utteranceIndex: 1, part: "greeting" }] }, h), [], "clean public doc: no leaks");
eq(findLeaks({ somewhere: { deep: ["x", "Sentence 4."] } }, h), ["Sentence 4."], "text anywhere in the public doc is found");
const hq = splitHeard("LTC", { stimulus: { dialogueText: 'He said "go"\nnow', speakerA: "A", speakerB: "B" } }).heard;
eq(findLeaks({ stimulus: { note: 'He said "go"\nnow' } }, hq), ['He said "go"\nnow'], "quotes and newlines matched as stored");

console.log(`\n${passes} passed, ${failures} failed`);
if (!failures) console.log("HEARD SPLIT PASSED — six heard types split exactly, text-only untouched, LCR stem guarded, leak scan sound.");
process.exit(failures ? 1 : 0);
