#!/usr/bin/env python3
"""TOEFL TTS calibration: one LAR clip at several speeds, nothing else varying.

Built 2026-09-17: Justin (NA_M) measured 184 WPM on LAR-001 u7 at the preset's
0.92, against 149 WPM for Cecilia/Alexander at the same setting, so this walks
speed down to find parity. Text, voice, preset, seed and model are identical
across versions; only `speed` changes.

Reads the clip text from the real plan (scripts/toeflTts/larAudioPlan.js via
node, so the text is exactly what the generator would send), calls ElevenLabs
with TOEFL_TTS_API_KEY only, writes <out>/<ITEM>_<clip>_speedNNN.mp3, and
measures WPM over the speech span (leading/trailing silence trimmed), plus
loudness via loudness.py.

Usage:
  python3 lar_speed_ladder.py LAR-001 u7 --speeds 0.88,0.85,0.82,0.80 \
      [--out <dir>] [--seed 20260915]
"""
import argparse, json, os, re, subprocess, sys, urllib.request
import soundfile as sf, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import loudness as L
from gaps import gaps

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
DEFAULT_OUT = os.path.expanduser("~/OneDrive/Documents/Work/DLI/AI/toefl/tts_calibration_2026-09-17/lar_spotcheck")

ap = argparse.ArgumentParser()
ap.add_argument("item"); ap.add_argument("clip")
ap.add_argument("--speeds", required=True)
ap.add_argument("--seed", type=int, default=20260915)
ap.add_argument("--out", default=DEFAULT_OUT)
ap.add_argument("--voice", help="override the item's voice slot, e.g. NA_F, for a same-text cross-voice baseline")
a = ap.parse_args()

# The clip's text, voice and settings, straight from the generator's own plan.
node = f"""
const {{buildLarPlan}} = require({json.dumps(os.path.join(REPO, "scripts/toeflTts/larAudioPlan"))});
const os = require("os"), path = require("path");
const vm = require({json.dumps(os.path.join(REPO, "audio/toefl/manifests/lar_voice_manifest.json"))});
const {{VOICES}} = require({json.dumps(os.path.join(REPO, "scripts/toeflTts/config"))});
const {{items}} = buildLarPlan(path.join(os.homedir(), "toefl", "corpus"), vm, {{only: [{json.dumps(a.item)}]}});
const it = items[0]; const c = it.clips.find((c) => c.clip === {json.dumps(a.clip)});
console.log(JSON.stringify({{voiceId: VOICES[it.voiceConstant].voiceId, voiceName: VOICES[it.voiceConstant].name,
  voiceConstant: it.voiceConstant, text: c.textSent, words: c.words, settings: c.settings, preset: it.preset}}));
"""
plan = json.loads(subprocess.check_output(["node", "-e", node], text=True))
if a.voice:
    vs = json.loads(subprocess.check_output(["node", "-e",
        f'const {{VOICES}} = require({json.dumps(os.path.join(REPO, "scripts/toeflTts/config"))});'
        f'const k = "TOEFL_TTS_VOICE_" + {json.dumps(a.voice)}; console.log(JSON.stringify({{k, ...VOICES[k]}}));'], text=True))
    plan.update(voiceId=vs["voiceId"], voiceName=vs["name"], voiceConstant=vs["k"])

env = {}
for line in open(os.path.join(REPO, ".env")):
    if "=" in line and not line.lstrip().startswith("#"):
        k, v = line.split("=", 1); env[k.strip()] = v.strip().strip('"').strip("'")
key = os.environ.get("TOEFL_TTS_API_KEY") or env.get("TOEFL_TTS_API_KEY")
if not key:
    sys.exit("No TOEFL_TTS_API_KEY in the environment or .env.")
if key in {os.environ.get("ELEVENLABS_API_KEY"), env.get("ELEVENLABS_API_KEY")}:
    sys.exit("TOEFL_TTS_API_KEY equals B10-PP's ELEVENLABS_API_KEY. Refusing to run.")

os.makedirs(a.out, exist_ok=True)
print(f"{a.item} {a.clip}: {plan['words']} words, {plan['voiceConstant']} ({plan['voiceName']}), preset {plan['preset']}, seed {a.seed}")
print(f"text: {plan['text']}\n")
rows = []
for speed in [float(s) for s in a.speeds.split(",")]:
    name = f"{a.item}_{a.clip}_speed{round(speed * 100):03d}" + (f"_{a.voice}" if a.voice else "")
    path_ = os.path.join(a.out, name + ".mp3")
    if not os.path.exists(path_):
        settings = dict(plan["settings"], speed=speed)
        body = json.dumps(dict(text=plan["text"], model_id="eleven_multilingual_v2", voice_settings=settings, seed=a.seed)).encode()
        req = urllib.request.Request(
            f"https://api.elevenlabs.io/v1/text-to-speech/{plan['voiceId']}?output_format=mp3_44100_128",
            data=body, headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"})
        open(path_, "wb").write(urllib.request.urlopen(req, timeout=120).read())
    g = gaps(path_); x = L.measure(path_)
    span = g["speech"][1] - g["speech"][0]
    art = span - sum(d for _, d in g["gaps"])
    rows.append(dict(speed=speed, file=os.path.basename(path_), dur=x["dur"], span=round(span, 2),
                     wpm_span=round(plan["words"] / span * 60, 1), wpm_articulation=round(plan["words"] / art * 60, 1),
                     lufs=x["lufs"], gaps=[d for _, d in g["gaps"]]))
    print(f"speed {speed:.2f}  {rows[-1]['file']}  dur {x['dur']:5.2f}s  span {span:5.2f}s  "
          f"{rows[-1]['wpm_span']:5.1f} wpm  ({rows[-1]['wpm_articulation']:5.1f} wpm without pauses)  {x['lufs']:6.2f} LUFS")
json.dump(rows, open(os.path.join(a.out, f"{a.item}_{a.clip}_speed_ladder{'_' + a.voice if a.voice else ''}.json"), "w"), indent=1)
