#!/usr/bin/env python3
"""B10-PP · scripts/normalizeToeflIntAudio.py
Loudness-normalise the TOEFL Interview clips (JC 2026-09-16): -20 LUFS, peaks
below -1 dB, 128 kbps MP3. See scripts/toeflTts/normalize_core.py.

  audio/toefl/int_raw/  untouched ElevenLabs originals (read-only, SHA256SUMS)
  audio/toefl/int/      normalised clips served to students

Every clip is normalised from its raw original, never from a normalised file,
and the result is recorded in the manifest under `loudness`. A clip that was
already normalised from the same original is skipped. When
generateToeflIntAudio.js regenerates a clip it writes a new raw file to int/
and drops the clip's `loudness` record; this script then moves that file into
int_raw/ (updating SHA256SUMS) before normalising it.

Refuses to run if any int_raw file disagrees with SHA256SUMS.

Usage: python3 scripts/normalizeToeflIntAudio.py [--dry-run] [--audio <dir>]
"""
import argparse, datetime, hashlib, json, os, shutil, stat, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "toeflTts"))
import normalize_core as N  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--audio", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "audio", "toefl"))
ap.add_argument("--dry-run", action="store_true")
a = ap.parse_args()
ROOT = os.path.abspath(a.audio)
RAW, OUT = os.path.join(ROOT, "int_raw"), os.path.join(ROOT, "int")
MANIFEST = os.path.join(ROOT, "manifests", "int_audio_manifest.json")
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
sums = read_sums()
bad = [rel for rel, h in sums.items() if not os.path.exists(os.path.join(RAW, rel)) or sha(os.path.join(RAW, rel)) != h]
if bad:
    sys.exit(f"int_raw does not match SHA256SUMS ({len(bad)} files, e.g. {bad[:3]}); refusing to run.")

todo, adopt, skipped = [], [], 0
for item_id, item in sorted(manifest["items"].items()):
    for clip_id, clip in sorted(item["clips"].items()):
        rel = os.path.relpath(clip["file"], "int")
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

print(f"audio: {ROOT}\nclips: {sum(len(i['clips']) for i in manifest['items'].values())}  to normalise: {len(todo)}  "
      f"already normalised: {skipped}  new raw originals to adopt: {len(adopt)}")
if a.dry_run:
    sys.exit(0)

# Phase 1: every new original is copied into int_raw and verified before any output is written.
for rel, src, raw in adopt:
    d = os.path.dirname(raw)
    os.makedirs(d, exist_ok=True)
    set_writable(RAW, True); set_writable(d, True)
    if os.path.exists(raw):
        set_writable(raw, True)
    shutil.copy2(src, raw)
    if sha(raw) != sha(src):
        sys.exit(f"copy of {rel} into int_raw does not match; stopping before any overwrite.")
    set_writable(raw, False); set_writable(d, False); set_writable(RAW, False)
    sums[rel] = sha(raw)
if adopt:
    set_writable(RAW, True)
    set_writable(SUMS, True) if os.path.exists(SUMS) else None
    with open(SUMS, "w") as f:
        f.write("".join(f"{sums[r]}  {r}\n" for r in sorted(sums)))
    set_writable(SUMS, False); set_writable(RAW, False)
    print(f"adopted {len(adopt)} new raw originals into int_raw")

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
