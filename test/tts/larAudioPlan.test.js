// test/tts/larAudioPlan.test.js
// LAR audio plan: intro + 7 utterances in one NA voice. Synthetic fixtures only.

"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseLarLayer1, pronounGender, buildLarPlan, PRESET, UTTERANCE_COUNT } = require("../../scripts/toeflTts/larAudioPlan");
const { PRESETS } = require("../../scripts/toeflTts/config");

const layer1 = ({ gender = "M", pronoun = "he", parts = [1, 2, 2, 2], intro = true } = {}) => {
  const names = ["Welcome/greeting", "Facilities/location orientation", "Services explanation", "Closing policy/rule statement"];
  let n = 0;
  return [
    "# LAR-001_layer1_generation.md",
    "",
    "POOL SOURCE: LAR-P01",
    "SPECIFIC VENUE: Campus bookstore",
    intro ? `INTRODUCTION: You are being trained to help customers at a campus bookstore. Listen to your manager and repeat what ${pronoun} says. Repeat only once.` : null,
    `INTRODUCTION SPEAKER GENDER: ${gender}`,
    "",
    "UTTERANCE SET (7 utterances, following the fixed 4-part structure):",
    "",
    ...parts.flatMap((count, i) => [`Part ${i + 1} -- ${names[i]}:`, ...Array.from({ length: count }, () => `Utterance   ${++n} text.`), ""]),
    "WORD COUNT PER UTTERANCE: [1: 3]",
    "",
    "---",
    "LAYER 2 (AUTOMATED REVIEW): PASS",
  ].filter((l) => l !== null).join("\n");
};

const voiceManifest = (gender = "M") => ({
  items: [{ itemId: "LAR-001", gender, accent: "NA", voiceConstant: `TOEFL_TTS_VOICE_NA_${gender}` }],
});

function makeCorpus(items) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lar-audio-"));
  const base = path.join(root, "12_listen_repeat");
  for (const { id, body = layer1(), status = "Review status: VALIDATED" } of items) {
    const dir = path.join(base, id);
    fs.mkdirSync(dir, { recursive: true });
    if (body !== null) fs.writeFileSync(path.join(dir, `${id}_layer1_generation.md`), body);
    if (status !== null) fs.writeFileSync(path.join(dir, "STATUS.txt"), `${status}\n`);
  }
  fs.mkdirSync(path.join(base, "_archive"), { recursive: true });
  return root;
}

describe("parseLarLayer1", () => {
  it("reads the introduction, the gender field and seven utterances in part order", () => {
    const p = parseLarLayer1(layer1());
    assert.match(p.introduction, /^You are being trained/);
    assert.strictEqual(p.gender, "M");
    assert.strictEqual(p.utterances.length, UTTERANCE_COUNT);
    assert.deepStrictEqual(p.utterances.map((u) => u.utteranceIndex), [1, 2, 3, 4, 5, 6, 7]);
    assert.deepStrictEqual(p.utterances.map((u) => u.part), ["greeting", "facilities", "facilities", "services", "services", "closing", "closing"]);
    assert.strictEqual(p.utterances[0].text, "Utterance 1 text.");
  });

  it("rejects a missing introduction, a missing gender field and a wrong utterance count", () => {
    assert.throws(() => parseLarLayer1(layer1({ intro: false })), /no INTRODUCTION field/);
    assert.throws(() => parseLarLayer1(layer1().replace(/^INTRODUCTION SPEAKER GENDER: M$/m, "INTRODUCTION SPEAKER GENDER: X")), /GENDER/);
    assert.throws(() => parseLarLayer1(layer1({ parts: [1, 2, 2, 1] })), /expected 7 utterances, found 6/);
  });

  it("reads the gender the introduction's pronoun implies", () => {
    assert.strictEqual(pronounGender("… repeat what he says. Repeat only once."), "M");
    assert.strictEqual(pronounGender("… repeat what she says. Repeat only once."), "F");
    assert.throws(() => pronounGender("… repeat it. Repeat only once."), /repeat what he\/she says/);
  });
});

describe("buildLarPlan", () => {
  it("gives each item 8 clips in one NA voice with the trainer preset and no pause tags", () => {
    const root = makeCorpus([{ id: "LAR-001" }]);
    const { items, excluded } = buildLarPlan(root, voiceManifest("M"));
    assert.deepStrictEqual(excluded, []);
    const [it] = items;
    assert.strictEqual(it.voiceConstant, "TOEFL_TTS_VOICE_NA_M");
    assert.strictEqual(it.preset, PRESET);
    assert.deepStrictEqual(it.clips.map((c) => c.clip), ["intro", "u1", "u2", "u3", "u4", "u5", "u6", "u7"]);
    assert.strictEqual(it.clips[1].file, path.join("lar", "LAR-001", "LAR-001_u1.mp3"));
    assert.ok(it.clips.every((c) => c.textSent === c.text && !c.textSent.includes("<break")));
    assert.ok(it.clips.every((c) => c.settings.speed === PRESETS[PRESET].speed && /^[0-9a-f]{64}$/.test(c.textSha256)));
    assert.strictEqual(it.clips[0].part, null);
  });

  it("excludes an item when the three gender sources disagree, or the gate fails", () => {
    const root = makeCorpus([
      { id: "LAR-001" },
      { id: "LAR-002", body: layer1({ gender: "F", pronoun: "she" }) },   // manifest says M below
      { id: "LAR-003", body: layer1({ gender: "M", pronoun: "she" }) },   // pronoun disagrees
      { id: "LAR-004", status: "Review status: REJECT" },
      { id: "LAR-005", status: null },
      { id: "LAR-006", body: null },
    ]);
    const vm = { items: [1, 2, 3, 4, 5, 6].map((n) => ({ itemId: `LAR-00${n}`, gender: "M", accent: "NA" })) };
    const { items, excluded } = buildLarPlan(root, vm);
    assert.deepStrictEqual(items.map((i) => i.itemId), ["LAR-001"]);
    const why = Object.fromEntries(excluded.map((e) => [e.itemId, e.reason]));
    assert.match(why["LAR-002"], /layer1 F, voice manifest M/);
    assert.match(why["LAR-003"], /pronoun implies F/);
    assert.match(why["LAR-004"], /REJECT/);
    assert.strictEqual(why["LAR-005"], "no STATUS file");
    assert.strictEqual(why["LAR-006"], "no layer1 file");
  });

  it("excludes an item missing from the voice manifest, and limits to --items", () => {
    const root = makeCorpus([{ id: "LAR-001" }, { id: "LAR-002" }]);
    const { items, excluded } = buildLarPlan(root, voiceManifest("M"), { only: ["LAR-002", "LAR-099"] });
    assert.deepStrictEqual(items, []);
    const why = Object.fromEntries(excluded.map((e) => [e.itemId, e.reason]));
    assert.match(why["LAR-002"], /not in lar_voice_manifest/);
    assert.strictEqual(why["LAR-099"], "no such item folder");
  });
});
