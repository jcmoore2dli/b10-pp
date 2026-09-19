// functions/toeflLarReview.js
// CALLABLE: reviewLarIntelligibility. The instructor's side of the LAR
// intelligibility gate (JC 2026-09-18).
//
// The automated producer can only say "uncertain": the utterance is capped at
// band 4 and flagged for an instructor to listen to. This is how that flag gets
// resolved, by any signed-in instructor (or admin), with who and when logged:
//
//   action "restore": the instructor listened and the speech was fine. The
//                     band and rationale the utterance earned without the cap
//                     are put back (stored at scoring time as bandBeforeCap /
//                     rationaleBeforeCap, so nothing is re-derived here).
//   action "keep":    the instructor listened and the cap stands. Flag cleared,
//                     band unchanged.
//
// Neither action can withhold a response or lower a band below the cap.
// Withholding ("unintelligible") stays with the human in live-class Layer 3,
// and nothing automated or callable reaches it.
//
// Admin SDK write: clients cannot update toeflSubmissions at all (the rule is
// `allow update: if false`), so this is the only path to these fields.

"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { Timestamp } = require("firebase-admin/firestore");

const FLAG = "INTELLIGIBILITY_UNCERTAIN";
const ACTIONS = new Set(["restore", "keep"]);
// Reviewers are TOEFL staff only (admins and T##-INS-# instructors), not every
// "instructor" role: B10-PP instructors are not TOEFL staff (2026-09-19).
const { isToeflStaffToken } = require("./lib/toeflStaff");

class ReviewRefused extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Pure: the submission fields a review changes, or a ReviewRefused.
 * `at` is passed in because a server timestamp sentinel is not allowed inside
 * an array element, and perUtteranceResults is an array.
 */
function applyReview(data, { utteranceIndex, action, reviewer, at }) {
  if (!ACTIONS.has(action)) {
    throw new ReviewRefused("invalid-argument", `action must be "restore" or "keep"`);
  }
  if (!data || data.taskType !== "LAR") {
    throw new ReviewRefused("failed-precondition", "not a LAR submission");
  }
  if (data.scoringStatus !== "scored" || !Array.isArray(data.perUtteranceResults)) {
    throw new ReviewRefused("failed-precondition", "submission is not scored");
  }

  const rows = data.perUtteranceResults;
  const i = rows.findIndex((r) => r && r.utteranceIndex === utteranceIndex);
  if (i === -1) {
    throw new ReviewRefused("not-found", `no utterance ${utteranceIndex}`);
  }
  const row = rows[i];
  const intel = row.intelligibility;
  if (!intel || intel.verdict !== "uncertain") {
    throw new ReviewRefused("failed-precondition", `utterance ${utteranceIndex} is not flagged`);
  }
  if (intel.review) {
    throw new ReviewRefused(
      "already-exists",
      `utterance ${utteranceIndex} was already reviewed (${intel.review.action})`
    );
  }

  const bandBefore = row.layerA.score;
  const restoring = action === "restore" && intel.capped === true;
  const layerA = restoring
    ? { score: intel.bandBeforeCap, rationale: intel.rationaleBeforeCap }
    : row.layerA;

  const updatedRow = {
    ...row,
    layerA,
    layerB: { ...row.layerB, flags: (row.layerB.flags || []).filter((f) => f !== FLAG) },
    intelligibility: {
      ...intel,
      review: {
        action,
        bandBefore,
        bandAfter: layerA.score,
        by: reviewer.uid,
        byEmail: reviewer.email || null,
        byRole: reviewer.role,
        at,
      },
    },
  };
  const updatedRows = rows.map((r, j) => (j === i ? updatedRow : r));

  const pending = updatedRows.filter(
    (r) => r.intelligibility && r.intelligibility.verdict === "uncertain" && !r.intelligibility.review
  ).length;

  return {
    perUtteranceResults: updatedRows,
    intelligibilityReviewPending: pending,
    needsHumanReview: pending > 0 || updatedRows.some((r) => r.needsHumanReview),
  };
}

exports.reviewLarIntelligibility = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Must be signed in.");
  if (!isToeflStaffToken(request.auth?.token)) {
    throw new HttpsError("permission-denied", "TOEFL instructor or admin role required.");
  }
  const role = request.auth.token.role;

  const { submissionId, utteranceIndex, action } = request.data || {};
  if (!submissionId || typeof submissionId !== "string") {
    throw new HttpsError("invalid-argument", "submissionId required.");
  }
  if (!Number.isInteger(utteranceIndex)) {
    throw new HttpsError("invalid-argument", "utteranceIndex must be an integer.");
  }

  const ref = admin.firestore().collection("toeflSubmissions").doc(submissionId);
  const reviewer = { uid, email: request.auth.token.email, role };

  // Transaction: two instructors reviewing the same utterance at once must not
  // both succeed, and the second must see the first's review.
  try {
    const result = await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new ReviewRefused("not-found", `submission ${submissionId} not found`);
      const update = applyReview(snap.data(), { utteranceIndex, action, reviewer, at: Timestamp.now() });
      tx.update(ref, update);
      const row = update.perUtteranceResults.find((r) => r.utteranceIndex === utteranceIndex);
      return row.intelligibility.review;
    });
    logger.info("reviewLarIntelligibility", {
      submissionId, utteranceIndex, action, by: uid, role,
      bandBefore: result.bandBefore, bandAfter: result.bandAfter,
    });
    return { ok: true, bandBefore: result.bandBefore, bandAfter: result.bandAfter };
  } catch (err) {
    if (err instanceof ReviewRefused) throw new HttpsError(err.code, err.message);
    throw err;
  }
});

exports.applyReview = applyReview;
exports.ReviewRefused = ReviewRefused;
