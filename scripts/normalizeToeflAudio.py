#!/usr/bin/env python3
"""B10-PP · scripts/normalizeToeflAudio.py
Loudness-normalise one task type's TOEFL stimulus clips (JC 2026-09-16):
-20 LUFS, peaks below -1 dB, 128 kbps MP3. See scripts/toeflTts/normalize_core.py.

  audio/toefl/<type>_raw/  untouched ElevenLabs originals (read-only, SHA256SUMS)
  audio/toefl/<type>/      normalised clips served to students

<type> is int (Interview) or lar (Listen and Repeat). Both use the same
process, the same core module and the same manifest fields.

Every clip is normalised from its raw original, never from a normalised file,
and the result is recorded in the manifest under `loudness`. A clip that was
already normalised from the same original is skipped. When
the type's generator regenerates a clip it writes a new raw file to <type>/
and drops the clip's `loudness` record; this script then moves that file into
<type>_raw/ (updating SHA256SUMS) before normalising it.

Refuses to run if any <type>_raw file disagrees with SHA256SUMS.

Usage: python3 scripts/normalizeToeflAudio.py --type int|lar [--dry-run] [--audio <dir>]
"""
import argparse, datetime, hashlib, json, os, shutil, stat, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "toeflTts"))
import normalize_core as N  # noqa: E402

TYPES = {t: f"toefl-{t}-audio-manifest/1" for t in ("int", "lar", "at", "lta", "lcr", "ltc")}

ap = argparse.ArgumentParser()
ap.add_argument("--type", required=True, choices=sorted(TYPES),
                help="task type; the clips folder, raw folder and manifest all follow it")
ap.add_argument("--audio", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "audio", "toefl"))
ap.add_argument("--dry-run", action="store_true")
a = ap.parse_args()
ROOT = os.path.abspath(a.audio)
T = a.type
RAW, OUT = os.path.join(ROOT, f"{T}_raw"), os.path.join(ROOT, T)
MANIFEST = os.path.join(ROOT, "manifests", f"{T}_audio_manifest.json")
SUMS = os.path.join(RAW, "SHA256SUMS")

def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()

def read_sums():
    if not os.path.exists(SUMS):
        return {}
    return {rel: h for h, rel in (l.split("  ", 1) for l in open(SUMS).read().splitlines() if l)}

def write_json(path, obj):  # same layout as JSON.stringify(obj, null, 2) + "\n"
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")
    os.replace(tmp, path)

def set_writable(path, on):
    mode = os.stat(path).st_mode
    os.chmod(path, mode | stat.S_IWUSR if on else mode & ~(stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH))

manifest = json.load(open(MANIFEST))
if manifest.get("schema") != TYPES[T]:
    sys.exit(f"{MANIFEST}: schema {manifest.get('schema')!r}, expected {TYPES[T]!r} for --type {T}")
sums = read_sums()
bad = [rel for rel, h in sums.items() if not os.path.exists(os.path.join(RAW, rel)) or sha(os.path.join(RAW, rel)) != h]
if bad:
    sys.exit(f"{T}_raw does not match SHA256SUMS ({len(bad)} files, e.g. {bad[:3]}); refusing to run.")

todo, adopt, skipped = [], [], 0
for item_id, item in sorted(manifest["items"].items()):
    for clip_id, clip in sorted(item["clips"].items()):
        rel = os.path.relpath(clip["file"], T)
        raw, out = os.path.join(RAW, rel), os.path.join(OUT, rel)
        lo = clip.get("loudness")
        if lo is None:
            # Not normalised yet. If int/ holds something other than the recorded
            # original, it is a fresh generator output: adopt it as the new raw.
            if rel not in sums or sha(out) != sums[rel]:
                adopt.append((rel, out, raw))
        elif sums.get(rel) != lo.get("rawSha256") or not os.path.exists(out) or sha(out) != lo.get("normalizedSha256"):
            pass  # raw changed or output altered: renormalise below
        else:
            skipped += 1
            continue
        todo.append((item_id, clip_id, rel, raw, out))

print(f"audio: {ROOT}  type: {T}\nclips: {sum(len(i['clips']) for i in manifest['items'].values())}  to normalise: {len(todo)}  "
      f"already normalised: {skipped}  new raw originals to adopt: {len(adopt)}")
if a.dry_run:
    sys.exit(0)

# Phase 1: every new original is copied into <type>_raw and verified before any
# output is written. The raw tree is unlocked once for the whole phase and
# locked again at the end — locking per item broke the next item's mkdir.
if adopt:
    os.makedirs(RAW, exist_ok=True)
    set_writable(RAW, True)
    for rel, src, raw in adopt:
        d = os.path.dirname(raw)
        if os.path.isdir(d):
            set_writable(d, True)
        os.makedirs(d, exist_ok=True)
        if os.path.exists(raw):
            set_writable(raw, True)
        shutil.copy2(src, raw)
        if sha(raw) != sha(src):
            sys.exit(f"copy of {rel} into {T}_raw does not match; stopping before any overwrite.")
        sums[rel] = sha(raw)
    if os.path.exists(SUMS):
        set_writable(SUMS, True)
    with open(SUMS, "w") as f:
        f.write("".join(f"{sums[r]}  {r}\n" for r in sorted(sums)))
    # Lock the whole raw tree again: files, then item folders, then the root.
    for d, _, files in os.walk(RAW):
        for name in files:
            set_writable(os.path.join(d, name), False)
    for d, dirs, _ in os.walk(RAW, topdown=False):
        for name in dirs:
            set_writable(os.path.join(d, name), False)
    set_writable(RAW, False)
    print(f"adopted {len(adopt)} new raw originals into {T}_raw")

# Phase 2: normalise from the raw originals.
today = datetime.date.today().isoformat()
for n, (item_id, clip_id, rel, raw, out) in enumerate(todo, 1):
    tmp = out + ".norm.mp3"
    r = N.normalize_file(raw, tmp)
    if not r["ok"]:
        os.remove(tmp)
        sys.exit(f"{rel}: could not meet target (lufs {r['lufsOut']}, peak {r['truePeakDb']}); stopping.")
    os.replace(tmp, out)
    limited = r["limiterMaxReductionDb"] < 0
    note = f"loudness normalized to {N.TARGET_LUFS:g} LUFS: gain {r['gainDb']:+.2f} dB" + (
        f", peak limiter up to {-r['limiterMaxReductionDb']:.2f} dB" if limited else ", no limiting")
    manifest["items"][item_id]["clips"][clip_id]["loudness"] = {
        **r, "limited": limited, "note": note,
        "encoder": f"libsndfile MPEG_LAYER_III CBR compression_level {N.MP3_LEVEL} (128 kbps)",
        "rawSha256": sums[rel], "normalizedSha256": sha(out),
        "bytes": os.path.getsize(out), "normalizedOn": today,
    }
    write_json(MANIFEST, manifest)  # after every clip, like the generator
    print(f"[{n}/{len(todo)}] {rel}  {note}")
print("done.")
