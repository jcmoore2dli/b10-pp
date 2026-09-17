// test/tts/atAudioPlan.test.js
// AT audio plan: one clip per item, voice and preset from the item. Synthetic fixtures only.

"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseAtTranscript, parseAtVoice, buildAtPlan, REGISTER_PRESETS } = require("../../scripts/toeflTts/atAudioPlan");

const layer1 = (text = "Today   we look\nat the Silk Road.") =>
  ["# AT-001_layer1_generation.md", "", "**ITEM ID:** AT-001", "", "**TRANSCRIPT:**", "", text, "",
   "**WORD COUNT:** 7", "", "---", "", "**ARC ANCHORS:**", "- x"].join("\n");

const status = ({ gender = "Female", accent = "North American", register = "Academic lecture", verdict = "VALIDATED" } = {}) =>
  [`ITEM ID: AT-001`, `REGISTER: ${register}`, `SPEAKER GENDER: ${gender}`, `ACCENT: ${accent}`,
   `REVIEW STATUS: ${verdict}`].join("\n") + "\n";

function makeCorpus(items) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "at-audio-"));
  const base = path.join(root, "02_academic_talk");
  for (const { id, body = layer1(), st = status() } of items) {
    const dir = path.join(base, id);
    fs.mkdirSync(dir, { recursive: true });
    if (body !== null) fs.writeFileSync(path.join(dir, `${id}_layer1_generation.md`), body);
    if (st !== null) fs.writeFileSync(path.join(dir, `${id}_STATUS.txt`), st);
  }
  fs.mkdirSync(path.join(base, "_archive"), { recursive: true });
  return root;
}

describe("AT audio plan", () => {
  it("takes the transcript block, collapsed to one line", () => {
    assert.strictEqual(parseAtTranscript(layer1()), "Today we look at the Silk Road.");
    assert.throws(() => parseAtTranscript("# no transcript here"), /no \*\*TRANSCRIPT/);
  });

  it("accepts both spellings of gender and accent, and maps register to a preset", () => {
    assert.deepStrictEqual(
      ["F", "NA", "lecture", REGISTER_PRESETS.lecture],
      [parseAtVoice(status()).gender, parseAtVoice(status()).accent, parseAtVoice(status()).register, parseAtVoice(status()).preset]
    );
    assert.strictEqual(parseAtVoice(status({ gender: "M", accent: "UK" })).accent, "UK");
    assert.strictEqual(parseAtVoice(status({ register: "Popular academic (podcast)" })).preset, REGISTER_PRESETS.podcast);
    assert.throws(() => parseAtVoice(status({ accent: "Irish" })), /unrecognised ACCENT/);
    assert.throws(() => parseAtVoice(status({ gender: "Other" })), /unrecognised SPEAKER GENDER/);
    assert.throws(() => parseAtVoice("ITEM ID: AT-001\n"), /no SPEAKER GENDER/);
  });

  it("gives each item exactly one stimulus clip, with the item's own voice and preset", () => {
    const { items, excluded } = buildAtPlan(makeCorpus([{ id: "AT-001" }]));
    assert.deepStrictEqual(excluded, []);
    const [it] = items;
    assert.strictEqual(it.voiceConstant, "TOEFL_TTS_VOICE_NA_F");
    assert.strictEqual(it.preset, "toefl_at_lecture");
    assert.strictEqual(it.clips.length, 1);
    assert.strictEqual(it.clips[0].clip, "stimulus");
    assert.strictEqual(it.clips[0].file, path.join("at", "AT-001", "AT-001_stimulus.mp3"));
    assert.strictEqual(it.clips[0].textSent, it.clips[0].text);
    assert.ok(!it.clips[0].textSent.includes("<break"));
  });

  it("excludes items that fail the gate or lack voice fields, and reports why", () => {
    const root = makeCorpus([
      { id: "AT-001" },
      { id: "AT-002", st: status({ verdict: "REJECT — pulled" }) },
      { id: "AT-003", st: status({ accent: "Martian" }) },
      { id: "AT-004", st: null },
      { id: "AT-005", body: null },
      { id: "AT-006", body: "# AT-006\n\n**ITEM ID:** AT-006\n" },
    ]);
    const { items, excluded } = buildAtPlan(root);
    assert.deepStrictEqual(items.map((i) => i.itemId), ["AT-001"]);
    const why = Object.fromEntries(excluded.map((e) => [e.itemId, e.reason]));
    assert.match(why["AT-002"], /REJECT/);
    assert.match(why["AT-003"], /unrecognised ACCENT/);
    assert.strictEqual(why["AT-004"], "no STATUS file");
    assert.strictEqual(why["AT-005"], "no layer1 file");
    assert.match(why["AT-006"], /no \*\*TRANSCRIPT/);
  });
});
