// test/tts/intAudioPlan.test.js
// Interview audio plan: intro + four question clips in one voice. Synthetic fixtures only.

"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  parseVoiceProfile,
  parseIntLayer1,
  buildIntPlan,
  countWords,
  shortQuestionText,
  clipDelivery,
  PRESET,
} = require("../../scripts/toeflTts/intAudioPlan");
const { PRESETS, INT_SHORT_QUESTION } = require("../../scripts/toeflTts/config");

const TAG = '<break time="0.3s" />';
const words = (n, last = "end?") => [...Array.from({ length: n - 1 }, (_, i) => `w${i}`), last].join(" ");

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

describe("countWords", () => {
  it("counts tokens with a letter or digit, not a lone dash", () => {
    assert.strictEqual(countWords("Do you walk — or   drive, mostly?"), 6);
    assert.strictEqual(countWords("studies—or friends"), 2);
  });
});

describe("shortQuestionText", () => {
  it("puts the break before the first em dash", () => {
    assert.deepStrictEqual(shortQuestionText("Tell me about a hobby — for example, a sport — you enjoy?"), {
      text: `Tell me about a hobby ${TAG} — for example, a sport — you enjoy?`,
      pause: "dash",
    });
    assert.strictEqual(shortQuestionText("Name a teacher—or a coach—who helped you?").text, `Name a teacher ${TAG} —or a coach—who helped you?`);
  });

  it("puts it right before a short tag-on question, ahead of any dash or comma", () => {
    assert.deepStrictEqual(shortQuestionText("Would you rather cook at home, or eat out? Why?"), {
      text: `Would you rather cook at home, or eat out? ${TAG} Why?`,
      pause: "tagOn",
    });
    assert.strictEqual(
      shortQuestionText("Do you walk — or drive — to work? Why or why not?").text,
      `Do you walk — or drive — to work? ${TAG} Why or why not?`
    );
    assert.strictEqual(shortQuestionText("Do you repair things or replace them? Why?").pause, "tagOn");
  });

  it("does not treat a longer second question as a tag-on", () => {
    assert.deepStrictEqual(shortQuestionText("Is it hard? Do you agree or disagree, and why?"), {
      text: "Is it hard? Do you agree or disagree, and why?",
      pause: null,
    });
  });

  it("otherwise puts it after the last clause-opening comma", () => {
    assert.strictEqual(
      shortQuestionText("When you travel, do you plan ahead, or decide on the day?").text,
      `When you travel, do you plan ahead, ${TAG} or decide on the day?`
    );
    assert.strictEqual(
      shortQuestionText("Describe a habit you keep, such as reading at night?").text,
      `Describe a habit you keep, ${TAG} such as reading at night?`
    );
  });

  it("skips serial-list commas", () => {
    assert.deepStrictEqual(shortQuestionText("Describe a book, film, or show you liked?"), {
      text: "Describe a book, film, or show you liked?",
      pause: null,
    });
    assert.strictEqual(
      shortQuestionText("Where do you see art, such as films, songs, or murals?").text,
      `Where do you see art, ${TAG} such as films, songs, or murals?`
    );
  });

  it("looks only at the first sentence", () => {
    const stem = "Some people say cities are too loud. Do you agree or disagree, and why?";
    assert.deepStrictEqual(shortQuestionText(stem), { text: stem, pause: null });
  });
});

describe("clipDelivery", () => {
  const max = INT_SHORT_QUESTION.maxWords;

  it("treats a stem of maxWords or fewer as short, in any question position", () => {
    for (const clip of ["q1", "q2", "q3", "q4"]) {
      const d = clipDelivery(clip, words(max));
      assert.strictEqual(d.delivery, "short");
      assert.deepStrictEqual(d.settings, { ...PRESETS[PRESET], speed: 0.92 });
    }
    assert.strictEqual(clipDelivery("q1", words(max + 1)).delivery, "standard");
  });

  it("leaves long stems and every intro on the preset, text unchanged", () => {
    const long = `${words(max, "one,")} or two — three?`;
    for (const [clip, text] of [["q2", long], ["intro", "You are joining a study, and a researcher will ask you questions."]]) {
      const d = clipDelivery(clip, text);
      assert.strictEqual(d.delivery, "standard");
      assert.strictEqual(d.textSent, text);
      assert.deepStrictEqual(d.settings, PRESETS[PRESET]);
    }
  });

  it("gives a short stem with no clause break the speed but no tag", () => {
    const d = clipDelivery("q3", "Some people say cities are too loud. Do you agree?");
    assert.strictEqual(d.delivery, "short");
    assert.strictEqual(d.pause, null);
    assert.strictEqual(d.settings.speed, 0.92);
    assert.ok(!d.textSent.includes("<break"));
  });

  it("does not change the preset object", () => {
    clipDelivery("q1", "Short one?");
    assert.strictEqual(PRESETS[PRESET].speed, 1.0);
  });
});

describe("buildIntPlan delivery", () => {
  it("attaches delivery, textSent and settings to every clip", () => {
    const { items } = buildIntPlan(makeCorpus([{ id: "INT-001" }]));
    const [intro, q1] = items[0].clips;
    assert.strictEqual(intro.delivery, "standard");
    assert.strictEqual(q1.delivery, "short");
    assert.strictEqual(q1.textSent, "Question number 1?");
    assert.strictEqual(q1.settings.speed, 0.92);
  });
});

describe("resolveClipDelivery (per-voice policy and per-clip overrides)", () => {
  const { resolveClipDelivery } = require("../../scripts/toeflTts/intAudioPlan");
  const { INT_TAG_POLICY, ACCENTS, GENDERS, TTS_SEED } = require("../../scripts/toeflTts/config");
  const whyStem = "Would you rather cook at home, or eat out? Why?";
  const dashStem = "Tell me about a hobby — for example, a sport — you enjoy?";
  const pol = (breakTime, status = "confirmed") => ({ breakTime, status, note: "n" });
  const policies = { AA_F: { tagOn: pol("0.3s"), dash: pol(null), comma: pol("0.3s", "unresolved") } };
  const at = (text, clip = "q2", itemId = "INT-009") => ({ itemId, clip, text, voiceConstant: "TOEFL_TTS_VOICE_AA_F" });

  it("has a policy with a known status for every voice slot and pause type", () => {
    for (const a of ACCENTS) for (const g of GENDERS) for (const p of ["tagOn", "dash", "comma"]) {
      const e = INT_TAG_POLICY[`${a}_${g}`]?.[p];
      assert.ok(e, `${a}_${g}.${p}`);
      assert.ok(["confirmed", "decided", "inferred", "untested", "default"].includes(e.status), `${a}_${g}.${p} ${e.status}`);
      assert.ok(e.breakTime === null || /^0\.\d+s$/.test(e.breakTime));
    }
  });

  it("applies the voice's break length, or no tag, by pause type", () => {
    const tagged = resolveClipDelivery(at(whyStem), { policies, overrides: {} });
    assert.strictEqual(tagged.textSent, `Would you rather cook at home, or eat out? ${TAG} Why?`);
    assert.strictEqual(tagged.seed, TTS_SEED);
    const untagged = resolveClipDelivery(at(dashStem, "q1"), { policies, overrides: {} });
    assert.strictEqual(untagged.textSent, dashStem);
    assert.strictEqual(untagged.breakTime, null);
    assert.strictEqual(untagged.settings.speed, 0.92);
  });

  it("blocks unresolved cells unless the clip has an override", () => {
    const stem = "Describe a habit you keep, such as reading at night?";
    assert.match(resolveClipDelivery(at(stem, "q1"), { policies, overrides: {} }).blocked, /unresolved/);
    const overrides = { "INT-009:q1": { breakTime: "0.6s", seed: 7, reason: "heard OK" } };
    const r = resolveClipDelivery(at(stem, "q1"), { policies, overrides });
    assert.strictEqual(r.blocked, null);
    assert.strictEqual(r.seed, 7);
    assert.strictEqual(r.textSent, 'Describe a habit you keep, <break time="0.6s" /> such as reading at night?');
  });

  it("lets an override remove the tag or change only the seed", () => {
    const noTag = resolveClipDelivery(at(whyStem), { policies, overrides: { "INT-009:q2": { breakTime: null, reason: "r" } } });
    assert.strictEqual(noTag.textSent, whyStem);
    const reseed = resolveClipDelivery(at(whyStem), { policies, overrides: { "INT-009:q2": { seed: 5, reason: "r" } } });
    assert.strictEqual(reseed.seed, 5);
    assert.match(reseed.textSent, /\? <break time="0\.3s" \/> Why\?$/);
  });

  it("labels confirmation: confirmed, default (policy, no break, intro), decided (long), override", () => {
    const pols = { AA_F: { tagOn: pol("0.3s"), dash: pol(null, "default"), comma: pol("0.3s", "inferred") } };
    const c = (text, clip = "q2", overrides = {}) => resolveClipDelivery(at(text, clip), { policies: pols, overrides });
    assert.strictEqual(c(whyStem).confirmation, "confirmed");
    const d = c(dashStem, "q1");
    assert.strictEqual(d.confirmation, "default");
    assert.strictEqual(d.textSent, dashStem);
    assert.strictEqual(c("Describe a habit you keep, such as reading at night?", "q1").confirmation, "default");
    const plain = c("Describe your favourite place to read?", "q1");
    assert.strictEqual(plain.pause, null);
    assert.strictEqual(plain.confirmation, "default");
    assert.match(plain.confirmationNote, /no clause break/);
    assert.strictEqual(c("You will talk with a researcher today.", "intro").confirmation, "default");
    const long = c(`${Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ")}?`, "q3");
    assert.strictEqual(long.confirmation, "decided");
    const o = c(whyStem, "q2", { "INT-009:q2": { breakTime: null, reason: "heard fine untagged" } });
    assert.deepStrictEqual([o.confirmation, o.confirmationNote], ["override", "heard fine untagged"]);
  });

  it("has no unresolved cell, so nothing in the real table blocks generation", () => {
    for (const slot of Object.values(INT_TAG_POLICY)) for (const e of Object.values(slot)) assert.notStrictEqual(e.status, "unresolved");
  });

  it("buildIntPlan applies the item's voice policy and confirmation to every clip", () => {
    const whyBody = layer1().replace("Stem: Question   number 2?", "Stem: Would you rather cook at home, or eat out? Why?");
    const root = makeCorpus([{ id: "INT-001", body: whyBody }]);
    const policies = { UK_F: { tagOn: pol(null, "decided"), dash: pol("0.3s"), comma: pol("0.3s") } };
    const [it] = buildIntPlan(root, { resolveOptions: { policies, overrides: {} } }).items;
    const q2 = it.clips[2];
    assert.strictEqual(q2.pause, "tagOn");
    assert.strictEqual(q2.textSent, "Would you rather cook at home, or eat out? Why?");
    assert.strictEqual(q2.confirmation, "decided");
    assert.strictEqual(q2.seed, TTS_SEED);
    assert.ok(it.clips.every((c) => c.confirmation && !c.blocked));
  });

  it("rejects an override without a reason, and leaves intros and long stems alone", () => {
    assert.throws(() => resolveClipDelivery(at(whyStem), { policies, overrides: { "INT-009:q2": { seed: 1 } } }), /no reason/);
    const intro = resolveClipDelivery(at("You are joining a study, and a researcher will ask questions.", "intro"), { policies, overrides: {} });
    assert.strictEqual(intro.delivery, "standard");
    assert.strictEqual(intro.policy, null);
  });
});
