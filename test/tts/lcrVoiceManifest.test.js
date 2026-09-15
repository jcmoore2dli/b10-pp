// test/tts/lcrVoiceManifest.test.js
// LCR gender alternation and manifest. Synthetic fixtures only.

"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  SCHEMA,
  listActiveLcrItems,
  assignGenders,
  readManifest,
  writeManifest,
} = require("../../scripts/toeflTts/lcrVoiceManifest");
const { voiceConstantFor, VOICES } = require("../../scripts/toeflTts/config");

const ids = (n) => Array.from({ length: n }, (_, i) => `LCR-${String(i + 1).padStart(3, "0")}`);
const genders = (m) => m.items.map((it) => it.gender).join("");

function makeCorpus(items) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lcr-corpus-"));
  const base = path.join(root, "07_listen_choose_response");
  for (const { id, status = "Review status: Layer 2 complete — VALIDATED", statusName, layer1 = true } of items) {
    const dir = path.join(base, id);
    fs.mkdirSync(dir, { recursive: true });
    if (layer1) fs.writeFileSync(path.join(dir, `${id}_layer1_generation.md`), "## x\n");
    if (status !== null) fs.writeFileSync(path.join(dir, statusName ?? `STATUS_${id}.txt`), `${status}\n`);
  }
  fs.mkdirSync(path.join(base, "_archive"), { recursive: true });
  return root;
}

describe("assignGenders", () => {
  it("alternates from F in ID order on a fresh manifest", () => {
    const { manifest, added, warnings } = assignGenders(ids(5), null, "2026-09-15");
    assert.strictEqual(genders(manifest), "FMFMF");
    assert.deepStrictEqual(added, ids(5));
    assert.deepStrictEqual(warnings, []);
    assert.strictEqual(manifest.schema, SCHEMA);
    assert.ok(manifest.items.every((it) => it.accent === null && it.voiceConstant === null));
  });

  it("is idempotent: a rerun on the same items changes nothing", () => {
    const first = assignGenders(ids(4), null, "2026-09-15").manifest;
    const second = assignGenders(ids(4), first, "2026-10-01");
    assert.deepStrictEqual(second.manifest, first);
    assert.deepStrictEqual(second.added, []);
  });

  it("keeps existing genders and continues alternation for new items", () => {
    const first = assignGenders(ids(3), null, "2026-09-15").manifest; // F M F
    const { manifest, added } = assignGenders(ids(5), first, "2026-10-01");
    assert.strictEqual(genders(manifest), "FMFMF");
    assert.deepStrictEqual(added, ["LCR-004", "LCR-005"]);
    assert.strictEqual(manifest.items[3].assignedOn, "2026-10-01");
    assert.strictEqual(manifest.items[0].assignedOn, "2026-09-15");
  });

  it("records a removed item and warns about the adjacency it creates, without reassigning", () => {
    const first = assignGenders(ids(4), null, "2026-09-15").manifest; // F M F M
    const active = ["LCR-001", "LCR-003", "LCR-004"];
    const { manifest, warnings } = assignGenders(active, first, "2026-10-01");
    assert.strictEqual(genders(manifest), "FFM");
    assert.deepStrictEqual(manifest.removedItems, [{ itemId: "LCR-002", gender: "M", removedOn: "2026-10-01" }]);
    assert.deepStrictEqual(warnings, ["LCR-001 and LCR-003 are adjacent and both F"]);
  });

  it("does not duplicate a removal on later runs", () => {
    const first = assignGenders(ids(3), null, "2026-09-15").manifest;
    const second = assignGenders(["LCR-001", "LCR-003"], first, "2026-10-01").manifest;
    const third = assignGenders(["LCR-001", "LCR-003"], second, "2026-10-08").manifest;
    assert.strictEqual(third.removedItems.length, 1);
  });
});

describe("listActiveLcrItems", () => {
  it("sorts numerically and excludes REJECT, missing layer1, missing STATUS and non-item folders", () => {
    const root = makeCorpus([
      { id: "LCR-010" },
      { id: "LCR-002", statusName: "STATUS.txt" },
      { id: "LCR-001", statusName: "LCR-001_STATUS.txt" },
      { id: "LCR-003", status: "Review status: REJECT — regenerating" },
      { id: "LCR-004", layer1: false },
      { id: "LCR-005", status: null },
    ]);
    const { active, excluded } = listActiveLcrItems(root);
    assert.deepStrictEqual(active, ["LCR-001", "LCR-002", "LCR-010"]);
    assert.deepStrictEqual(
      excluded.map((e) => `${e.itemId}:${e.reason}`).sort(),
      ["LCR-003:REJECT verdict", "LCR-004:no layer1 file", "LCR-005:no STATUS file"]
    );
  });
});

describe("manifest file", () => {
  it("round-trips and rejects an unexpected schema", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lcr-manifest-"));
    const file = path.join(dir, "nested", "lcr_voice_manifest.json");
    const { manifest } = assignGenders(ids(2), null, "2026-09-15");
    writeManifest(file, manifest);
    assert.deepStrictEqual(readManifest(file), manifest);
    assert.ok(!fs.existsSync(`${file}.tmp`));
    fs.writeFileSync(file, JSON.stringify({ schema: "other" }));
    assert.throws(() => readManifest(file), /unexpected schema/);
  });
});

describe("voiceConstantFor", () => {
  it("names an existing voice for every accent/gender slot", () => {
    for (const a of ["NA", "UK", "AU", "NZ"]) {
      for (const g of ["F", "M"]) assert.ok(VOICES[voiceConstantFor(a, g)]);
    }
    assert.throws(() => voiceConstantFor("US", "F"), /unknown accent/);
  });
});
