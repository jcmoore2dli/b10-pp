"""Silence finder: 10 ms frames, silent below -45 dBFS, gaps >= 80 ms. Reads WAV or MP3.
Usage: python3 gaps.py file ..."""
import sys, numpy as np, soundfile as sf
def gaps(path, thr=-45, win=0.01, min_gap=0.08):
    x, sr = sf.read(path, dtype='float32')
    if x.ndim > 1: x = x.mean(1)
    n = int(sr*win); fr = x[:len(x)//n*n].reshape(-1, n)
    db = 20*np.log10(np.sqrt((fr**2).mean(1))+1e-9); v = db > thr
    idx = np.where(v)[0]; first, last = idx[0], idx[-1]
    out=[]; run=0; start=None
    for i in range(first, last+1):
        if not v[i]:
            if run==0: start=i
            run+=1
        else:
            if run*win>=min_gap: out.append((round(start*win,2), round(run*win,2)))
            run=0
    return dict(dur=round(len(x)/sr,2), speech=(round(first*win,2), round((last+1)*win,2)), gaps=out)
if __name__=='__main__':
    for p in sys.argv[1:]: print(p.split('/')[-1], gaps(p))
