// functions/lib/lar/normalize.js
// Stage 03 — Normalize both sides identically. Pure function.
//
// One ordered, auditable pipeline applied to target and hypothesis alike.
// Every step is recorded so any deviation can be traced back to the raw token.
//
//   lowercase
//   -> strip punctuation (except intra-word apostrophe)
//   -> expand contractions           // spec rule (provisional here)
//   -> normalize numerals            // spec rule (provisional here)
//   -> HYPHENATION                   // Decision 1 - split on both sides
//   -> SELF-CORRECTION COLLAPSE      // Decision 6 - hypothesis side ONLY
//   -> collapse whitespace
//   -> tokenize
//
// Tokens carry their timings through the whole pipeline, because Decision 6
// needs word timings to detect a restart. Target tokens have null timings and
// therefore never reach the self-correction step — which is also why that step
// is structurally incapable of touching the target side.

"use strict";

const {
  CONTRACTIONS,
  NUMERALS,
  HYPHEN_SPLIT,
  FUNCTION_WORDS,
  SELF_CORRECTION_MAX_GAP_MS,
  SELF_CORRECTION_MAX_SEQ,
  SELF_CORRECTION_MIN_PREFIX,
  SELF_CORRECTION_MAX_ABORTED_RUN,
} = require("./config");

const CURLY_APOSTROPHES = /[‘’]/g;

/** A token, with provenance back to the raw word it came from. */
function mkToken(text, src) {
  return {
    text,
    startMs: src.startMs ?? null,
    endMs: src.endMs ?? null,
    conf: src.conf ?? null,
    origText: src.origText ?? src.w ?? text,
    srcIndex: src.srcIndex ?? null,
  };
}

/** Split one token's time span across n pieces, proportional to length. */
function splitSpan(token, pieces) {
  const { startMs, endMs } = token;
  if (startMs === null || endMs === null) {
    return pieces.map((p) => ({ ...token, text: p }));
  }
  const totalChars = pieces.reduce((a, p) => a + Math.max(p.length, 1), 0);
  const span = endMs - startMs;
  let cursor = startMs;
  return pieces.map((p, i) => {
    const share = Math.round((span * Math.max(p.length, 1)) / totalChars);
    const s = cursor;
    const e = i === pieces.length - 1 ? endMs : Math.min(endMs, s + share);
    cursor = e;
    return { ...token, text: p, startMs: s, endMs: e };
  });
}

// -- Step 1: lowercase ------------------------------------------------------
function stepLowercase(tokens) {
  return tokens.map((t) => ({ ...t, text: t.text.toLowerCase() }));
}

// -- Step 2: strip punctuation, keeping intra-word apostrophes --------------
// The hyphen is deliberately preserved here so Stage 03's hyphenation step
// still has something to split on.
// A non-word character SEPARATES rather than disappears: "does not—really"
// must become three tokens, not "notreally". The only character deleted
// outright is an apostrophe that is not intra-word (a quote mark).
function stripPunct(raw) {
  const s = raw.replace(CURLY_APOSTROPHES, "'");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'") {
      const before = s[i - 1] || "";
      const after = s[i + 1] || "";
      if (/\w/.test(before) && /\w/.test(after)) out += ch;
      continue; // stray quote: delete, do not separate
    }
    out += /[\w-]/.test(ch) ? ch : " ";
  }
  return out;
}

function stepStripPunctuation(tokens) {
  const out = [];
  for (const t of tokens) {
    const pieces = stripPunct(t.text).split(" ").filter((p) => p !== "");
    if (pieces.length === 0) continue;
    if (pieces.length === 1) {
      out.push({ ...t, text: pieces[0] });
      continue;
    }
    out.push(...splitSpan(t, pieces));
  }
  return out;
}

// -- Step 3: expand contractions --------------------------------------------
function stepExpandContractions(tokens) {
  const out = [];
  for (const t of tokens) {
    const expansion = CONTRACTIONS.map[t.text];
    if (expansion) {
      out.push(...splitSpan(t, expansion.split(" ")));
    } else {
      out.push(t);
    }
  }
  return out;
}

// -- Step 4: normalize numerals ---------------------------------------------
function stepNormalizeNumerals(tokens) {
  return tokens.map((t) => {
    const mapped = NUMERALS.map[t.text];
    return mapped ? { ...t, text: mapped } : t;
  });
}

// -- Step 5: hyphenation (Decision 1, CONFIRMED) ----------------------------
// Split on hyphen on BOTH sides, so `well-known` becomes two tokens
// everywhere. A student saying "well known" and one saying "well-known" are
// phonetically identical and must not band differently.
function stepHyphenation(tokens) {
  if (!HYPHEN_SPLIT) return tokens;
  const out = [];
  for (const t of tokens) {
    if (!t.text.includes("-")) {
      out.push(t);
      continue;
    }
    const pieces = t.text.split("-").filter((p) => p !== "");
    if (pieces.length === 0) continue; // token was only hyphens
    if (pieces.length === 1) {
      out.push({ ...t, text: pieces[0] });
      continue;
    }
    out.push(...splitSpan(t, pieces));
  }
  return out;
}

// -- Step 6: self-correction collapse (Decision 6, CONFIRMED) ---------------
// HYPOTHESIS SIDE ONLY. A student repairing their own speech mid-utterance
// ("the- the man walked to the store") is demonstrating self-monitoring, not
// a content error. Collapsing here, before alignment ever sees it, stops
// Stage 04's function-word pass from scoring the repeated "the" as a genuine
// insertion.
//
// Collapses only a token repeating ITSELF in place. It does not touch genuine
// substitutions or unrelated insertions.
function isRestartOf(first, second) {
  if (first.text === second.text) return true;
  // Truncated false start: "wal-" -> "walked". After hyphen stripping the
  // fragment is a bare prefix.
  if (
    first.text.length >= SELF_CORRECTION_MIN_PREFIX &&
    first.text.length < second.text.length &&
    second.text.startsWith(first.text)
  ) {
    return true;
  }
  return false;
}

function gapMs(a, b) {
  if (a.endMs === null || b.startMs === null) return null;
  return b.startMs - a.endMs;
}

// Guard against mistaking GENUINE repetition in the reference for a repair:
// a target reading "very very good" must not have its second "very" collapsed
// away, which would score a false omission. Only suppress the collapse when
// the target repeats the same unit ADJACENTLY — a word merely occurring twice
// elsewhere in the sentence ("the man walked to the store") must still allow
// a real "the- the" repair to collapse.
function targetHasAdjacentRepetition(targetTexts, seq) {
  if (!targetTexts || targetTexts.length < seq.length * 2) return false;
  const n = seq.length;
  for (let i = 0; i + 2 * n <= targetTexts.length; i++) {
    let ok = true;
    for (let k = 0; k < n; k++) {
      if (targetTexts[i + k] !== seq[k] || targetTexts[i + n + k] !== seq[k]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

// Guard for the phrase-restart case: does the reference itself contain `word`
// twice, exactly `n` apart? "in the box the cat sat" legitimately repeats
// "the" at distance 2 and must not have "the box" dropped as an aborted run.
function targetRepeatsWordAtDistance(targetTexts, word, n) {
  if (!targetTexts) return false;
  for (let i = 0; i + n < targetTexts.length; i++) {
    if (targetTexts[i] === word && targetTexts[i + n] === word) return true;
  }
  return false;
}

function stepSelfCorrection(tokens, trace, targetTexts) {
  const out = [];
  let i = 0;

  while (i < tokens.length) {
    let collapsed = false;

    // Try the longest run first, so "to the / to the" beats "the / the".
    for (let n = SELF_CORRECTION_MAX_SEQ; n >= 1; n--) {
      if (i + 2 * n > tokens.length) continue;

      const first = tokens.slice(i, i + n);
      const second = tokens.slice(i + n, i + 2 * n);

      // A multi-token restart must be a function-word sequence. A single
      // token may be any class.
      if (n > 1 && !first.every((t) => FUNCTION_WORDS.has(t.text))) continue;

      if (!first.every((t, k) => isRestartOf(t, second[k]))) continue;

      // The reference itself repeats this unit — it is not a repair.
      const seq = second.map((t) => t.text);
      if (targetHasAdjacentRepetition(targetTexts, seq)) {
        trace.suppressedCollapses.push({ seq, reason: "target-repeats-unit" });
        continue;
      }

      // The restart must be immediate: the gap between the end of the aborted
      // run and the start of the retry is within roughly one second.
      const g = gapMs(first[n - 1], second[0]);
      if (g === null || g < 0 || g > SELF_CORRECTION_MAX_GAP_MS) continue;

      trace.selfCorrections.push({
        aborted: first.map((t) => t.origText),
        retry: second.map((t) => t.text),
        gapMs: g,
        runLength: n,
      });

      // Drop the aborted run, keep the completed retry.
      i += n;
      collapsed = true;
      break;
    }

    // PHRASE RESTART (corpus ruling, item 2). "the cat... the dog sat" is
    // scored as "the dog sat": the aborted run shares a leading function word
    // with the retry but carries a different word after it, so the
    // repeat-of-itself test above cannot see it. The FINAL corrected form is
    // what gets scored; the aborted attempt is dropped and logged, never
    // counted as a content-word error.
    if (!collapsed) {
      for (let n = SELF_CORRECTION_MAX_ABORTED_RUN; n >= 1; n--) {
        if (i + n >= tokens.length) continue;

        const head = tokens[i];
        const retryHead = tokens[i + n];

        // The restart must be signalled by a repeated FUNCTION word.
        if (!FUNCTION_WORDS.has(head.text)) continue;
        if (head.text !== retryHead.text) continue;

        // Something between them must actually differ, or this is the plain
        // repeat case already handled above.
        const aborted = tokens.slice(i, i + n);
        const retry = tokens.slice(i + n, i + 2 * n);
        if (retry.length === aborted.length &&
            aborted.every((t, k) => t.text === retry[k].text)) continue;

        const g = gapMs(tokens[i + n - 1], retryHead);
        if (g === null || g < 0 || g > SELF_CORRECTION_MAX_GAP_MS) continue;

        // The reference legitimately repeats this word at this spacing.
        if (targetRepeatsWordAtDistance(targetTexts, head.text, n)) {
          trace.suppressedCollapses.push({
            seq: aborted.map((t) => t.text),
            reason: "target-repeats-word-at-distance",
          });
          continue;
        }

        trace.selfCorrections.push({
          kind: "phrase-restart",
          aborted: aborted.map((t) => t.origText),
          retry: retry.map((t) => t.text),
          gapMs: g,
          runLength: n,
        });

        i += n;
        collapsed = true;
        break;
      }
    }

    if (!collapsed) {
      out.push(tokens[i]);
      i += 1;
    }
  }

  return out;
}

// -- Step 7/8: collapse whitespace, tokenize --------------------------------
function stepDropEmpty(tokens) {
  return tokens.filter((t) => t.text.trim() !== "");
}

/**
 * Normalize one side.
 *
 * @param {Array} rawTokens - [{ w, startMs, endMs, conf, srcIndex }]
 * @param {{ isHypothesis: boolean }} opts
 * @returns {{ tokens: Array, trace: Object }}
 */
function normalizeTokens(rawTokens, { isHypothesis, targetTexts = null }) {
  const trace = {
    steps: [],
    selfCorrections: [],
    suppressedCollapses: [],
    isHypothesis,
  };

  let tokens = rawTokens.map((w, i) =>
    mkToken(w.w, { ...w, origText: w.w, srcIndex: i })
  );
  trace.steps.push({ step: "input", tokens: tokens.map((t) => t.text) });

  const ordered = [
    ["lowercase", stepLowercase],
    ["stripPunctuation", stepStripPunctuation],
    ["expandContractions", stepExpandContractions],
    ["normalizeNumerals", stepNormalizeNumerals],
    ["hyphenation", stepHyphenation],
  ];

  for (const [name, fn] of ordered) {
    tokens = fn(tokens);
    trace.steps.push({ step: name, tokens: tokens.map((t) => t.text) });
  }

  // Decision 6 — hypothesis side only, and structurally so: target tokens
  // carry null timings and could not satisfy the gap test anyway.
  if (isHypothesis) {
    tokens = stepSelfCorrection(tokens, trace, targetTexts);
    trace.steps.push({
      step: "selfCorrectionCollapse",
      tokens: tokens.map((t) => t.text),
    });
  }

  tokens = stepDropEmpty(tokens);
  trace.steps.push({ step: "dropEmpty", tokens: tokens.map((t) => t.text) });

  return { tokens, trace };
}

/** Target side: plain text in, no timings. */
function normalizeTarget(text) {
  const raw = text.trim().split(/\s+/).filter(Boolean).map((w) => ({ w }));
  return normalizeTokens(raw, { isHypothesis: false });
}

/**
 * Hypothesis side: word objects with integer-ms timings.
 *
 * `targetTexts` is the ALREADY-NORMALIZED target token list. It is used for
 * one purpose only — suppressing a self-correction collapse where the
 * reference genuinely repeats the unit. Normalize the target first, then pass
 * its tokens here.
 */
function normalizeHypothesis(words, targetTexts = null) {
  return normalizeTokens(words, { isHypothesis: true, targetTexts });
}

module.exports = {
  normalizeTokens,
  normalizeTarget,
  normalizeHypothesis,
  isRestartOf,
};
