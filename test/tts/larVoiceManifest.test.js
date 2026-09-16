// test/tts/larVoiceManifest.test.js
// LAR gender/voice assignment (M F M F M by item number, NA voices only). Synthetic fixtures only.

"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  SCHEMA,
  patternGender,
  listActiveLarItems,
  assignLarVoices,
  readManifest,
  writeManifest,
} = require("../../scripts/toeflTts/larVoiceManifest");

const ids = (...nums) => nums.map((n) => `LAR-${String(n).padStart(3, "0")}`);
const range = (n) => ids(...Array.from({ length: n }, (_, i) => i + 1));
const genders = (m) => m.items.map((it) => it.gender).join("");

function makeCorpus(items) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lar-corpus-"));
  const base = path.join(root, "12_listen_repeat");
  for (const { id, status = "Review status: VALIDATED", layer1 = true } of items) {
    const dir = path.join(base, id);
    fs.mkdirSync(dir, { recursive: true });
    if (layer1) fs.writeFileSync(path.join(dir, `${id}_layer1_generation.md`), "UTTERANCE SET\n");
    if (status !== null) fs.writeFileSync(path.join(dir, "STATUS.txt"), `${status}\n`);
  }
  fs.mkdirSync(path.join(base, "_archive"), { recursive: true });
  return root;
}

describe("LAR voice assignment", () => {
  it("repeats M F M F M by item number", () => {
    assert.deepStrictEqual(range(11).map(patternGender).join(""), "MFMFMMFMFMM");
  });

  it("gives 45 items 27 M and 18 F, never three in a row, NA voices only", () => {
    const { manifest, warnings } = assignLarVoices(range(45), null, "2026-09-16");
    const g = genders(manifest);
    assert.strictEqual([...g].filter((x) => x === "M").length, 27);
    assert.strictEqual([...g].filter((x) => x === "F").length, 18);
    assert.ok(!/MMM|FFF/.test(g));
    assert.deepStrictEqual(warnings, []);
    assert.deepStrictEqual(
      [...new Set(manifest.items.map((i) => `${i.gender}:${i.accent}:${i.voiceConstant}`))].sort(),
      ["F:NA:TOEFL_TTS_VOICE_NA_F", "M:NA:TOEFL_TTS_VOICE_NA_M"]
    );
  });

  it("does not shift other items when one is retired, and records the removal once", () => {
    const first = assignLarVoices(range(6), null, "2026-09-16").manifest;
    const { manifest, added, warnings } = assignLarVoices(ids(1, 2, 4, 5, 6), first, "2026-09-20");
    assert.strictEqual(genders(manifest), "MFFMM");
    assert.deepStrictEqual(added, []);
    assert.deepStrictEqual(manifest.removedItems, [{ itemId: "LAR-003", gender: "M", removedOn: "2026-09-20" }]);
    assert.deepStrictEqual(warnings, []);
    const again = assignLarVoices(ids(1, 2, 4, 5, 6), manifest, "2026-09-21").manifest;
    assert.strictEqual(again.removedItems.length, 1);
  });

  it("keeps recorded genders on rerun and warns when one disagrees with the pattern", () => {
    const first = assignLarVoices(range(3), null, "2026-09-16").manifest;
    first.items[1] = { ...first.items[1], gender: "M" };
    const { manifest, warnings, added } = assignLarVoices(range(4), first, "2026-09-17");
    assert.strictEqual(genders(manifest), "MMMF");
    assert.deepStrictEqual(added, ["LAR-004"]);
    assert.strictEqual(manifest.items[3].assignedOn, "2026-09-17");
    assert.ok(warnings.some((w) => /LAR-002 is M in the manifest but F/.test(w)));
    assert.ok(warnings.some((w) => /three M in a row/.test(w)));
  });

  it("lists active items numerically and excludes REJECT, missing layer1 and missing STATUS", () => {
    const root = makeCorpus([
      { id: "LAR-010" },
      { id: "LAR-002" },
      { id: "LAR-003", status: "Review status: REJECT" },
      { id: "LAR-004", layer1: false },
      { id: "LAR-005", status: null },
    ]);
    const { active, excluded } = listActiveLarItems(root);
    assert.deepStrictEqual(active, ["LAR-002", "LAR-010"]);
    assert.deepStrictEqual(excluded.map((e) => e.itemId).sort(), ["LAR-003", "LAR-004", "LAR-005"]);
  });

  it("round-trips the manifest and rejects an unexpected schema", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lar-man-")), "m", "lar.json");
    const { manifest } = assignLarVoices(range(2), null, "2026-09-16");
    writeManifest(file, manifest);
    assert.deepStrictEqual(readManifest(file), manifest);
    assert.strictEqual(manifest.schema, SCHEMA);
    fs.writeFileSync(file, JSON.stringify({ schema: "other" }));
    assert.throws(() => readManifest(file), /unexpected schema/);
  });
});
