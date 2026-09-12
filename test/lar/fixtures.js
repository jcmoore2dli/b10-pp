// test/lar/fixtures.js
// Synthetic fixtures. No emulator, no corpus, no audio.

"use strict";

const UTTERANCE_COUNT = 7;

/** Lay words out inside a window at a fixed cadence, in integer ms. */
function speak(text, startMs, { wordMs = 300, gapMs = 60, conf = 0.95 } = {}) {
  const out = [];
  let t = startMs;
  for (const w of text.split(/\s+/).filter(Boolean)) {
    out.push({ w, startMs: t, endMs: t + wordMs, conf });
    t += wordMs + gapMs;
  }
  return out;
}

/** Seven non-overlapping 6-second response windows, 10s apart. */
function boundaries(count = UTTERANCE_COUNT) {
  return Array.from({ length: count }, (_, i) => ({
    utteranceIndex: i + 1,
    responseStartMs: 10000 * i + 4000,
    responseEndMs: 10000 * i + 10000,
  }));
}

function intelligibility(overall = "clear", perVerdict = "clear", count = UTTERANCE_COUNT) {
  return {
    perUtterance: Array.from({ length: count }, (_, i) => ({
      utteranceIndex: i + 1,
      verdict: typeof perVerdict === "function" ? perVerdict(i + 1) : perVerdict,
      source: "stt-confidence",
      conf: 0.95,
    })),
    overall,
  };
}

const TARGETS = [
  "The well-known scientist published her findings last year.",
  "She gave him the book before the meeting started.",
  "The committee reviewed the proposal and rejected it.",
  "Many students find the entrance examination difficult.",
  "He walked to the store to buy some fresh bread.",
  "The old building was demolished to make room for housing.",
  "Researchers have identified a new species of butterfly.",
];

/** A perfect response: every utterance spoken exactly, inside its window. */
function perfectWords(targets = TARGETS, bs = boundaries()) {
  const words = [];
  targets.forEach((t, i) => {
    const clean = t.replace(/[.,]/g, "").replace(/-/g, " ");
    words.push(...speak(clean, bs[i].responseStartMs + 100, { wordMs: 200, gapMs: 40 }));
  });
  return words;
}

module.exports = {
  UTTERANCE_COUNT,
  TARGETS,
  speak,
  boundaries,
  intelligibility,
  perfectWords,
};
