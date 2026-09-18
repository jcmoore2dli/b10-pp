#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// B10-PP · scripts/testToeflTranscription.js
// Tests TOEFL transcription (functions/lib/toeflTranscription.js), the
// deepgramSTT allowEmpty option, and the wiring in onToeflSubmissionCreated.
// No network: Deepgram, Storage, Firestore and Anthropic are all faked.
//
//   A. deepgramSTT: allowEmpty is off by default (B10-PP unchanged); on, a
//      silent clip returns an empty result; request options unchanged.
//   B. transcribeInterview: statuses, transcript shape, delivery evidence,
//      retries, partial failure, client-written values overwritten.
//   C. THE CONTRACT: what B writes is fed to the scorer's real
//      buildInterviewInput, which must accept it and render real transcripts
//      and delivery evidence, not the "NOT AVAILABLE" fallback.
//   D. transcribeListenAndRepeat: B10-PP Stage 00 on toeflSubmissions, then
//      the real scoreListenAndRepeat must report ONLY intelligibility missing.
//   E. The trigger: claim, then transcribe, then score. On a Deepgram failure
//      the submission ends "error" and Anthropic is never called.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");
const Module = require("module");

let passes = 0, failures = 0;
const ok = (c, m) => { if (c) passes++; else { failures++; console.log("  FAIL:", m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)}`);
const section = (t) => console.log(t);

// ── Load a module with some of its requires replaced ─────────────────────────
function loadWith(file, stubs, expose = "") {
  const src = fs.readFileSync(file, "utf8");
  const wrapper = Module.wrap(src + (expose ? `\n;module.exports.__test = { ${expose} };` : ""));
  const mod = { exports: {} };
  const localRequire = (id) => {
    if (id in stubs) return stubs[id];
    if (id.startsWith(".")) return require(path.resolve(path.dirname(file), id));
    return require(require.resolve(id, { paths: [path.dirname(file)] }));
  };
  eval(wrapper).call(mod.exports, mod.exports, localRequire, mod, file, path.dirname(file));
  return mod.exports;
}

const FN = path.join(__dirname, "..", "functions");
const T = require(path.join(FN, "lib", "toeflTranscription.js"));
const quietLogger = { info() {}, warn() {}, error() {} };

// ── Fakes ────────────────────────────────────────────────────────────────────
function setPath(obj, dotted, value) {
  const keys = dotted.split("."); let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] = o[k] ?? {};
  o[keys[keys.length - 1]] = value;
}
function fakeDb(initial) {
  const data = JSON.parse(JSON.stringify(initial));   // { "col/id": {...} }
  const writes = [];
  const ref = (col, id) => ({
    path: `${col}/${id}`,
    async get() { const d = data[`${col}/${id}`]; return { exists: !!d, data: () => d && JSON.parse(JSON.stringify(d)) }; },
    async update(u) { writes.push({ path: `${col}/${id}`, u }); const d = data[`${col}/${id}`]; for (const [k, v] of Object.entries(u)) setPath(d, k, v); },
  });
  return {
    data, writes,
    collection: (col) => ({ doc: (id) => ref(col, id) }),
    async runTransaction(fn) { return fn({ get: (r) => r.get(), update: (r, u) => r.update(u) }); },
  };
}
function fakeBucket(files) {
  return { file: (p) => ({ async download() { if (!(p in files)) throw new Error(`no such object ${p}`); return [Buffer.from(files[p])]; } }) };
}
// A Deepgram-shaped word: seconds, confidence, speaker.
const W = (word, start, end, confidence = 0.95, speaker = 0) => ({ word, punctuated_word: word, start, end, confidence, speaker });

// ═════════════════════════════════════════════════════════════════════════════
section("A. deepgramSTT allowEmpty");
(async () => {
  let lastOptions = null, respond = null;
  const sdk = { createClient: () => ({ listen: { prerecorded: { transcribeFile: async (buf, opts) => { lastOptions = opts; return respond(); } } } }) };
  const dg = loadWith(path.join(FN, "lib", "deepgramSTT.js"), { "@deepgram/sdk": sdk });
  const reply = (words) => () => ({ result: { results: { channels: [{ alternatives: [{ words }] }] } }, error: null });

  respond = reply([]);
  let threw = null; try { await dg.transcribeAudio("k", Buffer.from("x"), "audio/webm"); } catch (e) { threw = e.message; }
  eq(threw, "Deepgram returned empty transcript", "default: empty still throws (B10-PP unchanged)");
  eq(await dg.transcribeAudio("k", Buffer.from("x"), "audio/webm", { allowEmpty: true }), { transcript: "", words: [], allWords: [] }, "allowEmpty: empty result");
  respond = reply([W("hello", 0.1, 0.4), W("there", 0.5, 0.8)]);
  eq((await dg.transcribeAudio("k", Buffer.from("x"), "audio/mp4", { allowEmpty: true })).transcript, "hello there", "speech unaffected by allowEmpty");
  eq([lastOptions.model, lastOptions.smart_format, lastOptions.filler_words, lastOptions.diarize, lastOptions.words, lastOptions.mimetype],
     ["nova-2", false, true, true, true, "audio/mp4"], "Pass 1 request options unchanged");

  // ═══════════════════════════════════════════════════════════════════════════
  section("B. transcribeInterview");
  const CLIPS = [0, 1, 2, 3].map((i) => ({ questionIndex: i, storagePath: `audio/B10-7/toefl_att1/q${i + 1}.${i === 1 ? "mp4" : "webm"}`, durationSeconds: 20 + i, transcriptStatus: "pending" }));
  const baseData = () => ({
    "toeflAttempts/att1": { itemId: "INT-001", interviewClips: CLIPS },
    "toeflSubmissions/sub1": { attemptId: "att1", taskType: "INT", responseContent: { transcripts: [{ questionIndex: 0, transcript: "CLIENT FORGED" }], audioClips: [] } },
  });
  const files = Object.fromEntries(CLIPS.map((c) => [c.storagePath, `clip-${c.questionIndex}`]));   // content names the clip
  // Q1 speaks with a 2.0 s pause and a filler; Q2 (index 1) is silent.
  const SPEECH = {
    0: [W("I", 0.5, 0.7), W("usually", 0.8, 1.2), W("uh", 1.3, 1.5, 0.5), W("study", 3.5, 3.9, 0.4), W("alone", 4.0, 4.5)],
    1: [],
    2: [W("Maybe", 1.0, 1.4), W("with", 1.5, 1.7), W("friends", 1.8, 2.3)],
    3: [W("Yes", 0.4, 0.8)],
  };
  const calls = [];
  const transcribeOK = async (key, buf, mime, opts) => {
    calls.push({ key, mime, opts });
    const words = SPEECH[Number(buf.toString().split("-")[1])];   // keyed by file content, not call order
    return { transcript: words.map((w) => w.punctuated_word).join(" "), words, allWords: words };
  };
  let db = fakeDb(baseData());
  const sref = db.collection("toeflSubmissions").doc("sub1");
  const out = await T.transcribeInterview({
    db, bucket: fakeBucket(files), submissionRef: sref, submission: db.data["toeflSubmissions/sub1"],
    apiKey: "DG", transcribe: transcribeOK, sleep: async () => {}, logger: quietLogger, serverTimestamp: () => "TS",
  });
  eq(calls.map((c) => [c.key, c.opts.allowEmpty]), [["DG", true], ["DG", true], ["DG", true], ["DG", true]], "4 calls, same key, allowEmpty on");
  eq(calls.map((c) => c.mime).sort(), ["audio/mp4", "audio/webm", "audio/webm", "audio/webm"], "mime from file extension");
  eq(db.data["toeflAttempts/att1"].interviewClips.map((c) => c.transcriptStatus), ["complete", "complete", "complete", "complete"], "attempt: all complete");
  const tr = db.data["toeflSubmissions/sub1"].responseContent.transcripts;
  eq(tr.map((t) => t.questionIndex), [0, 1, 2, 3], "transcripts 0-based, ordered");
  eq(tr[0].transcript, "I usually uh study alone", "raw transcript, filler kept, unmodified");
  ok(!tr.some((t) => t.transcript === "CLIENT FORGED"), "client-forged transcript overwritten");
  eq(tr[1], { questionIndex: 1, transcript: "", deliveryEvidence: null, sttMeta: { provider: "deepgram", model: "nova-2", meanConf: null, minConf: null, wordCount: 0 } }, "silent answer: empty transcript, no evidence, still complete");
  const ev = tr[0].deliveryEvidence;
  eq([ev.longPauseCount, ev.longPauseTimestamps, ev.severePauseCount, ev.filledPauseCount, ev.durationSeconds],
     [1, "1.5s", 0, 1, 20], "evidence: 2.0 s pause counted at 1.5 s tier only, 1 filler, clip duration");
  eq(ev.wordsPerMinute, Math.round((5 / 4.0) * 60), "wpm over the 4.0 s speech span (75)");
  eq(ev.wordConfidencePattern, "mean 0.75; one low-confidence stretch (1-4s)", "confidence pattern");
  eq(Object.keys(ev).sort(), ["durationSeconds", "filledPauseCount", "longPauseCount", "longPauseTimestamps", "meanGapSeconds", "severePauseCount", "severePauseTimestamps", "wordConfidencePattern", "wordsPerMinute"], "evidence keys = fixture/renderer shape");
  eq(out.responseContent.transcripts, tr, "returned submission carries the transcripts");
  eq(db.writes.map((w) => w.path), ["toeflAttempts/att1", "toeflSubmissions/sub1"], "attempt written before submission");

  // Retry: first attempt fails, second succeeds; sleep called with 2000.
  let failOnce = true; const slept = [];
  db = fakeDb(baseData());
  await T.transcribeInterview({
    db, bucket: fakeBucket(files), submissionRef: db.collection("toeflSubmissions").doc("sub1"), submission: db.data["toeflSubmissions/sub1"],
    apiKey: "DG", sleep: async (ms) => slept.push(ms), logger: quietLogger, serverTimestamp: () => "TS",
    transcribe: async (k, b, mime) => { if (failOnce && mime === "audio/mp4") { failOnce = false; throw new Error("503"); } return { transcript: "ok", words: [W("ok", 0, 0.3)], allWords: [] }; },
  });
  eq(slept, [2000], "one retry after 2 s (index.js schedule)");

  // Permanent failure on Q3: that clip 'error', others complete, both written, throws.
  db = fakeDb(baseData()); slept.length = 0;
  let err = null;
  try {
    await T.transcribeInterview({
      db, bucket: fakeBucket(files), submissionRef: db.collection("toeflSubmissions").doc("sub1"), submission: db.data["toeflSubmissions/sub1"],
      apiKey: "DG", sleep: async (ms) => slept.push(ms), logger: quietLogger, serverTimestamp: () => "TS",
      transcribe: async () => { throw new Error("boom"); },
    });
  } catch (e) { err = e.message; }
  ok(err && /question\(s\) 0, 1, 2, 3/.test(err), `all-fail throws naming questions: ${err}`);
  eq([...slept].sort(), [2000, 2000, 2000, 2000, 4000, 4000, 4000, 4000], "3 attempts per clip (clips run in parallel, so delays interleave)");
  db = fakeDb(baseData()); err = null;
  const files2 = { ...files }; delete files2[CLIPS[2].storagePath];
  try {
    await T.transcribeInterview({
      db, bucket: fakeBucket(files2), submissionRef: db.collection("toeflSubmissions").doc("sub1"), submission: db.data["toeflSubmissions/sub1"],
      apiKey: "DG", sleep: async () => {}, logger: quietLogger, serverTimestamp: () => "TS",
      transcribe: async () => ({ transcript: "fine", words: [W("fine", 0, 0.4)], allWords: [] }),
    });
  } catch (e) { err = e.message; }
  ok(err && /question\(s\) 2 /.test(err), `Q3 audio missing -> throws naming question 2: ${err}`);
  eq(db.data["toeflAttempts/att1"].interviewClips.map((c) => c.transcriptStatus), ["complete", "complete", "error", "complete"], "only the failed clip is 'error'");
  eq(db.data["toeflSubmissions/sub1"].responseContent.transcripts.map((t) => t.questionIndex), [0, 1, 3], "successful transcripts still written");

  // No-recording clip (storagePath null): no Deepgram call, no entry, status untouched.
  db = fakeDb({ ...baseData(), "toeflAttempts/att1": { itemId: "INT-001", interviewClips: CLIPS.map((c, i) => i === 3 ? { questionIndex: 3, storagePath: null, durationSeconds: 0, transcriptStatus: "none" } : c) } });
  calls.length = 0;
  await T.transcribeInterview({
    db, bucket: fakeBucket(files), submissionRef: db.collection("toeflSubmissions").doc("sub1"), submission: db.data["toeflSubmissions/sub1"],
    apiKey: "DG", sleep: async () => {}, logger: quietLogger, serverTimestamp: () => "TS",
    transcribe: async (k, b, mime) => { calls.push(mime); return { transcript: "x", words: [W("x", 0, 0.2)], allWords: [] }; },
  });
  eq(calls.length, 3, "no Deepgram call for a question with no recording");
  eq(db.data["toeflAttempts/att1"].interviewClips[3].transcriptStatus, "none", "its status untouched");

  // ═══════════════════════════════════════════════════════════════════════════
  section("C. contract: the scorer's real buildInterviewInput accepts the output");
  const scoringStubs = {
    "firebase-functions/v2/firestore": { onDocumentCreated: () => () => {} },
    "firebase-functions/params": { defineSecret: () => ({ value: () => "STUB" }) },
    "firebase-functions/logger": quietLogger,
    "firebase-admin": { firestore: () => ({}) },
    "@anthropic-ai/sdk": function () {},
    "firebase-admin/firestore": { FieldValue: { serverTimestamp: () => null } },
    "./lib/toeflLayerABPrompts": { EM_RUBRIC_PROMPT: "", DISC_RUBRIC_PROMPT: "", INT_RUBRIC_PROMPT: "" },
  };
  const S = loadWith(path.join(FN, "toeflScoring.js"), scoringStubs, "buildInterviewInput, scoreListenAndRepeat").__test;
  const item = {
    stimulus: { contextSentence: "You are taking part in a study about learning habits." },
    prompt: { questions: [1, 2, 3, 4].map((n) => ({ questionIndex: n, stem: `Stem ${n}?`, questionType: ["Personal Experience", "Preference", "Opinion", "Hypothetical"][n - 1] })) },
  };
  db = fakeDb(baseData()); calls.length = 0;
  const produced = await T.transcribeInterview({
    db, bucket: fakeBucket(files), submissionRef: db.collection("toeflSubmissions").doc("sub1"), submission: db.data["toeflSubmissions/sub1"],
    apiKey: "DG", transcribe: transcribeOK, sleep: async () => {}, logger: quietLogger, serverTimestamp: () => "TS",
  });
  let input = null, cErr = null;
  try {
    input = S.buildInterviewInput({ itemId: "INT-001", submission: produced, item, attempt: db.data["toeflAttempts/att1"], ctx: { submissionId: "sub1", taskType: "INT", itemId: "INT-001" } });
  } catch (e) { cErr = e.message; }
  ok(cErr === null, `buildInterviewInput accepted the transcription output (${cErr})`);
  const text = typeof input === "string" ? input : JSON.stringify(input);
  ok(text.includes("TRANSCRIPT: I usually uh study alone"), "Q1 transcript rendered verbatim");
  ok((text.match(/DELIVERY EVIDENCE:\n/g) || []).length === 3, "real delivery evidence for the 3 spoken answers");
  ok((text.match(/NOT AVAILABLE/g) || []).length === 1, "only the silent answer falls back to NOT AVAILABLE");
  ok(!text.includes("[NO RECORDING]"), "a silent recording is not mistaken for no recording");
  // And the failure path: an 'error' status makes the scorer refuse, as designed.
  const errAttempt = JSON.parse(JSON.stringify(db.data["toeflAttempts/att1"])); errAttempt.interviewClips[2].transcriptStatus = "error";
  let refused = null;
  try { S.buildInterviewInput({ itemId: "INT-001", submission: produced, item, attempt: errAttempt, ctx: {} }); } catch (e) { refused = e.message; }
  ok(refused && /transcription failure on Q3/.test(refused), "scorer refuses when a clip is 'error'");

  // ═══════════════════════════════════════════════════════════════════════════
  section("D. transcribeListenAndRepeat (Stage 00) and the LAR scorer's inputs");
  const larWords = [W("Welcome", 0.5, 1.0, 0.9, 1), W("to", 1.05, 1.2, 0.9, 1), W("the", 1.2, 1.35, 0.9, 0), W("library.", 1.4, 2.0123, 0.9, 0)];
  db = fakeDb({ "toeflSubmissions/lar1": { attemptId: "attL", taskType: "LAR", responseContent: {
    audioClip: { storagePath: "audio/B10-7/toefl_attL/lar.webm", durationSeconds: 30 },
    responseBoundaries: [1, 2, 3, 4, 5, 6, 7].map((i) => ({ utteranceIndex: i, responseStartMs: (i - 1) * 4000, responseEndMs: i * 4000 })),
    wordTimings: [{ w: "forged", startMs: 0, endMs: 1 }],
  } } });
  const larOut = await T.transcribeListenAndRepeat({
    bucket: fakeBucket({ "audio/B10-7/toefl_attL/lar.webm": "a" }), submissionRef: db.collection("toeflSubmissions").doc("lar1"),
    submission: db.data["toeflSubmissions/lar1"], apiKey: "DG", sleep: async () => {}, logger: quietLogger, serverTimestamp: () => "TS",
    transcribe: async () => ({ transcript: "the library.", words: larWords.slice(2), allWords: larWords }),
  });
  const lrc = db.data["toeflSubmissions/lar1"].responseContent;
  eq(lrc.wordTimings.map((w) => w.w), ["Welcome", "to", "the", "library."], "UNFILTERED allWords used, both speakers kept");
  eq(lrc.wordTimings[3], { w: "library.", startMs: 1400, endMs: 2012, conf: 0.9 }, "seconds -> integer ms, once");
  eq([lrc.sttMeta.provider, lrc.sttMeta.wordCount, lrc.sttMeta.capturedAt], ["deepgram", 4, "TS"], "sttMeta");
  eq(lrc.responseBoundaries.length, 7, "client responseBoundaries untouched");
  eq(larOut.responseContent.wordTimings.length, 4, "returned submission carries wordTimings");
  const larItem = { utterances: [1, 2, 3, 4, 5, 6, 7].map((i) => ({ utteranceIndex: i, text: `Sentence ${i}.`, part: "greeting" })) };
  const larDb = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => larItem }) }) }) };
  let larErr = null;
  try { await S.scoreListenAndRepeat(larDb, { submissionId: "lar1", submission: larOut, itemId: "LAR-001" }); } catch (e) { larErr = e.message; }
  ok(larErr && /missing intelligibility \(/.test(larErr), `LAR scorer now missing ONLY intelligibility: ${larErr}`);

  // ═══════════════════════════════════════════════════════════════════════════
  section("E. trigger: claim -> transcribe -> score; failure never reaches Anthropic");
  let handler = null, triggerOpts = null; const anthropicCalls = [];
  class FakeAnthropic { constructor() { this.messages = { create: async (req) => { anthropicCalls.push(req); throw new Error("stop after prompt capture"); } }; } }
  const makeTrigger = (db, bucket, transcribe) => {
    const stubs = {
      ...scoringStubs,
      "firebase-functions/v2/firestore": { onDocumentCreated: (opts, h) => { triggerOpts = opts; handler = h; return h; } },
      "firebase-functions/params": { defineSecret: (name) => ({ name, value: () => `${name}-VALUE` }) },
      "firebase-admin": { firestore: () => db, storage: () => ({ bucket: () => bucket }) },
      "@anthropic-ai/sdk": FakeAnthropic,
      "firebase-admin/firestore": { FieldValue: { serverTimestamp: () => "TS" } },
      "./lib/toeflTranscription": { TRANSCRIBERS: {
        INT: (args) => T.transcribeInterview({ ...args, transcribe, sleep: async () => {} }),
        LAR: (args) => T.transcribeListenAndRepeat({ ...args, transcribe, sleep: async () => {} }),
      } },
    };
    loadWith(path.join(FN, "toeflScoring.js"), stubs);
  };
  const trigData = () => ({ ...baseData(), "toeflItems/INT-001": item, "toeflSubmissions/sub1": { ...baseData()["toeflSubmissions/sub1"], scoringStatus: "queued" } });

  db = fakeDb(trigData()); calls.length = 0; anthropicCalls.length = 0;
  const seenKeys = [];
  makeTrigger(db, fakeBucket(files), async (key, ...rest) => { seenKeys.push(key); return transcribeOK(key, ...rest); });
  eq(triggerOpts.secrets.map((s) => s.name).sort(), ["ANTHROPIC_API_KEY", "DEEPGRAM_API_KEY"], "trigger mounts both secrets");
  await handler({ params: { submissionId: "sub1" }, data: { data: () => db.data["toeflSubmissions/sub1"] } });
  ok(seenKeys.length === 4 && seenKeys.every((k) => k === "DEEPGRAM_API_KEY-VALUE"), "Deepgram called 4x with the DEEPGRAM_API_KEY secret");
  ok(anthropicCalls.length === 1, "Anthropic called once, after transcription");
  const sent = JSON.stringify(anthropicCalls[0] || {});
  ok(sent.includes("I usually uh study alone") && sent.includes("DELIVERY EVIDENCE:"), "model prompt carries the transcripts and evidence");
  eq(db.data["toeflSubmissions/sub1"].scoringStatus, "error", "(fake model threw -> error; real model would score)");

  db = fakeDb(trigData()); anthropicCalls.length = 0;
  makeTrigger(db, fakeBucket({}), async () => { throw new Error("unreachable"); });
  await handler({ params: { submissionId: "sub1" }, data: { data: () => db.data["toeflSubmissions/sub1"] } });
  eq(anthropicCalls.length, 0, "Deepgram/Storage failure: Anthropic never called");
  eq(db.data["toeflSubmissions/sub1"].scoringStatus, "error", "submission marked error");
  eq(db.data["toeflAttempts/att1"].interviewClips.map((c) => c.transcriptStatus), ["error", "error", "error", "error"], "clip statuses record the failure");

  db = fakeDb({ ...trigData(), "toeflSubmissions/sub1": { ...trigData()["toeflSubmissions/sub1"], scoringStatus: "scored" } });
  let dgCalls = 0;
  makeTrigger(db, fakeBucket(files), async (...a) => { dgCalls++; return transcribeOK(...a); });
  await handler({ params: { submissionId: "sub1" }, data: { data: () => db.data["toeflSubmissions/sub1"] } });
  eq(dgCalls, 0, "redelivery of a scored submission: no second Deepgram call (claim)");

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures === 0) console.log("TOEFL TRANSCRIPTION PASSED — Pass 1 reused, scorer contract met, failures never reach the model.");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
