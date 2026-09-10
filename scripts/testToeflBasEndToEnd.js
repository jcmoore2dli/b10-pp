#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// TEST — BAS end-to-end through the real trigger, against REAL imported items.
//
// A genuine test, not a calibration harness: BAS makes no model call, so this
// is deterministic, free and repeatable. Every submission is derived from the
// actual imported answerKey rather than hardcoded, so it exercises whatever
// real corpus content is present.
//
// It deliberately picks TWO real items — one WITH a distractor and one WITHOUT
// — because 45.5% of real BAS items are distractor-free and a suite that only
// ever ran the distractor case would silently never cover the other 15 items.
//
// Requires firestore + functions emulators with BAS imported:
//   firebase emulators:start --only firestore,functions
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/importToeflCorpus.js --type BAS
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/testToeflBasEndToEnd.js
// ─────────────────────────────────────────────────────────────────────────────

const admin = require("firebase-admin");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("\nREFUSING TO RUN: FIRESTORE_EMULATOR_HOST is not set.\n");
  process.exit(1);
}
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "b10-practice-platform" });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`    PASS  ${label}`);
  else { failures++; console.log(`    FAIL  ${label}`); if (detail !== undefined) console.log(`          ${detail}`); }
}

async function waitScored(id, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const d = (await db.collection("toeflSubmissions").doc(id).get()).data();
    if (d && d.scoringStatus !== "queued" && d.scoringStatus !== "scoring") return d;
    await sleep(500);
  }
  return null;
}

async function main() {
  const snap = await db.collection("toeflItems").where("taskType", "==", "BAS").get();
  if (snap.empty) {
    console.error("No BAS items in Firestore. Run the importer first (--type BAS).");
    process.exit(1);
  }

  // Find one item WITH a distractor and one WITHOUT — both are real patterns.
  let withD = null, withoutD = null;
  for (const doc of snap.docs) {
    const d = doc.data();
    const k = (await doc.ref.collection("answerKey").doc("key").get()).data();
    const unused = d.fragments.filter((f) => !k.correctOrder.includes(f.fragmentIndex));
    const rec = { id: doc.id, fragments: d.fragments, order: k.correctOrder, unused };
    if (unused.length && !withD) withD = rec;
    if (!unused.length && !withoutD) withoutD = rec;
    if (withD && withoutD) break;
  }
  check("found a real item WITH a distractor", withD !== null);
  check("found a real item WITHOUT a distractor", withoutD !== null);
  if (!withD || !withoutD) { console.log("\ncannot proceed\n"); process.exit(1); }

  for (const rec of [withD, withoutD]) {
    console.log(`\nusing ${rec.id} — ${rec.fragments.length} chunks, ${rec.unused.length} distractor`);
    console.log("  correctOrder: " + JSON.stringify(rec.order));
    console.log("  → \"" + rec.order.map((i) => rec.fragments.find((f) => f.fragmentIndex === i).text).join(" ") + "\"");
  }

  const CASES = [];
  const mk = (rec, tag, order, expect, label) =>
    CASES.push({ id: `SUB-BAS-E2E-${tag}`, item: rec.id, submittedOrder: order, expect, label });

  mk(withD, "001", withD.order, true, `${withD.id} correct arrangement`);
  // swap the first two positions — a real near-miss
  mk(withD, "002", [withD.order[1], withD.order[0], ...withD.order.slice(2)], false,
     `${withD.id} two positions swapped`);
  // substitute the distractor for the last used fragment
  mk(withD, "003",
     [...withD.order.slice(0, -1), withD.unused[0].fragmentIndex], false,
     `${withD.id} distractor substituted (wrong, not malformed)`);
  mk(withD, "004", [withD.order[0], withD.order[0], ...withD.order.slice(2)], false,
     `${withD.id} duplicate index (integration mismatch)`);
  mk(withD, "005", [], false, `${withD.id} empty arrangement`);
  mk(withoutD, "006", withoutD.order, true, `${withoutD.id} correct, distractor-free item`);
  mk(withoutD, "007", [...withoutD.order].reverse(), false, `${withoutD.id} reversed`);

  for (const c of CASES) {
    const attemptId = c.id.replace("SUB", "ATT");
    await db.collection("toeflAttempts").doc(attemptId).set({
      attemptId, itemId: c.item, taskType: "BAS",
      uid: "FIXTURE_UID_NOT_A_REAL_STUDENT",
      startedAt: FV.serverTimestamp(), completedAt: FV.serverTimestamp(),
    });
  }
  console.log("");
  for (const c of CASES) {
    await db.collection("toeflSubmissions").doc(c.id).set({
      submissionId: c.id, attemptId: c.id.replace("SUB", "ATT"),
      taskType: "BAS", uid: "FIXTURE_UID_NOT_A_REAL_STUDENT",
      responseContent: { submittedOrder: c.submittedOrder },
      scoringStatus: "queued", submittedAt: FV.serverTimestamp(),
    });
    console.log(`  seeded ${c.id} — ${c.label}`);
  }

  console.log("\nwaiting for the trigger...\n");
  for (const c of CASES) {
    const d = await waitScored(c.id);
    console.log(`  ── ${c.id} — ${c.label} ──`);
    if (!d) { check("scored within timeout", false, "timed out"); continue; }
    check("scoringStatus is scored", d.scoringStatus === "scored", d.scoringStatus);
    check("claimed via the idempotency transaction", d.scoringStartedAt !== undefined);
    if (d.scoringStatus !== "scored") continue;
    check(`orderCorrect === ${c.expect}`, d.orderCorrect === c.expect, `got ${d.orderCorrect}`);
    check("correctOrder copied back", Array.isArray(d.correctOrder) && d.correctOrder.length > 0,
      JSON.stringify(d.correctOrder));
    check("no aggregate score / no layerA written",
      !("score" in d) && !("layerA" in d) && !("perGapResults" in d), Object.keys(d).join(","));
  }

  console.log("\n  ── answer-key containment ──");
  const pub = (await db.collection("toeflItems").doc(withD.id).get()).data();
  check("public item exposes fragments but never correctOrder",
    Array.isArray(pub.fragments) && !("correctOrder" in pub), Object.keys(pub).join(","));
  check("public fragments carry no used/unused marker",
    pub.fragments.every((f) => Object.keys(f).sort().join(",") === "fragmentIndex,text"),
    JSON.stringify(pub.fragments[0]));

  console.log(
    failures === 0
      ? "\nBAS END-TO-END PASSED — real items, real trigger, distractor and distractor-free both covered.\n"
      : `\nBAS END-TO-END FAILED — ${failures} check(s) failed.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("\nERRORED:", e); process.exit(1); });
