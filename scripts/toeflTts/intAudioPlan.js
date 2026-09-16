// scripts/toeflTts/intAudioPlan.js
// Interview (INT) audio: which clips each item needs, in which voice.
//
// Each item gets five clips, all in the item's one interviewer voice with the
// toefl_int_interviewer preset:
//   intro  — the INTERVIEW CONTEXT framing. ETS 2026 Test Specifications,
//            Speaking "Stimulus": "Each task begins with a scenario
//            introduction, delivered both aurally and in print". Same voice as
//            the questions (JC 2026-09-16: no second, unexplained voice).
//   q1–q4  — the four question stems.
//
// Short stems (INT_SHORT_QUESTION.maxWords or fewer, any question position)
// are sent with speed 0.92 and one break tag at the clause break; see
// shortQuestionText(). Intros and longer stems use the preset unchanged.
//
// Voice comes from the item's SPEAKER VOICE PROFILE ("Female, UK accent").
// The layer1 file and the STATUS file must agree. Item selection follows the
// importer's gate: LAYER 2 verdict PASS, CROSS-MODEL CHECK not failed.

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  PRESETS,
  INT_SHORT_QUESTION,
  INT_TAG_POLICY,
  INT_CLIP_OVERRIDES,
  TTS_SEED,
  voiceConstantFor,
} = require("./config");

const INT_FOLDER = "03_interview";
const PRESET = "toefl_int_interviewer";

const ACCENT_CODES = Object.freeze({
  "north american": "NA",
  uk: "UK",
  australian: "AU",
  "new zealand": "NZ",
});
const GENDER_CODES = Object.freeze({ female: "F", male: "M" });

const collapse = (s) => s.replace(/\s+/g, " ").trim();
const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

// Words are whitespace tokens containing a letter or digit; a lone "—" is not one.
const countWords = (s) => s.split(/\s+/).filter((t) => /[A-Za-z0-9]/.test(t)).length;

// Clause-opening words a break may precede when they follow a comma.
const TAG_ON_MAX_WORDS = 4;
const TAG_ON = /\?\s+([^.?!]+\?)\s*$/;

const CLAUSE_OPENERS = /, (?=(or|and|such as|even though|before|apart from)\b)/g;

// Where the break tag goes in a short stem. One tag per stem.
//   1. A stem ending in a short tag-on question ("...? Why?", at most
//      TAG_ON_MAX_WORDS words): tag right before it (JC 2026-09-16).
//   Otherwise only the first sentence is considered:
//   2. First em dash: tag before it (the form approved on INT-001 Q1).
//   3. Else the last comma that opens a clause (", or", ", such as", ...).
//      ", or"/", and" with another comma in the 4 words before it is a
//      serial list ("a song, food, or place") and is skipped.
//   4. Else no tag; the stem still gets the short-question speed.
// Returns { text, pause } where pause is "tagOn", "dash", "comma", or null.
function shortQuestionText(stem, breakTime = INT_SHORT_QUESTION.breakTime) {
  const tag = `<break time="${breakTime}" />`;

  const tagOn = TAG_ON.exec(stem);
  if (tagOn && countWords(tagOn[1]) <= TAG_ON_MAX_WORDS) {
    const at = tagOn.index + 1;
    return { text: `${stem.slice(0, at)} ${tag} ${stem.slice(at).trimStart()}`, pause: "tagOn" };
  }

  const first = stem.split(/(?<=[.?!])\s+/)[0];

  const dash = first.search(/\s*—/);
  if (dash >= 0) {
    return { text: `${stem.slice(0, dash)} ${tag} ${stem.slice(dash).trimStart()}`, pause: "dash" };
  }

  let at = -1;
  for (const m of first.matchAll(CLAUSE_OPENERS)) {
    const before = first.slice(0, m.index).split(/\s+/).slice(-4).join(" ");
    const serialList = (m[1] === "or" || m[1] === "and") && before.includes(",");
    if (!serialList) at = m.index;
  }
  if (at >= 0) {
    return { text: `${stem.slice(0, at + 1)} ${tag}${stem.slice(at + 1)}`, pause: "comma" };
  }
  return { text: stem, pause: null };
}

// How one clip is rendered: the text sent to ElevenLabs and its voice settings.
function clipDelivery(clip, text) {
  const preset = PRESETS[PRESET];
  const words = countWords(text);
  if (clip === "intro" || words > INT_SHORT_QUESTION.maxWords) {
    return { delivery: "standard", words, pause: null, textSent: text, settings: { ...preset } };
  }
  const { text: textSent, pause } = shortQuestionText(text);
  return { delivery: "short", words, pause, textSent, settings: { ...preset, speed: INT_SHORT_QUESTION.speed } };
}

// Per-voice, per-clip delivery (config.js INT_TAG_POLICY / INT_CLIP_OVERRIDES).
// Returns clipDelivery's fields plus seed, policy ({ breakTime, status, note }
// or null), override (or null) and confirmation:
//   confirmed - the setting was chosen by listening on this voice and type
//   decided   - JC chose it (long stems keep the preset; NA_M "Why?" untagged)
//   override  - a per-clip override with its reason
//   default   - "default applied, not individually confirmed" (JC 2026-09-16):
//               policy status default/inferred/untested, short stems with no
//               clause break (speed 0.92 only), and intros (preset, not heard)
// `blocked` is set when the policy is unresolved and no override covers the clip.
function resolveClipDelivery(
  { itemId, clip, text, voiceConstant },
  { policies = INT_TAG_POLICY, overrides = INT_CLIP_OVERRIDES, seed = TTS_SEED } = {}
) {
  const base = clipDelivery(clip, text);
  const override = overrides[`${itemId}:${clip}`] ?? null;
  if (override && !override.reason) throw new Error(`override ${itemId}:${clip} has no reason`);
  const out = { ...base, seed: override?.seed ?? seed, policy: null, override, blocked: null };
  if (override) {
    out.confirmation = "override";
    out.confirmationNote = override.reason;
  } else if (clip === "intro") {
    out.confirmation = "default";
    out.confirmationNote = "intro: toefl_int_interviewer preset; intros were not listened to";
  } else if (base.delivery !== "short") {
    out.confirmation = "decided";
    out.confirmationNote = "long stem: preset unchanged (JC 2026-09-16)";
  }
  if (base.delivery !== "short") return out;

  const slot = voiceConstant.replace(/^TOEFL_TTS_VOICE_/, "");
  const policy = base.pause ? policies[slot]?.[base.pause] : null;
  if (base.pause && !policy) throw new Error(`no INT_TAG_POLICY for ${slot}.${base.pause}`);
  out.policy = policy;

  const hasBreak = override && "breakTime" in override;
  const breakTime = hasBreak ? override.breakTime : policy?.breakTime ?? null;
  if (base.pause) {
    out.textSent = breakTime ? shortQuestionText(text, breakTime).text : text;
  }
  out.breakTime = base.pause ? breakTime : null;
  if (policy?.status === "unresolved" && !override) {
    out.blocked = `${slot} ${base.pause} policy is unresolved: ${policy.note}`;
  }
  if (!override) {
    if (!base.pause) {
      out.confirmation = "default";
      out.confirmationNote = `short stem with no clause break: speed ${INT_SHORT_QUESTION.speed}, no tag; not listened to per voice`;
    } else if (policy.status === "confirmed" || policy.status === "decided") {
      out.confirmation = policy.status;
      out.confirmationNote = `${slot} ${base.pause}: ${policy.note}`;
    } else {
      out.confirmation = "default";
      out.confirmationNote = `${slot} ${base.pause} (${policy.status}): ${policy.note}`;
    }
  }
  return out;
}

// "Female, UK accent — single consistent voice across all 4 questions"
function parseVoiceProfile(raw) {
  const m = /^\s*(Female|Male)\s*,\s*(North American|UK|Australian|New Zealand)\s+accent\b/i.exec(raw || "");
  if (!m) throw new Error(`unrecognised SPEAKER VOICE PROFILE: ${JSON.stringify(raw)}`);
  return { gender: GENDER_CODES[m[1].toLowerCase()], accent: ACCENT_CODES[m[2].toLowerCase()] };
}

// Text between a bold label line and the next bold label (not a **Qn** header)
// or a --- rule. Same boundaries as importToeflCorpus.js boldBlock().
function boldBlock(body, label) {
  const re = new RegExp(
    `^\\*\\*${label}:\\*\\*[^\\n]*\\n([\\s\\S]*?)(?=\\n\\*\\*(?!Q\\d)[A-Z][^\\n]*:\\*\\*|\\n---|(?![\\s\\S]))`,
    "m"
  );
  const m = re.exec(body);
  if (!m) throw new Error(`no **${label}:** block`);
  return m[1].trim();
}

function parseIntLayer1(body) {
  const profile = /^\*\*SPEAKER VOICE PROFILE:\*\*\s*(.*)$/m.exec(body);
  if (!profile) throw new Error("no **SPEAKER VOICE PROFILE:** line");
  const contextSentence = collapse(boldBlock(body, "INTERVIEW CONTEXT"));
  if (!contextSentence) throw new Error("empty INTERVIEW CONTEXT");

  const section = boldBlock(body, "QUESTIONS");
  const headers = [...section.matchAll(/^\*\*Q(\d+)\s*(?:\[[^\]]*\])?:\*\*\s*$/gm)];
  if (headers.length !== 4) throw new Error(`expected 4 questions, found ${headers.length}`);
  const stems = headers.map((h, i) => {
    const end = i + 1 < headers.length ? headers[i + 1].index : section.length;
    const chunk = section.slice(h.index + h[0].length, end);
    const stem = /^Stem:\s*(.*)$/m.exec(chunk);
    if (!stem || !collapse(stem[1])) throw new Error(`Q${h[1]} has no Stem:`);
    if (Number(h[1]) !== i + 1) throw new Error(`question headers out of order at Q${h[1]}`);
    return collapse(stem[1]);
  });

  return { voice: parseVoiceProfile(profile[1]), contextSentence, stems };
}

function readStatus(dir, itemId) {
  for (const name of ["STATUS.txt", `STATUS_${itemId}.txt`, `${itemId}_STATUS.txt`]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  return null;
}

const statusField = (text, re) => {
  const m = re.exec(text);
  return m ? m[1].trim() : null;
};

// Returns { items, excluded }. Each item: { itemId, voice, voiceConstant, clips }.
// `resolveOptions` is passed to resolveClipDelivery (tests inject policies).
function buildIntPlan(corpusRoot, { only = null, resolveOptions = {} } = {}) {
  const base = path.join(corpusRoot, INT_FOLDER);
  const items = [];
  const excluded = [];
  const dirs = fs
    .readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^INT-\d+$/.test(e.name))
    .map((e) => e.name)
    .sort();

  for (const itemId of dirs) {
    if (only && !only.includes(itemId)) continue;
    const dir = path.join(base, itemId);
    const skip = (reason) => excluded.push({ itemId, reason });

    const layer1Path = path.join(dir, `${itemId}_layer1_generation.md`);
    if (!fs.existsSync(layer1Path)) { skip("no layer1 file"); continue; }
    const status = readStatus(dir, itemId);
    if (status === null) { skip("no STATUS file"); continue; }

    const layer2 = statusField(status, /^LAYER 2[^:]*:\s*(.*)$/im);
    if (!layer2 || !/^PASS\b/i.test(layer2)) { skip(`LAYER 2 verdict: ${layer2 ?? "missing"}`); continue; }
    const crossModel = statusField(status, /^CROSS-MODEL CHECK:\s*(.*)$/im);
    if (crossModel && !/^PASS\b/i.test(crossModel)) { skip(`CROSS-MODEL CHECK: ${crossModel}`); continue; }

    let parsed;
    try {
      parsed = parseIntLayer1(fs.readFileSync(layer1Path, "utf8"));
      const statusProfile = statusField(status, /^SPEAKER VOICE PROFILE:\s*(.*)$/im);
      if (statusProfile) {
        const sv = parseVoiceProfile(statusProfile);
        if (sv.gender !== parsed.voice.gender || sv.accent !== parsed.voice.accent) {
          throw new Error(
            `voice mismatch: layer1 ${parsed.voice.gender}/${parsed.voice.accent}, STATUS ${sv.gender}/${sv.accent}`
          );
        }
      }
    } catch (err) {
      skip(err.message);
      continue;
    }

    const texts = [["intro", parsed.contextSentence], ...parsed.stems.map((s, i) => [`q${i + 1}`, s])];
    const voiceConstant = voiceConstantFor(parsed.voice.accent, parsed.voice.gender);
    items.push({
      itemId,
      voice: parsed.voice,
      voiceConstant,
      preset: PRESET,
      clips: texts.map(([clip, text]) => ({
        clip,
        file: path.join("int", itemId, `${itemId}_${clip}.mp3`),
        text,
        textSha256: sha256(text),
        ...resolveClipDelivery({ itemId, clip, text, voiceConstant }, resolveOptions),
      })),
    });
  }

  if (only) {
    for (const id of only) {
      if (!dirs.includes(id)) excluded.push({ itemId: id, reason: "no such item folder" });
    }
  }
  return { items, excluded };
}

module.exports = {
  PRESET,
  parseVoiceProfile,
  parseIntLayer1,
  buildIntPlan,
  countWords,
  shortQuestionText,
  clipDelivery,
  resolveClipDelivery,
  sha256,
};
