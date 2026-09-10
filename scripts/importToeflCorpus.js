#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// B10-PP · scripts/importToeflCorpus.js
// TOEFL corpus → Firestore importer.
//
// Governing docs:
//   · TOEFL_Import_Script_Spec_v1_11.md  (~/toefl/build/) — script behaviour
//   · TOEFL_Firestore_Data_Model_Spec_v1_17.md — field shapes, Collection 1
//       and the answerKey subcollection
//   · toefl_week_map_v1_0.json (toefl-corpus) — sole scheduling authority
//
// Built per v1.11 plus the four decisions JC confirmed Sep 10, 2026:
//   1. AP format grouping is the STRUCTURAL result, not v1.11's descriptive
//      list: true-old = AP-001..004, middle = AP-005/006/007/010/012/019,
//      current = the remaining 20. Corpus re-ran ap_gate.py against
//      003/004/006 and confirmed independently. v1.11's prose list is wrong;
//      the detection logic it describes is right.
//   2. Active-pool filter (AP_Active_Pool_IDs_2026-09-07.txt) is NOT applied
//      here — import all 5 questions per item. Corpus investigates the
//      manifest separately.
//   3. "REVISE RESOLVED" is a terminal pass-equivalent verdict → importable.
//   4. CTW "FLAG (word count)" follows the spec's bucket-and-report rule →
//      reported, not imported, never silently treated as PASS.
// Plus two approved defaults:
//   5. Week-1 picks by sequential ID order.
//   6. Duplicate STATUS files halt only on genuine content difference.
//
// SAFETY. Refuses to touch Firestore unless FIRESTORE_EMULATOR_HOST is set,
// OR --live is passed together with --i-know-this-is-production. Per CLAUDE.md
// the live project carries an active B10-PP student population whose
// non-interruption is a permanent operating constraint. This script never
// deploys anything and never writes outside toeflItems.
//
// Usage:
//   firebase emulators:start --only firestore
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/importToeflCorpus.js --dry-run
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/importToeflCorpus.js
//   ... --type AP            limit to one task type
//   ... --item AP-001        limit to one item
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");
const os = require("os");

const CORPUS_ROOT = path.join(os.homedir(), "toefl", "corpus");
const WEEK_MAP_PATH = path.join(os.homedir(), "toefl-corpus", "toefl_week_map_v1_0.json");

// ── CLI ──────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const OPT = {
  dryRun: argv.includes("--dry-run"),
  live: argv.includes("--live"),
  liveConfirmed: argv.includes("--i-know-this-is-production"),
  type: valueOf("--type"),
  item: valueOf("--item"),
  verbose: argv.includes("--verbose"),
};
function valueOf(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
}

// ── Task-type registry ───────────────────────────────────────────────────────
//
// hasAnswerKey per data model v1.17 + the spec's both-writes check. NOTE on
// LTC: v1.11's both-writes check lists 7 answerKey types and 4 without —
// eleven of twelve. LTC appears in neither column, and the data model's MCQ
// renderer list ("AP, AT, RDL, LCR, LTA") omits it too. But a real LTC file is
// unambiguously MCQ: two questions, four options, a CORRECT marker and an
// ANSWER KEY line. It is therefore treated as MCQ here, WITH an answerKey,
// because the alternative is publishing its correct answers to students. This
// is a spec gap, reported at the end of every run, not a silent choice.

const TYPES = {
  AP:   { folder: "01_academic_passage",       family: "mcq",   week: "ALL_WEEKS", answerKey: true  },
  AT:   { folder: "02_academic_talk",          family: "mcq",   week: "ALL_WEEKS", answerKey: true  },
  INT:  { folder: "03_interview",              family: "cr",    week: "ALL_WEEKS", answerKey: false },
  EM:   { folder: "04_email",                  family: "cr",    week: "ALL_WEEKS", answerKey: false },
  DISC: { folder: "05_discussion",             family: "cr",    week: "ALL_WEEKS", answerKey: false },
  CTW:  { folder: "06_complete_the_words",     family: "ctw",   week: "weekmap",   answerKey: true  },
  LCR:  { folder: "07_listen_choose_response", family: "mcq",   week: "weekmap",   answerKey: true  },
  LTC:  { folder: "08_listen_conversation",    family: "mcq",   week: "weekmap",   answerKey: true  },
  RDL:  { folder: "09_read_daily_life",        family: "mcq",   week: "weekmap",   answerKey: true  },
  LTA:  { folder: "10_listen_announcement",    family: "mcq",   week: "weekmap",   answerKey: true  },
  BAS:  { folder: "11_build_sentence",         family: "bas",   week: "weekmap",   answerKey: true  },
  LAR:  { folder: "12_listen_repeat",          family: "lar",   week: "weekmap",   answerKey: false },
};

const OPTION_IDS = ["opt_a", "opt_b", "opt_c", "opt_d"];

// ── Assertion helpers — the spec's "exactly once or loud failure" rule ───────

class ParseError extends Error {}

function fail(msg) {
  throw new ParseError(msg);
}

// Exactly-once match. Zero matches or two matches are both loud failures,
// never a guess (spec, "Extraction discipline"). This is what makes it safe to
// pattern-match a file whose changelog prose mentions "ANSWER KEY updated"
// conversationally — the conversational mention never has the live format.
function once(text, re, label) {
  const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
  const all = [...text.matchAll(new RegExp(re.source, flags))];
  if (all.length === 0) fail(`no match for ${label}`);
  if (all.length > 1) fail(`${all.length} matches for ${label}, expected exactly 1`);
  return all[0];
}

function optional(text, re) {
  const m = text.match(re);
  return m || null;
}

// Strip the STATUS artifact the spec names: a stray bold marker mid-field.
function clean(s) {
  return String(s == null ? "" : s).replace(/\*\*/g, "").trim();
}

function collapse(s) {
  return clean(s).replace(/[ \t]+/g, " ");
}

// Content blocks are trimmed but NEVER `clean()`ed: clean() strips every `**`,
// which would destroy the `**Qn [tag]:**` question headers and the
// `— **CORRECT**` key marker that the middle-format AP grammar reads. clean()
// is for STATUS field values only, where the stray bold marker is the artifact.
function trimBlock(s) {
  return String(s == null ? "" : s).replace(/^\s+|\s+$/g, "");
}

// ── Discovery ────────────────────────────────────────────────────────────────

// Item folders only. Anything beginning with "_" is excluded: the spec names
// `_archive/` literally, but the real corpus also carries
// `_archive_pre_crosscheck_fix` and `_QUARANTINE_prefix_files_2026-09-06`
// under RDL. A literal "_archive" test would have imported both as items.
function itemDirs(typeFolder) {
  const base = path.join(CORPUS_ROOT, typeFolder);
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => e.name)
    .sort();
}

// STATUS filename varies and must be globbed, never assumed. All three real
// patterns are matched; more than one in a folder is flagged. Per JC's
// approved narrowing: byte-identical copies are a naming artifact and only
// warn; genuinely differing content halts.
function findStatusFile(dir, itemId) {
  const candidates = [`STATUS.txt`, `STATUS_${itemId}.txt`, `${itemId}_STATUS.txt`]
    .map((n) => path.join(dir, n))
    .filter((p) => fs.existsSync(p));

  if (candidates.length === 0) fail(`no STATUS file (tried all three patterns)`);

  if (candidates.length > 1) {
    const bodies = candidates.map((p) => fs.readFileSync(p, "utf8"));
    const allSame = bodies.every((b) => b === bodies[0]);
    if (!allSame) {
      fail(
        `${candidates.length} STATUS files with DIFFERING content: ` +
          candidates.map((p) => path.basename(p)).join(", ")
      );
    }
    return { file: candidates[0], duplicateOf: candidates.map((p) => path.basename(p)) };
  }
  return { file: candidates[0], duplicateOf: null };
}

// ── STATUS parsing — one verdict reader per field vocabulary ─────────────────
//
// Per Standing Rule 22 the field sets are task-type-specific. Two distinct
// vocabularies exist in the real corpus:
//   · AP/AT/INT/EM/DISC — "LAYER 2 (AUTOMATED REVIEW): <verdict>"
//   · CTW/LCR/LTC/BAS/LAR — "Review status: <verdict>"
// A single generic parser returns nothing for 197 of 432 items.

function parseStatus(statusText, taskType) {
  const lines = statusText.split(/\r?\n/);
  const field = (re) => {
    for (const line of lines) {
      const m = line.match(re);
      if (m) return clean(m[1]);
    }
    return null;
  };

  // The gate is the Layer 2 verdict wherever the file has one, per the spec
  // ("the import gate is the Layer 2 verdict"). Fall back to Review status for
  // the five types that carry no Layer 2 field at all.
  //
  // This is NOT a rare edge case: 45 real items across three types carry BOTH
  // fields, and they disagree in every single one — zero agreements corpus-wide.
  //   · INT (15): LAYER 2 PASS / REVIEW STATUS PENDING
  //   · RDL (18): LAYER 2 PASS / REVIEW STATUS PENDING VALIDATION
  //   · LTA (12): LAYER 2 PASS / REVIEW STATUS VALIDATED
  // For INT and RDL that choice is the difference between importing 33 items
  // and skipping them. A parse failure announces itself by blocking the run; a
  // verdict quietly chosen between two disagreeing fields would not — so every
  // dual-field item is recorded and reported, and the consequential ones
  // (where the two fields classify differently) are called out separately.
  const l2Raw = field(/^LAYER 2[^:]*:\s*(.*)$/i);
  const rsRaw = field(/^REVIEW STATUS:\s*(.*)$/i);
  const rawVerdict = l2Raw || rsRaw;
  const verdictSource = l2Raw ? "LAYER 2" : rsRaw ? "REVIEW STATUS" : null;

  let dualField = null;
  if (l2Raw && rsRaw) {
    const a = classifyVerdict(l2Raw);
    const b = classifyVerdict(rsRaw);
    dualField = {
      layer2: a.label,
      reviewStatus: b.label,
      consequential: a.kind !== b.kind,
    };
  }

  const crossModel = field(/^CROSS-MODEL CHECK:\s*(.*)$/i);
  const layer3Raw = field(/^LAYER 3[^:]*:\s*(.*)$/i);
  const r6 = field(/^R6(?: INCLUDED|\/INSERTION-EQUIVALENT INCLUDED)?:\s*(.*)$/i);

  return {
    rawVerdict,
    verdictSource,
    dualField,
    verdict: classifyVerdict(rawVerdict),
    crossModel,
    layer3Status: classifyLayer3(layer3Raw),
    layer3Raw,
    r6Included: r6 ? /^yes\b/i.test(r6) : false,
  };
}

// The import gate. Layer 2 verdict (plus cross-model where the type has one).
// Layer 3 NEVER gates — it rides along in layer3Status, exactly as ISD §8.8
// designed. Anything unrecognised is bucketed and reported, never coerced.
function classifyVerdict(raw) {
  if (!raw) return { kind: "MISSING", label: "no verdict field" };
  const v = clean(raw);

  // Decision 3: "REVISE RESOLVED" is terminal and pass-equivalent. Checked
  // BEFORE plain REVISE — a prefix test on "REVISE" would skip six AP items
  // that are substantively resolved and carry CROSS-MODEL CHECK: PASS.
  if (/^REVISE\s+RESOLVED\b/i.test(v)) return { kind: "PASS", label: "REVISE RESOLVED" };
  if (/^PASS\b/i.test(v)) return { kind: "PASS", label: "PASS" };
  if (/^VALIDATED\b/i.test(v)) return { kind: "PASS", label: "VALIDATED" };
  if (/^Layer 2 complete\b.*\bVALIDATED\b/i.test(v)) return { kind: "PASS", label: "VALIDATED" };
  if (/^REJECT\b/i.test(v)) return { kind: "REJECT", label: "REJECT" };
  if (/^REVISE\b/i.test(v)) return { kind: "REVISE", label: "REVISE" };
  if (/^FLAG\b/i.test(v)) return { kind: "OTHER", label: v.split(/\s+—|\s+--/)[0] };
  if (/^PENDING\b/i.test(v)) return { kind: "OTHER", label: v.split(/\s+—|\s+--/)[0] };
  return { kind: "OTHER", label: v.slice(0, 40) };
}

function classifyLayer3(raw) {
  if (!raw) return "pending";
  if (/^REVIEWED\b|^ACCEPT\b/i.test(clean(raw))) return "reviewed";
  if (/^SAMPLED\b/i.test(clean(raw))) return "sampled";
  return "pending";
}

// ── contentSpecVersion — provenance, never guessed ───────────────────────────

// Two citation forms exist in the real corpus, and the split is not cosmetic:
//   · modern:  `Email_Content_Spec_v1_4.md`     — version inside the filename
//   · legacy:  `Email_Content_Spec.md v1.3`     — version after .md, space-separated
// Matching only the modern form dropped the version for all 9 importable EM
// items (EM-002..010 are entirely legacy-form; the 14 modern-form EM files are
// the ones gated out as PENDING). Both are a version the file actually states,
// so reading either is provenance, not a guess. A file that states none still
// yields "" — left blank rather than backfilled incorrectly.
function extractContentSpecVersion(body) {
  const m = body.match(/([A-Za-z]+(?:_[A-Za-z]+)*_Content_Spec)(?:\.md)?[_ ]v(\d+[._]\d+)/);
  if (!m) return "";
  return `${m[1]}_v${m[2].replace(".", "_")}`;
}

// ── Section extraction ───────────────────────────────────────────────────────

// Grab the body of a bold-inline labelled block, up to the next bold label,
// horizontal rule, or heading.
function boldBlock(body, label, out) {
  // Boundary notes. (1) `$` is NOT usable as "end of input" here: the `m` flag
  // makes it match every line end, which truncated every block at its first
  // newline. `(?![\\s\\S])` is end-of-input regardless of flags. (2) The
  // next-bold-label boundary must exclude `**Qn ...:**` question headers, or
  // the QUESTIONS block ends at its own first question.
  const re = new RegExp(
    `^\\*\\*${label}(?:\\s*\\(([^)]*)\\))?:\\*\\*[^\\n]*\\n([\\s\\S]*?)` +
      `(?=\\n\\*\\*(?!Q\\d)[A-Z][^\\n]*:\\*\\*|\\n---|\\n#{2,}\\s|(?![\\s\\S]))`,
    "m"
  );
  const m = once(body, re, `**${label}:**`);
  // The label's optional parenthetical is captured, not just tolerated:
  // DISC's named-peer variant carries the poster's name there
  // (`**STUDENT POST A (Sofia):**`), and the Discussion scoring prompt's input
  // contract asks for that name explicitly ("with the poster's name if the
  // item gives one, otherwise 'unnamed'"). Callers that don't care ignore it.
  if (out && typeof out === "object") out.paren = m[1] ? clean(m[1]) : null;
  return trimBlock(m[2]);
}

// Grab the body under a `## HEADING`, up to the next `##`.
function headingBlock(body, heading) {
  const re = new RegExp(`^##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|(?![\\s\\S]))`, "m");
  const m = once(body, re, `## ${heading}`);
  return trimBlock(m[1]);
}

// Grab the body under a bare `LABEL:` line (RDL/LTA/LTC/CTW style), up to the
// next ALL-CAPS label line or rule.
function plainBlock(body, label) {
  const re = new RegExp(
    `^${label}(?:\\s*\\([^)]*\\))?:[^\\n]*\\n([\\s\\S]*?)` +
      `(?=\\n[A-Z][A-Z0-9 /()'\`-]{3,}:|\\n---|(?![\\s\\S]))`,
    "m"
  );
  const m = once(body, re, `${label}:`);
  return trimBlock(m[1]);
}

// ── AP three-way format detection ────────────────────────────────────────────
//
// Structural, in the spec's stated order, never a hardcoded ID list. A list
// breaks silently the first time an item is regenerated into a newer format;
// the heading check stays correct as the corpus evolves. Note that bold-inline
// `**PASSAGE TEXT:**` is present in BOTH the middle and current formats, so
// check order is what separates them — not the bold marker alone.
function detectApFormat(body) {
  if (/^## PASSAGE TEXT\s*$/m.test(body)) return "ap_old";
  if (/^## PARAMETERS\s*$/m.test(body)) return "ap_middle";
  if (/^\*\*PASSAGE TEXT:\*\*/m.test(body)) return "ap_current";
  fail("AP format undetectable: no ## PASSAGE TEXT, no ## PARAMETERS, no **PASSAGE TEXT:**");
}

// ── Option-line grammars ─────────────────────────────────────────────────────
//
// Five genuinely distinct grammars across the corpus. Each returns
// {letter, text, tag} where tag === "CORRECT" marks the key.

const OPTION_GRAMMARS = {
  // AP true-old: `(A) competitive` + `Rationale: D2 (...) — ...`
  // The distractor type lives on the Rationale line, not the option line.
  ap_old: (line) => {
    const m = line.match(/^\(([A-D])\)\s+(.*)$/);
    return m ? { letter: m[1], text: clean(m[2]), tag: null } : null;
  },
  // AP middle: `(A) susceptible — **CORRECT**` / `(B) valuable — D2`
  ap_middle: (line) => {
    const m = line.match(/^\(([A-D])\)\s+(.*?)\s+—\s+(.+)$/);
    if (!m) return null;
    const tag = clean(m[3]);
    return { letter: m[1], text: clean(m[2]), tag: /^CORRECT$/i.test(tag) ? "CORRECT" : tag };
  },
  // AP current + AT: `(A) [D2] limit` / `(B) [CORRECT] check` /
  // `(B) [D1 — True but Peripheral] text`
  bracket: (line) => {
    const m = line.match(/^\(([A-D])\)\s+\[([^\]]+)\]\s+(.*)$/);
    if (!m) return null;
    const tag = clean(m[2]);
    return {
      letter: m[1],
      text: clean(m[3]),
      tag: /^CORRECT$/i.test(tag) ? "CORRECT" : tag,
    };
  },
  // AT, later items: `(A) text — [CORRECT]` / `(A) text — [D1 — True but
  // Peripheral]`. Same information as `bracket`, tag moved to the end. Real
  // and current, not historical: AT-021..030 use it while AT-001..020 use the
  // prefix form, so AT needs both tried per question.
  bracket_suffix: (line) => {
    const m = line.match(/^\(([A-D])\)\s+(.*?)\s+—\s+\[([^\]]+)\]\s*$/);
    if (!m) return null;
    const tag = clean(m[3]);
    return { letter: m[1], text: clean(m[2]), tag: /^CORRECT$/i.test(tag) ? "CORRECT" : tag };
  },
  // RDL + LTA + LTC: `(A) text -- CORRECT` / `(A) text -- D1`
  dashsuffix: (line) => {
    const m = line.match(/^\(([A-D])\)\s+(.*?)\s+--\s+(.+)$/);
    if (!m) return null;
    const tag = clean(m[3]);
    return { letter: m[1], text: clean(m[2]), tag: /^CORRECT$/i.test(tag) ? "CORRECT" : tag };
  },
  // LCR: `- A. "text" (7 words) — PF2` / `- B. "text" (7 words) — **KEY**`
  lcr: (line) => {
    const m = line.match(/^-\s+([A-D])\.\s+"([^"]*)"[^—]*—\s*(.+)$/);
    if (!m) return null;
    const tag = clean(m[3]);
    return { letter: m[1], text: clean(m[2]), tag: /^KEY$/i.test(tag) ? "CORRECT" : tag };
  },
};

// ── MCQ question-block parsing ───────────────────────────────────────────────
//
// Two question frames, five option grammars, one assembler.
//   frame "stem-line": `**Q1 [R3]:**` / `Stem: ...` / four options  (AP, AT)
//   frame "inline":    `Q1: <stem>` / four options                  (RDL/LTA/LTC)
//   frame "single":    the prompt transcript IS the stem            (LCR)

function parseQuestionsStemLine(section, grammar, itemId) {
  const blocks = [...section.matchAll(/^\*\*Q(\d+)\s*(?:\[[^\]]*\])?:\*\*\s*$/gm)];
  if (blocks.length === 0) fail("no **Qn [...]:** question headers found");

  const questions = [];
  for (let i = 0; i < blocks.length; i++) {
    const start = blocks[i].index + blocks[i][0].length;
    const end = i + 1 < blocks.length ? blocks[i + 1].index : section.length;
    const chunk = section.slice(start, end);
    const qNum = Number(blocks[i][1]);

    const stemM = once(chunk, /^Stem:\s*(.*)$/m, `Q${qNum} Stem:`);
    questions.push(assembleQuestion(qNum, collapse(stemM[1]), chunk, grammar, itemId));
  }
  return questions;
}

function parseQuestionsInline(section, grammar, itemId) {
  const blocks = [...section.matchAll(/^Q(\d+):\s*(.+)$/gm)];
  if (blocks.length === 0) fail("no `Qn: <stem>` question headers found");

  const questions = [];
  for (let i = 0; i < blocks.length; i++) {
    const start = blocks[i].index + blocks[i][0].length;
    const end = i + 1 < blocks.length ? blocks[i + 1].index : section.length;
    const chunk = section.slice(start, end);
    questions.push(
      assembleQuestion(Number(blocks[i][1]), collapse(blocks[i][2]), chunk, grammar, itemId)
    );
  }
  return questions;
}

// Options are read in the order they appear and assigned opt_a..opt_d in that
// same order, regardless of which letter the source marked correct. The
// corpus's original A/B/C/D label deliberately does not survive import as
// anything meaningful — the display letter is reassigned by the client's
// shuffle at delivery time (data model v1.17, "Answer-key and permutation").
function assembleQuestion(questionIndex, stem, chunk, grammarSpec, itemId) {
  // A type may legitimately carry more than one option grammar across its own
  // corpus (AT does: prefix-bracket in AT-001..020, suffix-bracket in
  // AT-021..030). Candidates are tried in order and the first that yields a
  // well-formed question wins. This stays a structural decision driven by the
  // file's real content — never a hardcoded item-ID list, which would break
  // the first time an item is regenerated into a different form.
  const candidates = Array.isArray(grammarSpec) ? grammarSpec : [grammarSpec];
  const attempts = [];
  for (const name of candidates) {
    try {
      return assembleWithGrammar(questionIndex, stem, chunk, name);
    } catch (err) {
      if (!(err instanceof ParseError)) throw err;
      attempts.push(`${name}: ${err.message}`);
    }
  }
  fail(
    candidates.length === 1
      ? attempts[0]
      : `Q${questionIndex}: no option grammar matched — ${attempts.join(" | ")}`
  );
}

function assembleWithGrammar(questionIndex, stem, chunk, grammarName) {
  const grammar = OPTION_GRAMMARS[grammarName];
  const lines = chunk.split(/\r?\n/);

  const parsed = [];
  for (let i = 0; i < lines.length; i++) {
    const opt = grammar(lines[i].trim());
    if (!opt) continue;

    // The Rationale line, where the grammar has one, is the next line that
    // starts with "Rationale:".
    let rationale = "";
    for (let j = i + 1; j < lines.length && j <= i + 2; j++) {
      const rm = lines[j].match(/^Rationale:\s*(.*)$/);
      if (rm) {
        rationale = collapse(rm[1]);
        break;
      }
    }

    // ap_old carries the distractor type / CORRECT marker on the Rationale
    // line instead of the option line.
    let tag = opt.tag;
    if (grammarName === "ap_old") {
      const tm = rationale.match(/^(CORRECT|D\d|CF-[A-Z]|[A-Z]{1,3}\d?)\b/i);
      tag = tm ? (/^CORRECT$/i.test(tm[1]) ? "CORRECT" : tm[1]) : null;
    }

    parsed.push({ ...opt, tag, rationale });
  }

  if (parsed.length !== 4) {
    fail(`Q${questionIndex}: found ${parsed.length} option lines, expected exactly 4`);
  }

  const correctPositions = parsed
    .map((o, idx) => (o.tag === "CORRECT" ? idx : -1))
    .filter((idx) => idx >= 0);
  if (correctPositions.length !== 1) {
    fail(
      `Q${questionIndex}: ${correctPositions.length} options marked CORRECT, expected exactly 1`
    );
  }

  const options = parsed.map((o, idx) => ({ optionId: OPTION_IDS[idx], text: o.text }));
  const rationales = parsed.map((o, idx) => ({
    optionId: OPTION_IDS[idx],
    rationale: o.rationale,
  }));

  return {
    questionIndex,
    stem,
    options,
    correctOptionId: OPTION_IDS[correctPositions[0]],
    rationales,
    sourceLetters: parsed.map((o) => o.letter).join(""),
  };
}

// ── Per-type content parsers ─────────────────────────────────────────────────

const PARSERS = {
  AP(body, ctx) {
    const format = detectApFormat(body);
    ctx.format = format;

    let passageText, questionSection;
    if (format === "ap_old") {
      passageText = headingBlock(body, "PASSAGE TEXT");
      questionSection = headingBlock(body, "QUESTIONS AND ANSWER KEY");
    } else if (format === "ap_middle") {
      passageText = boldBlock(body, "PASSAGE TEXT");
      questionSection = headingBlock(body, "QUESTIONS");
    } else {
      passageText = boldBlock(body, "PASSAGE TEXT");
      questionSection = boldBlock(body, "QUESTIONS");
    }

    const grammar =
      format === "ap_old"
        ? ["ap_old"]
        : format === "ap_middle"
        ? ["ap_middle"]
        : ["bracket", "bracket_suffix"];
    const questions = parseQuestionsStemLine(questionSection, grammar, ctx.itemId);
    if (questions.length !== 5) {
      fail(`AP must have exactly 5 questions, found ${questions.length}`);
    }

    return {
      stimulus: { passageText, wordCount: wordCount(passageText) },
      questions,
    };
  },

  AT(body, ctx) {
    const transcriptText = boldBlock(body, "TRANSCRIPT");
    const questions = parseQuestionsStemLine(
      boldBlock(body, "QUESTIONS"),
      ["bracket", "bracket_suffix"],
      ctx.itemId
    );
    if (questions.length !== 4) {
      fail(`AT must have exactly 4 questions, found ${questions.length}`);
    }
    return {
      stimulus: { transcriptText, speakerCount: 1 },
      questions,
    };
  },

  RDL(body, ctx) {
    const passageText = plainBlock(body, "TEXT");
    const questions = parseQuestionsInline(sliceQuestions(body), "dashsuffix", ctx.itemId);
    return { stimulus: { passageText }, questions };
  },

  LTA(body, ctx) {
    const talkText = plainBlock(body, "ANNOUNCEMENT TEXT");
    const questions = parseQuestionsInline(sliceQuestions(body), "dashsuffix", ctx.itemId);
    return { stimulus: { talkText }, questions };
  },

  LTC(body, ctx) {
    const dialogueText = plainBlock(body, "CONVERSATION TEXT");
    const speakers = [...dialogueText.matchAll(/^\[([^\]]+)\]:/gm)].map((m) => m[1]);
    const unique = [...new Set(speakers)];
    if (unique.length !== 2) {
      fail(`LTC expects exactly 2 speakers, found ${unique.length}: ${unique.join(", ")}`);
    }
    const questions = parseQuestionsInline(sliceQuestions(body), "dashsuffix", ctx.itemId);
    return {
      stimulus: { dialogueText, speakerA: unique[0], speakerB: unique[1] },
      questions,
    };
  },

  // LCR is a one-question MCQ whose stem IS the spoken prompt. Options live in
  // an `**OPTIONS A–D**` bullet list; rationales live in a separate
  // LURE/FAILURE block keyed by letter, and the KEY option has no rationale
  // there at all — a real source-content gap, reported rather than invented.
  LCR(body, ctx) {
    const promptM = once(body, /^\*\*PROMPT TRANSCRIPT:\*\*\s*(.*)$/m, "**PROMPT TRANSCRIPT:**");
    const stem = collapse(promptM[1].replace(/^"|"$/g, ""));

    const optM = once(
      body,
      /^\*\*OPTIONS A[–-]D\*\*\s*\n([\s\S]*?)(?=\n\*\*|\n---|(?![\s\S]))/m,
      "**OPTIONS A–D**"
    );
    const parsed = optM[1]
      .split(/\r?\n/)
      .map((l) => OPTION_GRAMMARS.lcr(l.trim()))
      .filter(Boolean);
    if (parsed.length !== 4) {
      fail(`LCR: found ${parsed.length} option bullets, expected exactly 4`);
    }
    const correct = parsed.filter((o) => o.tag === "CORRECT");
    if (correct.length !== 1) {
      fail(`LCR: ${correct.length} options marked **KEY**, expected exactly 1`);
    }

    // Rationales, where present, from the LURE/FAILURE RATIONALES block.
    const lureBlock = optional(
      body,
      /^\*\*LURE\/FAILURE RATIONALES\*\*\s*\n([\s\S]*?)(?=\n\*\*|\n---|(?![\s\S]))/m
    );
    const byLetter = {};
    if (lureBlock) {
      for (const m of lureBlock[1].matchAll(/^-\s+([A-D])\s*\([^)]*\):\s*(.*)$/gm)) {
        byLetter[m[1]] = collapse(m[2]);
      }
    }

    const options = parsed.map((o, i) => ({ optionId: OPTION_IDS[i], text: o.text }));
    const rationales = parsed.map((o, i) => ({
      optionId: OPTION_IDS[i],
      rationale: byLetter[o.letter] || "",
    }));
    const correctOptionId = OPTION_IDS[parsed.findIndex((o) => o.tag === "CORRECT")];

    if (!byLetter[parsed.find((o) => o.tag === "CORRECT").letter]) {
      ctx.notes.push("LCR key option has no rationale in source (LURE/FAILURE block omits it)");
    }

    return {
      stimulus: { dialogueText: stem },
      questions: [
        { questionIndex: 1, stem, options, correctOptionId, rationales, sourceLetters: "ABCD" },
      ],
    };
  },

  CTW(body, ctx) {
    const passageWithGaps = plainBlock(body, "PASSAGE TEXT");

    // Gaps are words carrying a trailing underscore run: `confid___` → the
    // student sees "confid" and supplies "ent".
    const gapMatches = [...passageWithGaps.matchAll(/([A-Za-z]+)(_+)/g)];
    if (gapMatches.length !== 10) {
      fail(`CTW must have exactly 10 gaps, found ${gapMatches.length}`);
    }

    const keySection = plainBlock(body, "ANSWER KEY");
    const keyed = [...keySection.matchAll(/^Q(\d+):\s*(\S+)\s*$/gm)];
    if (keyed.length !== 10) {
      fail(`CTW ANSWER KEY must have exactly 10 entries, found ${keyed.length}`);
    }

    const gaps = gapMatches.map((m, i) => ({ gapIndex: i + 1, givenLetters: m[1] }));
    const keyGaps = keyed.map((m) => ({
      gapIndex: Number(m[1]),
      correctCompletion: clean(m[2]),
    }));
    for (const g of keyGaps) {
      if (!g.correctCompletion) fail(`CTW gap ${g.gapIndex} has an empty completion`);
    }

    return {
      stimulus: { passageWithGaps, gapCount: 10 },
      gaps,
      keyGaps,
    };
  },

  // BAS's key is "which chunks, in which order" — distractor chunks belong
  // nowhere in the sentence, so correctOrder is derived by consuming the
  // target sentence left-to-right, longest chunk first at each position.
  BAS(body, ctx) {
    const chunksM = once(
      body,
      /^CHUNKS PROVIDED[^\n]*:\s*\n(.+)$/m,
      "CHUNKS PROVIDED (scrambled order):"
    );
    const fragmentsRaw = chunksM[1]
      .split("|")
      .map((s) => clean(s))
      .filter(Boolean);
    if (fragmentsRaw.length < 4) {
      fail(`BAS: only ${fragmentsRaw.length} chunks parsed, expected 6-8`);
    }

    const targetM = once(body, /^TARGET SENTENCE:\s*(.+)$/m, "TARGET SENTENCE:");
    const target = collapse(targetM[1]);

    const correctOrder = solveChunkOrder(fragmentsRaw, target);

    const fragments = fragmentsRaw.map((text, i) => ({ fragmentIndex: i, text }));
    const unused = fragments.filter((f) => !correctOrder.includes(f.fragmentIndex));

    // Cross-check against the declared DISTRACTOR CHUNK line, where one
    // exists. A mismatch is reported, not silently accepted.
    const distM = optional(body, /^DISTRACTOR CHUNK:\s*(.+)$/m);
    if (distM) {
      const declared = clean(distM[1].split(/\s+—|\s+--/)[0]);
      const unusedTexts = unused.map((u) => u.text);
      if (declared && !/^none\b/i.test(declared) && !unusedTexts.includes(declared)) {
        ctx.notes.push(
          `BAS distractor mismatch: file declares "${declared}", ` +
            `order leaves [${unusedTexts.join(", ")}] unused`
        );
      }
    }

    return { stimulus: {}, fragments, correctOrder, distractorCount: unused.length };
  },

  LAR(body, ctx) {
    const setM = once(body, /^UTTERANCE SET[^\n]*:\s*\n([\s\S]*?)(?=\n---|\nWORD COUNT)/m, "UTTERANCE SET");
    const section = setM[1];

    const PART_NAMES = { 1: "greeting", 2: "facilities", 3: "services", 4: "closing" };
    const partHeaders = [...section.matchAll(/^Part\s+(\d)\s*--\s*[^\n]*:\s*$/gm)];
    if (partHeaders.length !== 4) {
      fail(`LAR must have all 4 part headers, found ${partHeaders.length}`);
    }

    const utterances = [];
    for (let i = 0; i < partHeaders.length; i++) {
      const partNum = Number(partHeaders[i][1]);
      const start = partHeaders[i].index + partHeaders[i][0].length;
      const end = i + 1 < partHeaders.length ? partHeaders[i + 1].index : section.length;
      const lines = section
        .slice(start, end)
        .split(/\r?\n/)
        .map((l) => clean(l))
        .filter(Boolean);
      for (const text of lines) {
        utterances.push({ utteranceIndex: utterances.length + 1, text, part: PART_NAMES[partNum] });
      }
    }

    if (utterances.length !== 7) {
      fail(`LAR must have exactly 7 utterances, found ${utterances.length}`);
    }
    const partsSeen = new Set(utterances.map((u) => u.part));
    if (partsSeen.size !== 4) {
      fail(`LAR must represent all 4 parts, found ${[...partsSeen].join(", ")}`);
    }

    return { stimulus: {}, utterances };
  },

  INT(body, ctx) {
    const contextSentence = boldBlock(body, "INTERVIEW CONTEXT");
    const section = boldBlock(body, "QUESTIONS");
    // Capturing the bracket tag, not just tolerating it — see questionType below.
    const headers = [...section.matchAll(/^\*\*Q(\d+)\s*(?:\[([^\]]*)\])?:\*\*\s*$/gm)];
    if (headers.length !== 4) {
      fail(`INT must have exactly 4 questions, found ${headers.length}`);
    }
    const questions = [];
    for (let i = 0; i < headers.length; i++) {
      const start = headers[i].index + headers[i][0].length;
      const end = i + 1 < headers.length ? headers[i + 1].index : section.length;
      const chunk = section.slice(start, end);
      const stemM = once(chunk, /^Stem:\s*(.*)$/m, `INT Q${headers[i][1]} Stem:`);

      // questionType is the raw corpus tag from the `**Qn [...]:**` header,
      // stored verbatim rather than pre-mapped. The Interview scoring prompt's
      // input contract wants one of four enum values (Descriptive,
      // Preference-Reason, Trend-Evaluation, Prediction-Hypothesis) and the
      // corpus tags are richer than that ("Preference + Reason — B2+",
      // "Descriptive/Observational — B2 accessible — Indirect framing").
      // Mapping is the scoring branch's job, where it can be cross-checked
      // against position and logged; the importer's job is provenance, so it
      // keeps what the file actually says. null when the header carries no tag.
      questions.push({
        questionIndex: Number(headers[i][1]),
        stem: collapse(stemM[1]),
        questionType: headers[i][2] ? collapse(headers[i][2]) : null,
      });
    }
    return {
      stimulus: { contextSentence },
      prompt: { questions },
    };
  },

  EM(body, ctx) {
    const scenarioText = boldBlock(body, "SCENARIO TEXT");
    const relM = once(body, /^\*\*RELATIONSHIP TYPE:\*\*\s*(.*)$/m, "**RELATIONSHIP TYPE:**");
    const bullets = boldBlock(body, "THREE BULLET POINTS")
      .split(/\r?\n/)
      .map((l) => l.match(/^\d+\.\s*(.*)$/))
      .filter(Boolean)
      .map((m) => collapse(m[1]));
    if (bullets.length !== 3) {
      fail(`EM must have exactly 3 bullet points, found ${bullets.length}`);
    }
    const header = boldBlock(body, "PRE-FILLED HEADER");
    const toM = once(header, /^To:\s*(.*)$/m, "EM header To:");
    const subjM = once(header, /^Subject:\s*(.*)$/m, "EM header Subject:");

    return {
      stimulus: { scenarioText, recipientContext: null },
      prompt: {
        relationshipType: collapse(relM[1]),
        requiredElements: bullets,
        header: {
          to: collapse(toM[1]),
          subject: collapse(subjM[1].replace(/\s*\(\d+\s+words[^)]*\)\s*$/, "")),
        },
      },
    };
  },

  DISC(body, ctx) {
    const professorPrompt = boldBlock(body, "PROFESSOR PROMPT");
    const aOut = {};
    const bOut = {};
    const postA = boldBlock(body, "STUDENT POST A", aOut);
    const postB = boldBlock(body, "STUDENT POST B", bOut);
    const debateM = optional(body, /^\*\*DEBATE TYPE:\*\*\s*(.*)$/m);

    // peerName is null when the item leaves its peers unnamed — the majority
    // case (26 of 30 items). It is NOT defaulted to a string here: the
    // scoring prompt's contract distinguishes a real name from "unnamed", and
    // rendering that distinction is the trigger's job, not the importer's.
    return {
      stimulus: {
        professorPrompt,
        peerResponses: [
          { label: "A", peerName: aOut.paren || null, text: postA },
          { label: "B", peerName: bOut.paren || null, text: postB },
        ],
      },
      prompt: {
        debateType: debateM ? collapse(debateM[1]) : "",
        peerResponseCount: 2,
      },
    };
  },
};

// Questions for the inline-frame types start at the first `Qn:` line and run to
// the ANSWER KEY line. Bounding it this way keeps changelog prose out.
function sliceQuestions(body) {
  const startM = once(body, /^Q1:\s*.+$/m, "Q1: (first question)");
  const rest = body.slice(startM.index);
  const endM = rest.match(/^ANSWER KEY:/m);
  return endM ? rest.slice(0, endM.index) : rest;
}

function wordCount(s) {
  return clean(s).split(/\s+/).filter(Boolean).length;
}

// Greedy longest-first consumption of the target sentence by chunk.
function solveChunkOrder(fragments, target) {
  // Terminal punctuation belongs to the sentence, not to any chunk: BAS targets
  // include questions and exclamations ("...class would last?"), so a
  // period-only strip left "?" unconsumable and failed 18 real items.
  const norm = (s) =>
    s.replace(/\s+/g, " ").replace(/[.?!]+$/, "").trim().toLowerCase();
  const t = norm(target);
  const order = [];
  const used = new Set();
  let pos = 0;

  while (pos < t.length) {
    if (t[pos] === " ") {
      pos++;
      continue;
    }
    const candidates = fragments
      .map((text, idx) => ({ idx, n: norm(text) }))
      .filter((c) => !used.has(c.idx) && c.n && t.startsWith(c.n, pos))
      .sort((a, b) => b.n.length - a.n.length);

    if (candidates.length === 0) {
      fail(
        `BAS: cannot match target sentence at offset ${pos} ("${t.slice(pos, pos + 30)}...") ` +
          `against remaining chunks`
      );
    }
    order.push(candidates[0].idx);
    used.add(candidates[0].idx);
    pos += candidates[0].n.length;
  }
  return order;
}

// ── Week assignment ──────────────────────────────────────────────────────────
//
// The week map is the sole scheduling authority (CLAUDE.md: in-file week
// fields are historical and unused). It encodes AGGREGATE per-week counts, not
// item IDs — its own scopeNote says item-level ordering is JC's call at import
// time. Per approved default 5, items are allocated to weeks in sequential ID
// order following each type's weeklyFreshItemCounts.
//
// Items beyond a type's assigned total are its RESERVE. weekAvailability has
// no legal value meaning "no week yet" (data model v1.17: "1".."12" or
// "ALL_WEEKS"), so reserve items are SKIPPED and reported rather than written
// with an invented enum value. A later run imports them once weeks are set.
function buildWeekAllocation(weekMap) {
  const counts = weekMap.sevenNewerTypes.weeklyFreshItemCounts;
  const alloc = {};
  for (const [type, perWeek] of Object.entries(counts)) {
    if (type.startsWith("_")) continue;
    const seq = [];
    perWeek.forEach((n, wIdx) => {
      for (let i = 0; i < n; i++) seq.push(String(wIdx + 1));
    });
    alloc[type] = seq;
  }
  return alloc;
}

// ── Document assembly ────────────────────────────────────────────────────────

function buildDocuments(taskType, itemId, parsed, status, cfg, weekForItem, contentSpecVersion) {
  const isReject = status.verdict.kind === "REJECT";

  const publicDoc = {
    itemId,
    taskType,
    weekAvailability: cfg.week === "ALL_WEEKS" ? "ALL_WEEKS" : weekForItem,
    status: isReject ? "retired" : "active",
    stimulus: parsed.stimulus || {},
    contentSpecVersion,
    layer3Status: status.layer3Status,
  };

  if (parsed.questions && cfg.family === "mcq") {
    // locked: true for the R6 sentence-insertion question. AP's rule is
    // 100%-confirmed — R6 is always Q5 when present — so this is a mechanical
    // mapping, not an inference. Every other question is false.
    publicDoc.questions = parsed.questions.map((q) => ({
      questionIndex: q.questionIndex,
      stem: q.stem,
      locked: taskType === "AP" && status.r6Included && q.questionIndex === 5,
      options: q.options,
    }));
  }
  if (parsed.prompt) publicDoc.prompt = parsed.prompt;
  if (parsed.utterances) publicDoc.utterances = parsed.utterances;
  if (parsed.gaps) publicDoc.gaps = parsed.gaps;
  if (parsed.fragments) publicDoc.fragments = parsed.fragments;

  let keyDoc = null;
  if (cfg.answerKey) {
    keyDoc = {};
    if (parsed.questions) {
      keyDoc.questions = parsed.questions.map((q) => ({
        questionIndex: q.questionIndex,
        correctOptionId: q.correctOptionId,
        rationales: q.rationales,
      }));
    }
    if (parsed.keyGaps) keyDoc.gaps = parsed.keyGaps;
    if (parsed.correctOrder) keyDoc.correctOrder = parsed.correctOrder;
  }

  return { publicDoc, keyDoc };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  banner();

  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  if (!emulator && !(OPT.live && OPT.liveConfirmed)) {
    console.error(
      "\nREFUSING TO RUN: FIRESTORE_EMULATOR_HOST is not set.\n\n" +
        "The live project carries an active B10-PP student population whose\n" +
        "non-interruption is a permanent operating constraint (CLAUDE.md).\n" +
        "Run against the emulator:\n\n" +
        "  firebase emulators:start --only firestore\n" +
        "  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/importToeflCorpus.js --dry-run\n\n" +
        "A real production import requires BOTH --live and --i-know-this-is-production,\n" +
        "and is JC's call to make, not this script's default.\n"
    );
    process.exit(1);
  }

  const weekMap = JSON.parse(fs.readFileSync(WEEK_MAP_PATH, "utf8"));
  const weekAlloc = buildWeekAllocation(weekMap);

  const types = OPT.type ? [OPT.type] : Object.keys(TYPES);
  for (const t of types) {
    if (!TYPES[t]) {
      console.error(`unknown task type "${t}" — known: ${Object.keys(TYPES).join(", ")}`);
      process.exit(1);
    }
  }

  // ── Phase 1: read and parse everything. No writes yet, per the fail-closed
  // rule — a parse failure anywhere must stop the import before it writes.
  const plan = [];
  const skipped = [];
  const errors = [];
  const notes = [];
  const dualFields = [];
  const perType = {};

  for (const taskType of types) {
    const cfg = TYPES[taskType];
    const dirs = itemDirs(cfg.folder);
    const weekSeq = cfg.week === "weekmap" ? weekAlloc[taskType] || [] : null;

    perType[taskType] = {
      folders: dirs.length,
      imported: 0,
      revise: 0,
      reject: 0,
      other: 0,
      reserve: 0,
      formats: {},
    };

    let passOrdinal = 0; // sequential position among importable items

    for (const itemId of dirs) {
      if (OPT.item && itemId !== OPT.item) continue;

      const dir = path.join(CORPUS_ROOT, cfg.folder, itemId);
      const ctx = { itemId, taskType, notes: [], format: null };

      try {
        const layer1 = path.join(dir, `${itemId}_layer1_generation.md`);
        if (!fs.existsSync(layer1)) fail(`missing ${itemId}_layer1_generation.md`);

        const { file: statusFile, duplicateOf } = findStatusFile(dir, itemId);
        if (duplicateOf) {
          notes.push(`${itemId}: duplicate STATUS files, byte-identical — ${duplicateOf.join(", ")}`);
        }

        const status = parseStatus(fs.readFileSync(statusFile, "utf8"), taskType);
        const body = fs.readFileSync(layer1, "utf8");

        // Record every item whose STATUS carries both verdict fields, so the
        // Layer-2-wins choice is auditable instead of silent.
        if (status.dualField) {
          dualFields.push({ itemId, taskType, ...status.dualField });
        }

        // Gate on the Layer 2 verdict. Layer 3 never gates.
        if (status.verdict.kind === "REVISE") {
          perType[taskType].revise++;
          skipped.push({ itemId, taskType, reason: `REVISE (${status.verdict.label})` });
          continue;
        }
        if (status.verdict.kind === "OTHER") {
          perType[taskType].other++;
          skipped.push({ itemId, taskType, reason: `unrecognised verdict: ${status.verdict.label}` });
          continue;
        }
        if (status.verdict.kind === "MISSING") {
          perType[taskType].other++;
          skipped.push({ itemId, taskType, reason: "no Layer 2 verdict field" });
          continue;
        }

        // A REJECT is imported as retired for audit history, never served.
        const parsed = PARSERS[taskType](body, ctx);
        if (ctx.format) {
          perType[taskType].formats[ctx.format] = (perType[taskType].formats[ctx.format] || 0) + 1;
        }

        let weekForItem = "ALL_WEEKS";
        if (cfg.week === "weekmap") {
          if (status.verdict.kind === "REJECT") {
            weekForItem = null; // retired, never served — no week consumed
          } else if (passOrdinal < weekSeq.length) {
            weekForItem = weekSeq[passOrdinal];
            passOrdinal++;
          } else {
            perType[taskType].reserve++;
            skipped.push({
              itemId,
              taskType,
              reason: `RESERVE — beyond week map's ${weekSeq.length} assigned slots, no week available`,
            });
            continue;
          }
        }
        if (status.verdict.kind === "REJECT") perType[taskType].reject++;

        const contentSpecVersion = extractContentSpecVersion(body);
        const { publicDoc, keyDoc } = buildDocuments(
          taskType,
          itemId,
          parsed,
          status,
          cfg,
          weekForItem === null ? "ALL_WEEKS" : weekForItem,
          contentSpecVersion
        );

        plan.push({ itemId, taskType, dir, cfg, publicDoc, keyDoc, parsed, status });
        perType[taskType].imported++;
        ctx.notes.forEach((n) => notes.push(`${itemId}: ${n}`));
      } catch (err) {
        if (err instanceof ParseError) {
          errors.push({ itemId, taskType, message: err.message });
        } else {
          errors.push({ itemId, taskType, message: `${err.name}: ${err.message}` });
        }
      }
    }
  }

  reportPlan(perType, plan, skipped, notes, errors, dualFields);

  // Fail-closed: nothing is written to Firestore on any parse failure.
  // Partial imports are worse than no import.
  if (errors.length > 0) {
    console.log(
      `\nHALTED — ${errors.length} parse failure(s). Nothing written to Firestore.\n` +
        `Fix the parse or the source, then re-run. Partial imports are worse than no import.\n`
    );
    process.exit(1);
  }

  if (OPT.dryRun) {
    console.log("\nDRY RUN — nothing written. Re-run without --dry-run to import.\n");
    process.exit(0);
  }

  // ── Phase 2: write.
  const admin = require(require.resolve("firebase-admin", {
    paths: [path.join(__dirname, "..", "functions")],
  }));
  const { FieldValue } = require(require.resolve("firebase-admin/firestore", {
    paths: [path.join(__dirname, "..", "functions")],
  }));

  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "b10-practice-platform" });
  }
  const db = admin.firestore();

  console.log(`\nWriting ${plan.length} item(s)${emulator ? ` to emulator ${emulator}` : " LIVE"}...`);

  let written = 0;
  for (const entry of plan) {
    const ref = db.collection("toeflItems").doc(entry.itemId);
    await ref.set({ ...entry.publicDoc, importedAt: FieldValue.serverTimestamp() });
    if (entry.keyDoc) {
      // Literal document ID "key", always — never an auto-ID (data model
      // v1.16 correction), so every reader fetches it directly.
      await ref.collection("answerKey").doc("key").set(entry.keyDoc);
    }
    written++;
    if (OPT.verbose) console.log(`  wrote ${entry.itemId}${entry.keyDoc ? " + answerKey/key" : ""}`);
  }
  console.log(`  ${written} item document(s) written.`);

  // ── Phase 3: both-writes shape check, then the content-verification gate.
  const shapeFindings = await bothWritesCheck(db, plan);
  const contentFindings = await contentVerificationGate(db, plan);

  reportGate(shapeFindings, contentFindings, plan.length);

  if (shapeFindings.length || contentFindings.length) process.exit(1);
  process.exit(0);
}

// ── Both-writes check — SHAPE ────────────────────────────────────────────────
//
// Scoped per v1.5's correction: only the 8 answerKey types must have one; the
// 4 without must NOT have one. Applied blindly this check false-positives on
// every INT/EM/DISC/LAR item. Both directions matter — a missing key breaks
// scoring silently; a spurious key means the branching logic went somewhere it
// shouldn't have.
async function bothWritesCheck(db, plan) {
  const findings = [];
  for (const entry of plan) {
    const ref = db.collection("toeflItems").doc(entry.itemId);
    const pub = await ref.get();
    const key = await ref.collection("answerKey").doc("key").get();

    if (!pub.exists) {
      findings.push({ itemId: entry.itemId, field: "toeflItems", detail: "public document missing" });
      continue;
    }

    if (entry.cfg.answerKey) {
      if (!key.exists) {
        findings.push({ itemId: entry.itemId, field: "answerKey/key", detail: "missing" });
        continue;
      }
      const k = key.data();
      if (entry.publicDoc.questions) {
        if ((k.questions || []).length !== entry.publicDoc.questions.length) {
          findings.push({
            itemId: entry.itemId,
            field: "answerKey.questions.length",
            detail: `${(k.questions || []).length} vs public ${entry.publicDoc.questions.length}`,
          });
        }
        for (const q of k.questions || []) {
          if (!q.correctOptionId) {
            findings.push({
              itemId: entry.itemId,
              field: `answerKey.questions[${q.questionIndex}].correctOptionId`,
              detail: "empty",
            });
          }
          // LCR's key option genuinely has no rationale in the source; that is
          // reported as a note, not asserted here.
          const emptyRationales = (q.rationales || []).filter(
            (r) => !r.rationale && !(entry.taskType === "LCR" && r.optionId === q.correctOptionId)
          );
          for (const r of emptyRationales) {
            findings.push({
              itemId: entry.itemId,
              field: `answerKey.questions[${q.questionIndex}].rationales[${r.optionId}]`,
              detail: "empty rationale string",
            });
          }
        }
      }
      if (entry.publicDoc.gaps && (k.gaps || []).length !== 10) {
        findings.push({
          itemId: entry.itemId,
          field: "answerKey.gaps.length",
          detail: `${(k.gaps || []).length}, expected 10`,
        });
      }
      if (entry.publicDoc.fragments && !(k.correctOrder || []).length) {
        findings.push({ itemId: entry.itemId, field: "answerKey.correctOrder", detail: "empty" });
      }
    } else if (key.exists) {
      findings.push({
        itemId: entry.itemId,
        field: "answerKey/key",
        detail: "spurious — this type must NOT have an answer key",
      });
    }
  }
  return findings;
}

// ── Content-verification gate — SUBSTANCE ────────────────────────────────────
//
// Mandatory, full-coverage, report-and-halt. Both reads are genuinely fresh:
// the corpus file is re-read from disk (not reused from Phase 1's parse) and
// the Firestore document via a real get() (not the in-memory object just
// written). Comparing against the script's own in-memory copy would only
// confirm the script's own assumption and catch nothing — which is the failure
// mode Method §14 actually found.
//
// Comparison is direct string match, not a hash: a hash says "different", a
// string comparison says WHAT differs, by item and field.
async function contentVerificationGate(db, plan) {
  const findings = [];

  for (const entry of plan) {
    const { itemId, taskType, dir, cfg } = entry;

    // Fresh disk read + fresh re-parse.
    let reparsed;
    try {
      const body = fs.readFileSync(
        path.join(dir, `${itemId}_layer1_generation.md`),
        "utf8"
      );
      const ctx = { itemId, taskType, notes: [], format: null };
      reparsed = PARSERS[taskType](body, ctx);
    } catch (err) {
      findings.push({
        itemId,
        field: "<re-parse>",
        expected: "parses cleanly on fresh read",
        found: err.message,
      });
      continue;
    }

    // Fresh Firestore read.
    const ref = db.collection("toeflItems").doc(itemId);
    const snap = await ref.get();
    if (!snap.exists) {
      findings.push({ itemId, field: "<document>", expected: "exists", found: "missing" });
      continue;
    }
    const live = snap.data();

    // Public: stimulus fields.
    for (const [k, v] of Object.entries(reparsed.stimulus || {})) {
      if (typeof v === "string") {
        compare(findings, itemId, `stimulus.${k}`, v, live.stimulus ? live.stimulus[k] : undefined);
      }
    }

    // Public: MCQ stems and option text.
    if (reparsed.questions && cfg.family === "mcq") {
      const liveQs = live.questions || [];
      if (liveQs.length !== reparsed.questions.length) {
        findings.push({
          itemId,
          field: "questions.length",
          expected: String(reparsed.questions.length),
          found: String(liveQs.length),
        });
      } else {
        reparsed.questions.forEach((q, i) => {
          compare(findings, itemId, `questions[${q.questionIndex}].stem`, q.stem, liveQs[i].stem);
          q.options.forEach((o, j) => {
            compare(
              findings,
              itemId,
              `questions[${q.questionIndex}].options[${o.optionId}].text`,
              o.text,
              (liveQs[i].options || [])[j] ? liveQs[i].options[j].text : undefined
            );
          });
        });
      }
    }

    // Public: the type-specific arrays.
    if (reparsed.utterances) {
      const liveU = live.utterances || [];
      reparsed.utterances.forEach((u, i) => {
        compare(findings, itemId, `utterances[${u.utteranceIndex}].text`, u.text, (liveU[i] || {}).text);
        compare(findings, itemId, `utterances[${u.utteranceIndex}].part`, u.part, (liveU[i] || {}).part);
      });
    }
    if (reparsed.gaps) {
      const liveG = live.gaps || [];
      reparsed.gaps.forEach((g, i) => {
        compare(
          findings,
          itemId,
          `gaps[${g.gapIndex}].givenLetters`,
          g.givenLetters,
          (liveG[i] || {}).givenLetters
        );
      });
    }
    if (reparsed.fragments) {
      const liveF = live.fragments || [];
      reparsed.fragments.forEach((f, i) => {
        compare(findings, itemId, `fragments[${f.fragmentIndex}].text`, f.text, (liveF[i] || {}).text);
      });
    }

    // Public: constructed-response prompts.
    if (reparsed.prompt) {
      const lp = live.prompt || {};
      if (reparsed.prompt.relationshipType !== undefined) {
        compare(findings, itemId, "prompt.relationshipType", reparsed.prompt.relationshipType, lp.relationshipType);
      }
      if (reparsed.prompt.requiredElements) {
        reparsed.prompt.requiredElements.forEach((e, i) => {
          compare(findings, itemId, `prompt.requiredElements[${i}]`, e, (lp.requiredElements || [])[i]);
        });
      }
      if (reparsed.prompt.header) {
        compare(findings, itemId, "prompt.header.to", reparsed.prompt.header.to, (lp.header || {}).to);
        compare(
          findings,
          itemId,
          "prompt.header.subject",
          reparsed.prompt.header.subject,
          (lp.header || {}).subject
        );
      }
      if (reparsed.prompt.questions) {
        reparsed.prompt.questions.forEach((q, i) => {
          compare(
            findings,
            itemId,
            `prompt.questions[${q.questionIndex}].stem`,
            q.stem,
            (lp.questions || [])[i] ? lp.questions[i].stem : undefined
          );
          if (q.questionType !== undefined) {
            compare(
              findings,
              itemId,
              `prompt.questions[${q.questionIndex}].questionType`,
              q.questionType,
              (lp.questions || [])[i] ? lp.questions[i].questionType : undefined
            );
          }
        });
      }
    }

    // Private: the answer key. A silently-reverted key is at least as serious
    // as reverted passage text — a wrong answer marked correct is a
    // scoring-integrity failure, not a display one.
    if (cfg.answerKey) {
      const keySnap = await ref.collection("answerKey").doc("key").get();
      if (!keySnap.exists) {
        findings.push({ itemId, field: "answerKey/key", expected: "exists", found: "missing" });
        continue;
      }
      const lk = keySnap.data();

      if (reparsed.questions) {
        const lkq = lk.questions || [];
        reparsed.questions.forEach((q, i) => {
          compare(
            findings,
            itemId,
            `answerKey.questions[${q.questionIndex}].correctOptionId`,
            q.correctOptionId,
            (lkq[i] || {}).correctOptionId
          );
          q.rationales.forEach((r, j) => {
            compare(
              findings,
              itemId,
              `answerKey.questions[${q.questionIndex}].rationales[${r.optionId}]`,
              r.rationale,
              (lkq[i] || {}).rationales ? (lkq[i].rationales[j] || {}).rationale : undefined
            );
          });
        });
      }
      if (reparsed.keyGaps) {
        const lkg = lk.gaps || [];
        reparsed.keyGaps.forEach((g, i) => {
          compare(
            findings,
            itemId,
            `answerKey.gaps[${g.gapIndex}].correctCompletion`,
            g.correctCompletion,
            (lkg[i] || {}).correctCompletion
          );
        });
      }
      if (reparsed.correctOrder) {
        compare(
          findings,
          itemId,
          "answerKey.correctOrder",
          reparsed.correctOrder.join(","),
          (lk.correctOrder || []).join(",")
        );
      }
    }
  }

  return findings;
}

function compare(findings, itemId, field, expected, found) {
  if (expected === found) return;
  findings.push({
    itemId,
    field,
    expected: truncate(expected),
    found: truncate(found),
  });
}

function truncate(v) {
  if (v === undefined) return "<undefined>";
  if (v === null) return "<null>";
  const s = String(v);
  return s.length > 90 ? s.slice(0, 87) + "..." : s;
}

// ── Reporting ────────────────────────────────────────────────────────────────

function banner() {
  console.log("─".repeat(78));
  console.log("TOEFL corpus importer — spec v1.11 + JC decisions of Sep 10, 2026");
  console.log(`corpus: ${CORPUS_ROOT}`);
  console.log(`mode:   ${OPT.dryRun ? "DRY RUN (no writes)" : "LIVE WRITE"}`);
  console.log("─".repeat(78));
}

function reportPlan(perType, plan, skipped, notes, errors, dualFields) {
  console.log("\n=== Count check (imported / folders found, with skips itemised) ===\n");
  console.log(
    `  ${"type".padEnd(6)}${"folders".padStart(8)}${"import".padStart(8)}` +
      `${"REVISE".padStart(8)}${"REJECT".padStart(8)}${"other".padStart(8)}${"reserve".padStart(9)}`
  );
  let tF = 0, tI = 0, tR = 0, tJ = 0, tO = 0, tS = 0;
  for (const [type, c] of Object.entries(perType)) {
    console.log(
      `  ${type.padEnd(6)}${String(c.folders).padStart(8)}${String(c.imported).padStart(8)}` +
        `${String(c.revise).padStart(8)}${String(c.reject).padStart(8)}` +
        `${String(c.other).padStart(8)}${String(c.reserve).padStart(9)}`
    );
    tF += c.folders; tI += c.imported; tR += c.revise; tJ += c.reject; tO += c.other; tS += c.reserve;
  }
  console.log(
    `  ${"TOTAL".padEnd(6)}${String(tF).padStart(8)}${String(tI).padStart(8)}` +
      `${String(tR).padStart(8)}${String(tJ).padStart(8)}${String(tO).padStart(8)}${String(tS).padStart(9)}`
  );

  const apFormats = perType.AP && perType.AP.formats;
  if (apFormats && Object.keys(apFormats).length) {
    console.log("\n=== AP three-way format detection (structural, not a list) ===\n");
    for (const [f, n] of Object.entries(apFormats)) console.log(`  ${f.padEnd(12)} ${n} item(s)`);
  }

  if (skipped.length) {
    console.log(`\n=== Skipped (${skipped.length}) — bucketed, never silently dropped ===\n`);
    const byReason = {};
    for (const s of skipped) {
      const k = s.reason.replace(/\s*\(.*\)$/, "").replace(/—.*$/, "").trim();
      (byReason[k] = byReason[k] || []).push(s.itemId);
    }
    for (const [reason, ids] of Object.entries(byReason)) {
      console.log(`  ${reason} (${ids.length}):`);
      console.log(`      ${ids.join(", ")}`);
    }
  }

  if (notes.length) {
    console.log(`\n=== Notes (${notes.length}) — non-blocking ===\n`);
    const shown = notes.slice(0, 12);
    shown.forEach((n) => console.log(`  ${n}`));
    if (notes.length > shown.length) console.log(`  ... and ${notes.length - shown.length} more`);
  }

  if (errors.length) {
    console.log(`\n=== PARSE FAILURES (${errors.length}) ===\n`);
    errors.forEach((e) => console.log(`  ${e.taskType} ${e.itemId}: ${e.message}`));
  }

  if (dualFields && dualFields.length) {
    const conseq = dualFields.filter((d) => d.consequential);
    console.log(
      `\n=== Dual verdict fields (${dualFields.length}) — LAYER 2 wins, per spec ===\n`
    );
    const byPair = {};
    for (const d of dualFields) {
      const k = `${d.taskType}  LAYER 2 "${d.layer2}" vs REVIEW STATUS "${d.reviewStatus}"` +
        `${d.consequential ? "  [CHANGES OUTCOME]" : "  [both pass-equivalent]"}`;
      (byPair[k] = byPair[k] || []).push(d.itemId);
    }
    for (const [k, ids] of Object.entries(byPair)) {
      console.log(`  ${k}`);
      console.log(`      ${ids.length} item(s): ${ids.slice(0, 6).join(", ")}` +
        `${ids.length > 6 ? `, ... +${ids.length - 6}` : ""}`);
    }
    if (conseq.length) {
      console.log(
        `\n  ${conseq.length} of these would import vs. skip depending on which field\n` +
          `  is read. Layer 2 is the spec's gate, so they import. Worth JC's eye:\n` +
          `  the two fields disagree on every dual-field item in the corpus.`
      );
    }
  }

  console.log(
    `\n  LTC SPEC GAP: v1.11's both-writes check accounts for 11 of 12 types —\n` +
      `  LTC is in neither column, and the data model's MCQ list omits it too.\n` +
      `  Real LTC files are unambiguously MCQ, so it is imported WITH an\n` +
      `  answerKey here. Needs JC sign-off to become spec text.`
  );
}

function reportGate(shapeFindings, contentFindings, total) {
  console.log("\n=== Both-writes check (shape) ===\n");
  if (!shapeFindings.length) {
    console.log(`  PASS — ${total} items, answerKey present exactly where required, absent elsewhere`);
  } else {
    console.log(`  FAILED — ${shapeFindings.length} finding(s):`);
    shapeFindings.forEach((f) => console.log(`    ${f.itemId} · ${f.field} · ${f.detail}`));
  }

  console.log("\n=== Content-verification gate (substance, fresh reads both sides) ===\n");
  if (!contentFindings.length) {
    console.log(`  PASS — ${total} items verified, 0 mismatches`);
  } else {
    console.log(`  FAILED — verification found ${contentFindings.length} mismatches:`);
    contentFindings.slice(0, 40).forEach((f) =>
      console.log(`    ${f.itemId} · ${f.field}\n        expected: ${f.expected}\n        found:    ${f.found}`)
    );
    if (contentFindings.length > 40) {
      console.log(`    ... and ${contentFindings.length - 40} more`);
    }
    console.log(
      `\n  Import is NOT complete. This blocks whatever comes next in the pipeline.\n` +
        `  No auto-fix, by design.`
    );
  }
  console.log("");
}

main().catch((err) => {
  console.error("\nIMPORTER ERRORED:", err);
  process.exit(1);
});
