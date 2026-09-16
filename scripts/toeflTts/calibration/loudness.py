"""Loudness of TOEFL TTS clips: integrated LUFS (ITU-R BS.1770-4, gated),
sample peak dBFS, and RMS dBFS over speech frames only (50 ms frames above
-50 dBFS), so silences and clip length don't skew the level.
Usage: python3 loudness.py file.mp3 ...   (or import `measure`)"""
import sys, numpy as np, soundfile as sf
from scipy.signal import bilinear, lfilter

def _k_weight(sr):
    # BS.1770 pre-filter (high shelf) and RLB high-pass, designed for any rate
    f0, G, Q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    K = np.tan(np.pi * f0 / sr); Vh = 10 ** (G / 20); Vb = Vh ** 0.4996667741545416
    a0 = 1 + K / Q + K * K
    b1 = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0]
    a1 = [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]
    f0, Q = 38.13547087602444, 0.5003270373238773
    K = np.tan(np.pi * f0 / sr); a0 = 1 + K / Q + K * K
    b2 = [1, -2, 1]; a2 = [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]
    return (b1, a1), (b2, a2)

def lufs(x, sr):
    (b1, a1), (b2, a2) = _k_weight(sr)
    y = lfilter(b2, a2, lfilter(b1, a1, x))
    n, hop = int(0.4 * sr), int(0.1 * sr)
    z = np.array([np.mean(y[i:i + n] ** 2) for i in range(0, len(y) - n + 1, hop)])
    l = -0.691 + 10 * np.log10(z + 1e-12)
    z = z[l > -70]
    rel = -0.691 + 10 * np.log10(z.mean()) - 10
    z = z[-0.691 + 10 * np.log10(z) > rel]
    return -0.691 + 10 * np.log10(z.mean())

def measure(path):
    x, sr = sf.read(path, dtype="float64")
    if x.ndim > 1: x = x.mean(1)
    n = int(0.05 * sr); fr = x[: len(x) // n * n].reshape(-1, n)
    rms = np.sqrt((fr ** 2).mean(1)); db = 20 * np.log10(rms + 1e-12)
    sp = rms[db > -50]
    return dict(lufs=round(lufs(x, sr), 2), peak_db=round(20 * np.log10(np.abs(x).max()), 2),
                speech_rms_db=round(20 * np.log10(np.sqrt((sp ** 2).mean())), 2), dur=round(len(x) / sr, 2))

if __name__ == "__main__":
    for p in sys.argv[1:]: print(p, measure(p))
