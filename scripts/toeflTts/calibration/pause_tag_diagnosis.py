"""TOEFL TTS calibration: does the <break> tag create a pause, per voice and text?

2026-09-16 spot-check diagnosis. Generates INT question stems through
ElevenLabs /with-timestamps (mp3_44100_128, speed 0.92, seed 20260915,
toefl_int_interviewer settings) with and without the break tag, saves audio
plus character alignment, and measures silences with gaps.py. Reuses cached
results in the output folder, so reruns cost nothing.
  T1 = INT-001 q1 (dash), T2 = INT-033 q2 (comma before "or"), T3 = INT-040 q1 (", such as")
Usage (from this folder):
  python3 -c "from pause_tag_diagnosis import *; r = run('T1', 'UK_F', 'tag'); print(r['gaps'])"
Key: TOEFL_TTS_API_KEY only.
"""
import sys, os, json, base64, re, urllib.request
sys.path.insert(0, os.path.dirname(__file__)); from gaps import gaps
REPO=os.path.expanduser("~/b10_corpus/b10_practice_platform"); OUT=os.path.expanduser("~/OneDrive/Documents/Work/DLI/AI/toefl/tts_calibration_2026-09-16/pause_diagnosis")
env={}
for l in open(REPO+"/.env"):
    if "=" in l and not l.lstrip().startswith("#"): k,v=l.split("=",1); env[k.strip()]=v.strip().strip('"').strip("'")
KEY=os.environ.get("TOEFL_TTS_API_KEY") or env["TOEFL_TTS_API_KEY"]; assert KEY!=env.get("ELEVENLABS_API_KEY")
VOICES={"NA_F":"DIS307HFaAvJZzq496qM","UK_F":"6fZce9LFNG3iEITDfqZZ","AU_F":"56bWURjYFHyYyVf490Dp","NZ_M":"3Mb3pRhm3AnXiPCSQNXS","NA_M":"uFIXVu9mmnDZ7dTKCBTX","UK_M":"mZ8K1MPRiT5wDQaasg3i","LYND":"8z5UhJ1uv7X8TN5yg8oI","AU_M":"WLKp2jV6nrS8aMkPPDRO","NZ_F":"A3TiUH9xcSptIzvOUBnB",
        # 2026-09-16 candidates: UK_M (Joe, Nathaniel, Alistair) and NA_M (Mike, Adam, Chris)
        "JOE":"av1BMOR1GPgThz9p4fLo","NATHANIEL":"lnIpQcZuikKim3oNdYlP","ALISTAIR":"UzI1NsMEV3ni5JRkRSls",
        "MIKE":"vDchjyOZZytffNeZXfZK","ADAM":"zKTOd8cxZlIf5EKC5Giv","CHRIS":"gPiEpcKoaZywgOzc0Zn9",
        # round 2 candidates (2026-09-16)
        "MARCUS":"C9fbwSpEaejywLWx722Z","JACOB":"SO9JediIwzugrikv7xw0","BILL":"ynUcJpglne1SRSNHFg1k",
        "BRIAN":"ByWUwXA3MMLREYmxtB32","JAKE":"hxPRa8HUuKYsm1kiWDEi","SAM":"G7ILShrCNLfmS0A37SXS",
        "BEN":"BhFRJzCXkJugxsZIDyx8","ANDREW":"ssAN9DUfY5xyHqXqIS6G","BRIFT":"UEKYgullGqaF0keqT8Bu"}  # LYND: UK_F candidate (2026-09-16)
TAG='<break time="0.3s" />'
TEXTS={
 "T1":("Can you describe how you typically use music in your daily life ", "— for example, while working, exercising, or relaxing?"),
 "T2":("If you noticed a broken streetlight on your street, would you report it yourself, ", "or assume someone else will? Why?"),
 # T2W: INT-033 q2 with the tag before "Why?" (JC 2026-09-16 placement)
 "T2W":("If you noticed a broken streetlight on your street, would you report it yourself, or assume someone else will? ", "Why?"),
 "T3":("Can you describe some rules that apply in shared or public spaces where you live, ", "such as rules about noise or parking?"),
}
# variant: "notag", "tag" (0.3 s), or "tagNN" for a 0.NN s break (e.g. "tag06").
import hashlib
sha=lambda t: hashlib.sha1(t.encode()).hexdigest()[:6]
def run(tid, voice, variant, speed=0.92, seed=20260915, fmt="mp3_44100_128"):
    a,b=TEXTS.get(tid,("",""))
    if tid.startswith("S:"):  # whole stem, no break point: "S:<stem>"
        assert variant=="notag"; text=tid[2:]; tid="S"+sha(text)
    elif variant=="notag":
        text=a+b if tid in ("T2","T3") else a.rstrip()+" "+b
    else:
        secs="0.3" if variant=="tag" else f"0.{variant[3:].lstrip('0') or '0'}"
        text=a+f'<break time="{secs}s" /> '+b
    name=f"{tid}_{voice}_{variant}_{int(round(speed*100))}" + (f"_s{seed}" if seed != 20260915 else "")
    path=f"{OUT}/{name}.mp3"; jpath=f"{OUT}/{name}.json"
    if not os.path.exists(jpath):
        body=json.dumps(dict(text=text,model_id="eleven_multilingual_v2",seed=seed,
            voice_settings=dict(stability=0.45,similarity_boost=0.75,style=0.1,use_speaker_boost=True,speed=speed))).encode()
        req=urllib.request.Request(f"https://api.elevenlabs.io/v1/text-to-speech/{VOICES[voice]}/with-timestamps?output_format={fmt}",data=body,headers={"xi-api-key":KEY,"Content-Type":"application/json"})
        r=json.load(urllib.request.urlopen(req,timeout=120))
        open(path,"wb").write(base64.b64decode(r["audio_base64"])); json.dump(dict(text=text,alignment=r["alignment"],normalized=r.get("normalized_alignment")),open(jpath,"w"))
    d=json.load(open(jpath)); al=d["alignment"]
    chars=al["characters"]; st=al["character_start_times_seconds"]; en=al["character_end_times_seconds"]
    s="".join(chars)
    # word spans
    words=[(m.group(), st[m.start()], en[m.end()-1]) for m in re.finditer(r"[^\s]+", s)]
    g=gaps(path)
    return dict(name=name,text=s,words=words,gaps=g)
def boundary(res, left_word_regex):
    ws=res["words"]
    for i,(w,s,e) in enumerate(ws):
        if re.fullmatch(left_word_regex,w) and i+1<len(ws):
            return (w, round(e,2), ws[i+1][0], round(ws[i+1][1],2))
