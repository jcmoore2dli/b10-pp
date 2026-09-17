#!/usr/bin/env python3
"""TOEFL TTS calibration: one real LTC conversation, both generation approaches.

Built 2026-09-17 so JC can hear the LTC decision rather than infer it:
  A  per-turn: each turn generated on its own with eleven_multilingual_v2 (the
     model every other TOEFL clip uses), then concatenated with a short gap.
  B  native dialogue: one /v1/text-to-dialogue call with eleven_v3, which is
     the only model that endpoint supports.
Same item, same turns, same two voices, same seed. Writes both to the
calibration folder; the real pipeline is untouched.

Usage: python3 ltc_dialogue_probe.py [LTC-001] [--gap-ms 250] [--out <dir>]
Key: TOEFL_TTS_API_KEY only.
"""
import argparse, glob, io, json, os, re, sys, urllib.request
import numpy as np, soundfile as sf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))  # normalize_core lives in scripts/toeflTts
import normalize_core as N  # writes 128 kbps CBR MP3, and verifies

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
CORPUS = os.path.expanduser("~/toefl/corpus/08_listen_conversation")
DEFAULT_OUT = os.path.expanduser("~/OneDrive/Documents/Work/DLI/AI/toefl/tts_calibration_2026-09-17/ltc_dialogue_probe")
SEED = 20260915

ap = argparse.ArgumentParser()
ap.add_argument("item", nargs="?", default="LTC-001")
ap.add_argument("--gap-ms", type=int, default=250, help="silence between turns in the per-turn build")
ap.add_argument("--out", default=DEFAULT_OUT)
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)

env = {}
for line in open(os.path.join(REPO, ".env")):
    if "=" in line and not line.lstrip().startswith("#"):
        k, v = line.split("=", 1); env[k.strip()] = v.strip().strip('"').strip("'")
KEY = os.environ.get("TOEFL_TTS_API_KEY") or env.get("TOEFL_TTS_API_KEY")
if not KEY:
    sys.exit("No TOEFL_TTS_API_KEY in the environment or .env.")
if KEY in {os.environ.get("ELEVENLABS_API_KEY"), env.get("ELEVENLABS_API_KEY")}:
    sys.exit("TOEFL_TTS_API_KEY equals B10-PP's ELEVENLABS_API_KEY. Refusing to run.")
H = {"xi-api-key": KEY, "Content-Type": "application/json"}

# The item's turns, and the voices the LTC rotation assigns it.
body = open(glob.glob(f"{CORPUS}/{a.item}/*layer1*")[0]).read()
block = re.search(r"^CONVERSATION TEXT:\s*\n(.*?)(?=\n\s*\n[A-Z])", body, re.S | re.M)
turns = [(m.group(1), m.group(2).strip()) for m in re.finditer(r"^\[([^\]]+)\]:\s*(.+)$", block.group(1), re.M)]
voices = json.loads(subprocess_out := __import__("subprocess").check_output(
    ["node", "-e", f"""
const {{ listActiveItems, assignVoices }} = require({json.dumps(os.path.join(REPO, 'scripts/toeflTts/voiceRotationManifest'))});
const {{ VOICES }} = require({json.dumps(os.path.join(REPO, 'scripts/toeflTts/config'))});
const os = require("os"), path = require("path");
const {{ active }} = listActiveItems(path.join(os.homedir(), "toefl", "corpus"), "ltc");
const it = assignVoices("ltc", active, null, "probe").manifest.items.find((i) => i.itemId === {json.dumps(a.item)});
console.log(JSON.stringify(it.voices.map((v) => ({{ ...v, voiceId: VOICES[v.voiceConstant].voiceId, name: VOICES[v.voiceConstant].name }}))));
"""], text=True))
by_label = {v["speakerLabel"]: v for v in voices}
words = sum(len(t.split()) for _, t in turns)
print(f"{a.item}: {len(turns)} turns, {words} words")
for v in voices:
    print(f"  {v['speakerLabel']}: {v['voiceConstant']} ({v['name']})")

def post(url, payload):
    return urllib.request.urlopen(urllib.request.Request(url, data=json.dumps(payload).encode(), headers=H), timeout=180).read()

# ── B: native dialogue, eleven_v3 (the only model the endpoint supports) ──
inputs = [{"text": text, "voice_id": by_label[label]["voiceId"]} for label, text in turns]
out_b = os.path.join(a.out, f"{a.item}_B_dialogue_v3.mp3")
if not os.path.exists(out_b):
    open(out_b, "wb").write(post(
        "https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128",
        {"inputs": inputs, "model_id": "eleven_v3", "seed": SEED}))

# ── A: per turn with eleven_multilingual_v2, then concatenated ──
PRESET = json.loads(__import__("subprocess").check_output(
    ["node", "-e", f"const {{PRESETS}}=require({json.dumps(os.path.join(REPO,'scripts/toeflTts/config'))});console.log(JSON.stringify(PRESETS.toefl_ltc_conversation));"], text=True))
pieces, turn_files = [], []
for i, (label, text) in enumerate(turns, 1):
    f = os.path.join(a.out, f"{a.item}_A_turn{i}_{label}.mp3")
    if not os.path.exists(f):
        open(f, "wb").write(post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{by_label[label]['voiceId']}?output_format=mp3_44100_128",
            {"text": text, "model_id": "eleven_multilingual_v2", "voice_settings": PRESET, "seed": SEED}))
    turn_files.append(f)
    x, sr = sf.read(f, dtype="float64")
    pieces.append(x)
    if i < len(turns):
        pieces.append(np.zeros(int(sr * a.gap_ms / 1000)))
joined = np.concatenate(pieces)
out_a = os.path.join(a.out, f"{a.item}_A_perturn_multilingual_v2.mp3")
N.write_mp3(out_a, joined, 44100)

for label, path_ in (("A per-turn + concatenated (multilingual_v2)", out_a), ("B native dialogue (eleven_v3)", out_b)):
    v = N.verify(path_)
    print(f"\n{label}\n  {os.path.basename(path_)}  {v['dur']:.2f}s  {words/v['dur']*60:.0f} wpm (whole file)  {v['lufs']:.2f} LUFS  peak {v['true_peak_db']:.2f} dB")
print(f"\nper-turn pieces kept for reference: {len(turn_files)} files, {a.gap_ms} ms gap between turns")
