"""Loudness normalisation for TOEFL TTS MP3s (JC 2026-09-16: -20 LUFS, peaks
below -1 dB). Gain to the target, then a smooth look-ahead peak limiter on a
4x-oversampled true-peak estimate, iterated so the limited clip still lands
on the target; encoded as 44.1 kHz 128 kbps CBR MP3 with libsndfile."""
import numpy as np, soundfile as sf
from scipy.ndimage import minimum_filter1d, uniform_filter1d
from scipy.signal import resample_poly
import importlib.util, os
_spec = importlib.util.spec_from_file_location("loudness", os.path.join(os.path.dirname(__file__), "calibration", "loudness.py"))
L = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(L)

TARGET_LUFS = -20.0
# Minimum quiet tail after the last audible sample. ElevenLabs normally leaves
# 0.2-0.4 s and every shipped clip sits in that range, but the LTC dialogue
# endpoint returns audio ending on the final syllable, which JC heard as the
# clip being cut off (2026-09-17). Clips already at or above this are untouched.
MIN_TAIL_S = 0.3
TAIL_SILENCE_DB = -45.0  # the level below which the tail counts as quiet
PEAK_LIMIT_DB = -1.0        # verified on the decoded MP3
LIMITER_CEILING_DB = -1.5   # pre-encode ceiling; MP3 encoding can raise peaks
MP3_LEVEL = 0.61            # libsndfile compression_level -> 128 kbps CBR
WINDOW_S = 0.02

def true_peak_db(x):
    return 20 * np.log10(np.abs(resample_poly(x, 4, 1)).max() + 1e-12)

def _limit(x, sr, ceiling_db):
    c = 10 ** (ceiling_db / 20)
    env = np.abs(resample_poly(x, 4, 1)).reshape(-1, 4).max(1)[: len(x)]
    req = np.minimum(1.0, c / np.maximum(env, 1e-12))
    w = max(1, int(WINDOW_S * sr))
    g = uniform_filter1d(minimum_filter1d(req, size=2 * w + 1), size=w)
    return x * np.minimum(g, req.max()), float(20 * np.log10(g.min()))

def tail_seconds(x, sr, win=0.01):
    """Seconds between the last audible frame and the end of the audio."""
    n = int(sr * win)
    fr = x[: len(x) // n * n].reshape(-1, n)
    db = 20 * np.log10(np.sqrt((fr ** 2).mean(1)) + 1e-12)
    voiced = np.where(db > TAIL_SILENCE_DB)[0]
    if len(voiced) == 0:
        return len(x) / sr
    return (len(fr) - 1 - voiced[-1]) * win


def pad_tail(x, sr, min_tail_s=MIN_TAIL_S):
    """Append silence so the clip has at least min_tail_s of quiet at the end."""
    have = tail_seconds(x, sr)
    if have >= min_tail_s:
        return x, 0.0
    add = min_tail_s - have
    return np.concatenate([x, np.zeros(int(round(add * sr)))]), add


def fade_tail(x, sr, fade_ms):
    """Raised-cosine fade over the last fade_ms of the original, applied before
    pad_tail. A clip that ends mid-sound otherwise steps straight from a live
    sample to the padded zeros, which clicks (JC 2026-09-18, LTC-024/030). It
    removes the click only; it cannot restore a syllable the model cut off."""
    n = int(round(sr * fade_ms / 1000))
    if n <= 0:
        return x
    x = x.copy()
    x[-n:] *= 0.5 * (1 + np.cos(np.pi * np.arange(n) / n))
    return x


def normalize(x, sr, ceiling_db=LIMITER_CEILING_DB):
    """Returns (y, info). info: gain_db, limiter_max_reduction_db, lufs_out, true_peak_out_db."""
    lufs_in = L.lufs(x, sr)
    gain = TARGET_LUFS - lufs_in
    red = 0.0
    for _ in range(4):
        y = x * 10 ** (gain / 20)
        if true_peak_db(y) > ceiling_db:
            y, red = _limit(y, sr, ceiling_db)
        else:
            red = 0.0
        err = TARGET_LUFS - L.lufs(y, sr)
        if abs(err) < 0.05: break
        gain += err
    return y, dict(lufs_in=round(lufs_in, 2), gain_db=round(gain, 2), limiter_max_reduction_db=round(red, 2),
                   lufs_out=round(L.lufs(y, sr), 2), true_peak_out_db=round(true_peak_db(y), 2))

def write_mp3(path, y, sr):
    sf.write(path, y, sr, format="MP3", subtype="MPEG_LAYER_III", bitrate_mode="CONSTANT", compression_level=MP3_LEVEL)

def verify(path):
    x, sr = sf.read(path, dtype="float64")
    return dict(sr=sr, dur=round(len(x) / sr, 3), lufs=round(L.lufs(x, sr), 2),
                sample_peak_db=round(20 * np.log10(np.abs(x).max()), 2), true_peak_db=round(true_peak_db(x), 2))

LUFS_TOLERANCE = 0.15

def normalize_file(src, dst, fade_out_ms=0):
    """Closed loop: normalise, encode, decode and re-measure; correct gain for
    the encoder's level change and tighten the ceiling if a decoded peak is
    above PEAK_LIMIT_DB. Returns the record for the manifest."""
    x, sr = sf.read(src, dtype="float64")
    dur_in = len(x) / sr
    x = fade_tail(x, sr, fade_out_ms)
    x, tail_added = pad_tail(x, sr)
    offset, ceiling, passes = 0.0, LIMITER_CEILING_DB, 0
    for passes in range(1, 6):
        y, info = normalize(x, sr, ceiling)
        y = y * 10 ** (offset / 20)
        write_mp3(dst, y, sr)
        v = verify(dst)
        ok_l = abs(v["lufs"] - TARGET_LUFS) <= LUFS_TOLERANCE
        ok_p = v["true_peak_db"] <= PEAK_LIMIT_DB and v["sample_peak_db"] <= PEAK_LIMIT_DB
        if ok_l and ok_p: break
        if not ok_l: offset += TARGET_LUFS - v["lufs"]
        if not ok_p: ceiling -= (max(v["true_peak_db"], v["sample_peak_db"]) - PEAK_LIMIT_DB) + 0.1
    return dict(targetLufs=TARGET_LUFS, peakLimitDb=PEAK_LIMIT_DB, lufsIn=info["lufs_in"],
                fadeOutMs=fade_out_ms, tailPaddedMs=round(tail_added * 1000), minTailMs=round(MIN_TAIL_S * 1000),
                gainDb=round(info["gain_db"] + offset, 2), limiterMaxReductionDb=info["limiter_max_reduction_db"],
                lufsOut=v["lufs"], samplePeakDb=v["sample_peak_db"], truePeakDb=v["true_peak_db"],
                durationIn=round(dur_in, 3), durationOut=v["dur"], passes=passes, ok=bool(ok_l and ok_p))
