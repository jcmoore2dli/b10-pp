// test/tts/intAudioPlan.test.js
// Interview audio plan: intro + four question clips in one voice. Synthetic fixtures only.

"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseVoiceProfile, parseIntLayer1, buildIntPlan, PRESET } = require("../../scripts/toeflTts/intAudioPlan");

const layer1 = ({ profile = "Female, UK accent — single consistent voice across all 4 questions", context, questions = 4 } = {}) =>
  [
    "**ITEM ID:** INT-X-001",
    "",
    `**SPEAKER VOICE PROFILE:** ${profile}`,
    "",
    "**INTERVIEW CONTEXT:**",
    context ?? "You have volunteered for a research study about music.\nYou will have a short online interview with a researcher.",
    "",
    "---",
    "",
    "**QUESTIONS:**",
    "",
    ...Array.from({ length: questions }, (_, i) => [
      `**Q${i + 1} [Tag — B2]:**`,
      `Stem: Question   number ${i + 1}?`,
      "Elaboration floor: x",
      "",
    ]).flat(),
    "---",
    "",
    "**CONNECTED-TOPIC COHERENCE CHECK:** Yes",
  ].join("\n");

const status = ({ layer2 = "PASS", cross = "PASS", profile = "Female, UK accent" } = {}) =>
  [
    "ITEM ID: INT-001",
    `SPEAKER VOICE PROFILE: ${profile}`,
    `LAYER 2 (AUTOMATED REVIEW): ${layer2}`,
    cross === null ? null : `CROSS-MODEL CHECK: ${cross}`,
  ]
    .filter((l) => l !== null)
    .join("\n") + "\n";

function makeCorpus(items) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "int-corpus-"));
  const base = path.join(root, "03_interview");
  for (const { id, body = layer1(), st = status(), statusName = `${id}_STATUS.txt` } of items) {
    const dir = path.join(base, id);
    fs.mkdirSync(dir, { recursive: true });
    if (body !== null) fs.writeFileSync(path.join(dir, `${id}_layer1_generation.md`), body);
    if (st !== null) fs.writeFileSync(path.join(dir, statusName), st);
  }
  fs.mkdirSync(path.join(base, "_archive"), { recursive: true });
  return root;
}

describe("parseVoiceProfile", () => {
  it("maps all four accents and both genders", () => {
    assert.deepStrictEqual(parseVoiceProfile("Male, North American accent"), { gender: "M", accent: "NA" });
    assert.deepStrictEqual(parseVoiceProfile("Female, New Zealand accent — note"), { gender: "F", accent: "NZ" });
    assert.deepStrictEqual(parseVoiceProfile("Male, Australian accent"), { gender: "M", accent: "AU" });
    assert.deepStrictEqual(parseVoiceProfile("Female, UK accent"), { gender: "F", accent: "UK" });
  });
  it("rejects anything else", () => {
    assert.throws(() => parseVoiceProfile("Female, Irish accent"));
    assert.throws(() => parseVoiceProfile(null));
  });
});

describe("parseIntLayer1", () => {
  it("extracts the context sentence on one line and the four stems", () => {
    const p = parseIntLayer1(layer1());
    assert.strictEqual(
      p.contextSentence,
      "You have volunteered for a research study about music. You will have a short online interview with a researcher."
    );
    assert.deepStrictEqual(p.stems, [1, 2, 3, 4].map((n) => `Question number ${n}?`));
  });
  it("fails without an INTERVIEW CONTEXT block", () => {
    assert.throws(() => parseIntLayer1(layer1().replace("**INTERVIEW CONTEXT:**", "**OTHER:**")), /INTERVIEW CONTEXT/);
  });
  it("fails on the wrong question count", () => {
    assert.throws(() => parseIntLayer1(layer1({ questions: 3 })), /expected 4 questions/);
  });
});

describe("buildIntPlan", () => {
  it("gives each item an intro clip plus q1-q4, all in the item's one voice and preset", () => {
    const root = makeCorpus([{ id: "INT-001" }]);
    const { items, excluded } = buildIntPlan(root);
    assert.deepStrictEqual(excluded, []);
    assert.strictEqual(items.length, 1);
    const [it] = items;
    assert.strictEqual(it.voiceConstant, "TOEFL_TTS_VOICE_UK_F");
    assert.strictEqual(it.preset, PRESET);
    assert.deepStrictEqual(it.clips.map((c) => c.clip), ["intro", "q1", "q2", "q3", "q4"]);
    assert.strictEqual(it.clips[0].file, path.join("int", "INT-001", "INT-001_intro.mp3"));
    assert.match(it.clips[0].text, /^You have volunteered/);
    assert.ok(it.clips.every((c) => /^[0-9a-f]{64}$/.test(c.textSha256)));
  });

  it("excludes items that fail the gate or disagree on voice, and reports why", () => {
    const root = makeCorpus([
      { id: "INT-001" },
      { id: "INT-002", st: status({ layer2: "REVISE — open finding" }) },
      { id: "INT-003", st: status({ cross: "FAIL" }) },
      { id: "INT-004", st: status({ profile: "Male, UK accent" }) },
      { id: "INT-005", st: null },
      { id: "INT-006", body: null },
      { id: "INT-007", st: status({ cross: null }), statusName: "STATUS.txt" },
    ]);
    const { items, excluded } = buildIntPlan(root);
    assert.deepStrictEqual(items.map((i) => i.itemId), ["INT-001", "INT-007"]);
    const reasons = Object.fromEntries(excluded.map((e) => [e.itemId, e.reason]));
    assert.match(reasons["INT-002"], /LAYER 2 verdict: REVISE/);
    assert.match(reasons["INT-003"], /CROSS-MODEL CHECK: FAIL/);
    assert.match(reasons["INT-004"], /voice mismatch/);
    assert.strictEqual(reasons["INT-005"], "no STATUS file");
    assert.strictEqual(reasons["INT-006"], "no layer1 file");
  });

  it("limits to --items and reports unknown IDs", () => {
    const root = makeCorpus([{ id: "INT-001" }, { id: "INT-002" }]);
    const { items, excluded } = buildIntPlan(root, { only: ["INT-002", "INT-099"] });
    assert.deepStrictEqual(items.map((i) => i.itemId), ["INT-002"]);
    assert.deepStrictEqual(excluded, [{ itemId: "INT-099", reason: "no such item folder" }]);
  });
});
