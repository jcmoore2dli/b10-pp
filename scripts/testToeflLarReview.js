// ─────────────────────────────────────────────────────────────────────────────
// B10-PP · scripts/testToeflLarReview.js
// Tests functions/toeflLarReview.js — the instructor's review of an LAR
// "uncertain" intelligibility flag (JC 2026-09-18). No network, no emulator:
// Firestore and firebase-functions are faked.
//
//   A. applyReview on a REAL scorer output (scoreListenAndRepeat run on a
//      sustained-low-confidence fixture), so the fields it reads are the ones
//      the scorer actually writes.
//   B. The callable: instructor/admin only, argument checks, transaction,
//      who/when logged, second review refused.
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const fs = require("fs");
const path = require("path");
const Module = require("module");
const fx = require("../test/lar/fixtures");

let passes = 0, failures = 0;
const ok = (c, m) => { if (c) passes++; else { failures++; console.log("  FAIL:", m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)}`);

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
const quiet = { info: () => {}, warn: () => {}, error: () => {} };

class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

// A fake Firestore holding one document, with a transaction that really
// serialises: the update is only visible after the callback resolves.
function fakeFirestore(docs) {
  const updates = [];
  const ref = (id) => ({ id });
  return {
    updates,
    docs,
    collection: () => ({ doc: ref }),
    runTransaction: async (fn) => {
      const pending = [];
      const tx = {
        get: async (r) => ({ exists: r.id in docs, data: () => JSON.parse(JSON.stringify(docs[r.id])) }),
        update: (r, u) => pending.push([r.id, u]),
      };
      const out = await fn(tx);
      for (const [id, u] of pending) { Object.assign(docs[id], u); updates.push([id, u]); }
      return out;
    },
  };
}

(async () => {
  // ── Build a real scored LAR submission ─────────────────────────────────────
  const scoring = loadWith(path.join(FN, "toeflScoring.js"), {
    "firebase-functions/v2/firestore": { onDocumentCreated: () => () => {} },
    "firebase-functions/params": { defineSecret: () => ({ value: () => "STUB" }) },
    "firebase-functions/logger": quiet,
    "firebase-admin": { firestore: () => ({}) },
    "@anthropic-ai/sdk": function () {},
    "firebase-admin/firestore": { FieldValue: { serverTimestamp: () => null } },
    "./lib/toeflLayerABPrompts": { EM_RUBRIC_PROMPT: "", DISC_RUBRIC_PROMPT: "", INT_RUBRIC_PROMPT: "" },
  }, "scoreListenAndRepeat").__test;

  const item = { utterances: fx.TARGETS.map((_, i) => ({ utteranceIndex: i + 1, part: "greeting" })) };
  const heard = { utterances: fx.TARGETS.map((text, i) => ({ utteranceIndex: i + 1, text })) };
  const itemDb = { collection: () => ({ doc: () => ({
    get: async () => ({ exists: true, data: () => item }),
    collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => heard }) }) }),
  }) }) };

  // Utterance 2: words 1-5 of 9 low (broad + sustained) -> capped 5 -> 4.
  // Utterance 6: all low AND a content word dropped -> uncertain but NOT capped
  // (its band is already below 5).
  const bs = fx.boundaries();
  const inWin = (w, n) => w.startMs >= bs[n - 1].responseStartMs && w.endMs <= bs[n - 1].responseEndMs;
  const counters = {};
  let words = fx.perfectWords().map((w) => {
    for (const n of [2, 6]) {
      if (!inWin(w, n)) continue;
      counters[n] = (counters[n] || 0) + 1;
      if (n === 6 || counters[n] <= 5) return { ...w, conf: 0.4 };
    }
    return w;
  });
  words = words.filter((w) => !(inWin(w, 6) && w.w === "demolished"));

  const scored = await scoring.scoreListenAndRepeat(itemDb, {
    submissionId: "S1", itemId: "LAR-T",
    submission: { responseContent: { wordTimings: words, responseBoundaries: bs } },
  });
  const doc = { taskType: "LAR", scoringStatus: "scored", ...JSON.parse(JSON.stringify(scored)) };
  const r = doc.perUtteranceResults;

  console.log("Fixture");
  eq(r.map((x) => x.layerA.score), [5, 4, 5, 5, 5, r[5].layerA.score, 5], "only utterance 2 capped to 4");
  ok(r[1].intelligibility.capped === true && r[1].intelligibility.bandBeforeCap === 5, "u2 capped, bandBeforeCap 5");
  ok(r[5].intelligibility.verdict === "uncertain" && r[5].intelligibility.capped === false && r[5].layerA.score < 5,
    `u6 uncertain but not capped (band ${r[5].layerA.score})`);
  eq(doc.intelligibilityReviewPending, 2, "two flags pending");

  // ── A. applyReview ─────────────────────────────────────────────────────────
  console.log("A. applyReview");
  const review = loadWith(path.join(FN, "toeflLarReview.js"), {
    "firebase-functions/v2/https": { onCall: (h) => h, HttpsError },
    "firebase-functions/logger": quiet,
    "firebase-admin": { firestore: () => ({}) },
    "firebase-admin/firestore": { Timestamp: { now: () => "NOW" } },
  });
  const { applyReview, ReviewRefused } = review;
  const who = { uid: "inst1", email: "inst@example.org", role: "instructor" };
  const refusedWith = (fn) => { try { fn(); return null; } catch (e) { return e instanceof ReviewRefused ? e.code : `other:${e.message}`; } };

  const restored = applyReview(doc, { utteranceIndex: 2, action: "restore", reviewer: who, at: "T1" });
  const u2 = restored.perUtteranceResults[1];
  eq([u2.layerA.score, u2.layerA.rationale], [5, "Repeated exactly and intelligibly."], "restore puts back band and rationale");
  ok(!u2.layerB.flags.includes("INTELLIGIBILITY_UNCERTAIN"), "restore clears the flag");
  eq(u2.intelligibility.review, { action: "restore", bandBefore: 4, bandAfter: 5, by: "inst1", byEmail: "inst@example.org", byRole: "instructor", at: "T1" }, "who/when logged");
  eq(u2.intelligibility.verdict, "uncertain", "the automated verdict itself is kept as a record");
  eq(restored.intelligibilityReviewPending, 1, "pending decremented");
  ok(restored.needsHumanReview === true, "still needs a human while u6 is pending");
  ok(JSON.stringify(restored.perUtteranceResults.filter((_, i) => i !== 1)) === JSON.stringify(r.filter((_, i) => i !== 1)), "other utterances untouched");
  eq(doc.perUtteranceResults[1].layerA.score, 4, "input not mutated");

  const kept = applyReview(doc, { utteranceIndex: 2, action: "keep", reviewer: who, at: "T2" });
  eq([kept.perUtteranceResults[1].layerA.score, kept.perUtteranceResults[1].intelligibility.review.bandAfter], [4, 4], "keep leaves the capped band");
  ok(!kept.perUtteranceResults[1].layerB.flags.includes("INTELLIGIBILITY_UNCERTAIN"), "keep clears the flag");

  const u6r = applyReview(doc, { utteranceIndex: 6, action: "restore", reviewer: who, at: "T3" }).perUtteranceResults[5];
  eq(u6r.layerA, r[5].layerA, "restore on an uncapped utterance changes no band or rationale");

  const both = applyReview({ ...doc, ...restored }, { utteranceIndex: 6, action: "keep", reviewer: who, at: "T4" });
  eq([both.intelligibilityReviewPending, both.needsHumanReview], [0, r.some((x) => x.needsHumanReview)], "all reviewed: pending 0, needsHumanReview back to the comparer's own");

  eq(refusedWith(() => applyReview({ ...doc, ...restored }, { utteranceIndex: 2, action: "keep", reviewer: who, at: "T" })), "already-exists", "second review refused");
  eq(refusedWith(() => applyReview(doc, { utteranceIndex: 1, action: "restore", reviewer: who, at: "T" })), "failed-precondition", "unflagged utterance refused");
  eq(refusedWith(() => applyReview(doc, { utteranceIndex: 9, action: "restore", reviewer: who, at: "T" })), "not-found", "unknown utterance refused");
  eq(refusedWith(() => applyReview(doc, { utteranceIndex: 2, action: "withhold", reviewer: who, at: "T" })), "invalid-argument", "no withhold action exists");
  eq(refusedWith(() => applyReview({ ...doc, taskType: "INT" }, { utteranceIndex: 2, action: "keep", reviewer: who, at: "T" })), "failed-precondition", "non-LAR refused");
  eq(refusedWith(() => applyReview({ ...doc, scoringStatus: "scoring" }, { utteranceIndex: 2, action: "keep", reviewer: who, at: "T" })), "failed-precondition", "unscored refused");

  // ── B. the callable ────────────────────────────────────────────────────────
  console.log("B. callable");
  const store = fakeFirestore({ S1: JSON.parse(JSON.stringify(doc)) });
  const callable = loadWith(path.join(FN, "toeflLarReview.js"), {
    "firebase-functions/v2/https": { onCall: (h) => h, HttpsError },
    "firebase-functions/logger": quiet,
    "firebase-admin": { firestore: () => store },
    "firebase-admin/firestore": { Timestamp: { now: () => "SERVER-NOW" } },
  }).reviewLarIntelligibility;
  const call = async (auth, data) => { try { return await callable({ auth, data }); } catch (e) { return { err: e.code }; } };
  // A TOEFL instructor (T##-INS-#): since 2026-09-19 only TOEFL staff may review.
  const inst = { uid: "inst9", token: { role: "instructor", b10Id: "T26-INS-9", email: "i9@example.org" } };

  eq(await call(null, { submissionId: "S1", utteranceIndex: 2, action: "restore" }), { err: "unauthenticated" }, "signed out refused");
  eq(await call({ uid: "stu", token: { role: "student" } }, { submissionId: "S1", utteranceIndex: 2, action: "restore" }), { err: "permission-denied" }, "student refused");
  eq(await call({ uid: "b10i", token: { role: "instructor", b10Id: "26-INS-200" } }, { submissionId: "S1", utteranceIndex: 2, action: "restore" }), { err: "permission-denied" }, "B10-PP instructor refused (not TOEFL staff)");
  eq(await call(inst, { submissionId: "S1", utteranceIndex: "2", action: "restore" }), { err: "invalid-argument" }, "string utteranceIndex refused");
  eq(await call(inst, { submissionId: "NOPE", utteranceIndex: 2, action: "restore" }), { err: "not-found" }, "missing submission refused");
  eq(store.updates.length, 0, "no writes from refused calls");

  eq(await call(inst, { submissionId: "S1", utteranceIndex: 2, action: "restore" }), { ok: true, bandBefore: 4, bandAfter: 5 }, "instructor restore succeeds");
  const saved = store.docs.S1.perUtteranceResults[1];
  eq([saved.layerA.score, saved.intelligibility.review.by, saved.intelligibility.review.at], [5, "inst9", "SERVER-NOW"], "written: band, reviewer, server time");
  eq(await call(inst, { submissionId: "S1", utteranceIndex: 2, action: "keep" }), { err: "already-exists" }, "second review of same utterance refused");
  eq(await call({ uid: "adm", token: { role: "admin" } }, { submissionId: "S1", utteranceIndex: 6, action: "keep" }), { ok: true, bandBefore: r[5].layerA.score, bandAfter: r[5].layerA.score }, "admin may review");
  eq(store.docs.S1.intelligibilityReviewPending, 0, "pending reaches 0");

  console.log(`\n${passes} passed, ${failures} failed`);
  console.log(failures === 0
    ? "LAR REVIEW PASSED — instructor-only, logged, restore/keep only, never withholds."
    : "LAR REVIEW FAILED");
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("ERROR:", e); process.exit(1); });
