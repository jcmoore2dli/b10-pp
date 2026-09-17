#!/usr/bin/env python3
"""TOEFL TTS calibration: seeded speed test on Interview INT-001 Q1.

Generates Q1 ("Option C": one 0.3 s break tag before the em dash) in one voice
with the toefl_int_interviewer settings, a fixed seed, and one clip per speed,
so the only thing that changes between clips is speed. Writes 24 kHz mono WAVs
plus a results JSON with timing and WPM, in the same shape as
tts_calibration_2026-09-15/results_int_q1_optC_speed_seeded.json.

Timing: frames of 10 ms, voiced if RMS > -45 dBFS. Speech span runs from the
first voiced frame to the last. Articulation is the span minus silent runs of
>= 0.15 s. --check reproduces the 2026-09-15 JSON values to within 0.02 s.

Key: TOEFL_TTS_API_KEY only (environment, then repo .env). Refuses to run if it
equals B10-PP's ELEVENLABS_API_KEY.

Usage:
  python3 scripts/toeflTts/calibration/int_q1_seeded_speed.py --speeds 0.92,0.93
  ... --seed 20260915      (default; the 2026-09-15/16 comparison seed)
  ... --voice NA_F         (accent_gender slot from config.js; default NA_F)
  ... --out <dir>          (default ~/OneDrive/.../toefl/tts_calibration_<today>)
  ... --check <dir>        measure existing *.wav files only; no API call

History: 2026-09-15 (0.95/0.97/1.0), 2026-09-16 (0.92/0.93), both seed
20260915 on Cecilia (NA_F).
"""
import argparse, datetime, glob, json, os, re, sys, urllib.request, wave
import numpy as np

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
CAL_ROOT = os.path.expanduser("~/OneDrive/Documents/Work/DLI/AI/toefl")
TEXT = ('Can you describe how you typically use music in your daily life '
        '<break time="0.3s" /> — for example, while working, exercising, or relaxing?')
# 19 words, counted as in intAudioPlan.js countWords (the em dash is not a word).
# The 2026-09-15 and 2026-09-16 results JSONs used 20, so their WPM figures
# read about 5% high; the comparison between speeds is unaffected.
WORDS = len([t for t in re.sub(r"<[^>]+>", " ", TEXT).split() if re.search(r"[A-Za-z0-9]", t)])
RATE = 24000
MODEL_ID = "eleven_multilingual_v2"  # matches config.js
# toefl_int_interviewer preset from config.js, minus speed
BASE_SETTINGS = dict(stability=0.45, similarity_boost=0.75, style=0.1, use_speaker_boost=True)


def voices_from_config():
    src = open(os.path.join(REPO, "scripts", "toeflTts", "config.js")).read()
    return {m[0]: (m[1], m[2]) for m in re.findall(
        r'TOEFL_TTS_VOICE_(\w+?): \{ voiceId: "(\w+)", name: "([^"]+)"', src)}


def metrics(path, thr_db=-45, win=0.01, min_pause=0.15):
    w = wave.open(path)
    rate = w.getframerate()
    x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(float) / 32768
    n = int(rate * win)
    fr = x[: len(x) // n * n].reshape(-1, n)
    voiced = 20 * np.log10(np.sqrt((fr ** 2).mean(1)) + 1e-9) > thr_db
    idx = np.where(voiced)[0]
    first, last = idx[0], idx[-1]
    span = (last - first + 1) * win
    pauses, run = 0.0, 0
    for v in voiced[first:last + 1]:
        if v:
            if run * win >= min_pause:
                pauses += run * win
            run = 0
        else:
            run += 1
    art = span - pauses
    return dict(total_s=round(len(x) / rate, 2), speech_span_s=round(span, 2),
                articulation_s=round(art, 2), wpm_span=round(WORDS / span * 60, 1),
                wpm_articulation=round(WORDS / art * 60, 1))


def api_key():
    env = {}
    path = os.path.join(REPO, ".env")
    if os.path.exists(path):
        for line in open(path):
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    key = os.environ.get("TOEFL_TTS_API_KEY") or env.get("TOEFL_TTS_API_KEY")
    if not key:
        sys.exit("No TOEFL_TTS_API_KEY in the environment or .env. ELEVENLABS_API_KEY is deliberately not used.")
    if key in {os.environ.get("ELEVENLABS_API_KEY"), env.get("ELEVENLABS_API_KEY")}:
        sys.exit("TOEFL_TTS_API_KEY equals B10-PP's ELEVENLABS_API_KEY. Refusing to run.")
    return key


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--speeds", help="comma-separated, e.g. 0.92,0.93")
    ap.add_argument("--seed", type=int, default=20260915)
    ap.add_argument("--voice", default="NA_F")
    ap.add_argument("--out", default=os.path.join(CAL_ROOT, f"tts_calibration_{datetime.date.today()}"))
    ap.add_argument("--check", metavar="DIR")
    a = ap.parse_args()

    if a.check:
        for f in sorted(glob.glob(os.path.join(a.check, "*.wav"))):
            print(os.path.basename(f), metrics(f))
        return
    if not a.speeds:
        ap.error("--speeds is required unless --check is given")

    voice_id, voice_name = voices_from_config()[a.voice]
    key = api_key()
    os.makedirs(a.out, exist_ok=True)
    speeds = [float(s) for s in a.speeds.split(",")]
    results = []
    for speed in speeds:
        name = f"toefl_int_interviewer_Q1_optC_break03_speed{round(speed * 100):03d}_seed__{a.voice}"
        path = os.path.join(a.out, name + ".wav")
        if os.path.exists(path):
            sys.exit(f"{path} exists; not overwriting a calibration record.")
        settings = dict(BASE_SETTINGS, speed=speed)
        body = json.dumps(dict(text=TEXT, model_id=MODEL_ID, voice_settings=settings, seed=a.seed)).encode()
        req = urllib.request.Request(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=pcm_{RATE}",
            data=body, headers={"xi-api-key": key, "Content-Type": "application/json"})
        pcm = urllib.request.urlopen(req, timeout=120).read()
        with wave.open(path, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(pcm)
        results.append(dict(sample=name, option=f"Option C + speed {speed}, seed {a.seed}", voice=voice_name,
                            text_sent=TEXT, words=WORDS, seed=a.seed, settings=settings, **metrics(path)))
        print(json.dumps(results[-1]))
    tags = "_".join(f"{round(s * 100):03d}" for s in speeds)
    res = os.path.join(a.out, f"results_int_q1_optC_speed_seeded_{tags}.json")
    if os.path.exists(res):
        sys.exit(f"{res} exists; results printed above, not written.")
    json.dump(results, open(res, "w"), indent=2)
    print("wrote", res)


if __name__ == "__main__":
    main()
