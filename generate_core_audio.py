import os
import time
import pathlib
import pandas as pd
from datetime import datetime
from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs

BASE_DIR = pathlib.Path(__file__).parent
CSV_PATH = BASE_DIR / "docs" / "Canonized 26 06 20_B.csv"
ID_COL = "Name"
TEXT_COL = "Passage_Text"
STATUS_COL = "Status"
SEGMENT_COL = "Library Segment"
ROLLOUT_COL = "Rollout_Number"
OUT_DIR = BASE_DIR / "audio" / "core_full"
MANIFEST_PATH = BASE_DIR / "audio" / "core_full_manifest.csv"

load_dotenv()
api_key = os.getenv("ELEVENLABS_API_KEY")
voice_id = os.getenv("ELEVENLABS_VOICE_ID")
if not api_key:
    raise ValueError("Missing ELEVENLABS_API_KEY in .env")
if not voice_id:
    raise ValueError("Missing ELEVENLABS_VOICE_ID in .env")

OUT_DIR.mkdir(parents=True, exist_ok=True)

df = pd.read_csv(CSV_PATH)
active_core = df[(df[STATUS_COL] == "Active") & (df[SEGMENT_COL] == "CORE")].copy()
if active_core.empty:
    raise ValueError("No Active CORE passages found — check Status/Library Segment filters")

active_core[ROLLOUT_COL] = pd.to_numeric(active_core[ROLLOUT_COL], errors="coerce")
active_core = active_core.sort_values(by=[ROLLOUT_COL, ID_COL]).reset_index(drop=True)

print(f"Found {len(active_core)} Active CORE passages to generate.")

client = ElevenLabs(api_key=api_key)
manifest_rows = []

for i, row in active_core.iterrows():
    passage_id = str(row[ID_COL]).strip()
    text = str(row[TEXT_COL]).strip()
    rollout = row[ROLLOUT_COL]

    out_path = OUT_DIR / f"{passage_id}.mp3"
    status_note = "OK"

    try:
        audio = client.text_to_speech.convert(
            voice_id=voice_id,
            model_id="eleven_multilingual_v2",
            output_format="mp3_44100_128",
            text=text,
            voice_settings={
                "stability": 0.76,
                "similarity_boost": 0.80,
                "style": 0.0,
                "use_speaker_boost": True,
                "speed": 1.05,
            },
        )
        with open(out_path, "wb") as f:
            for chunk in audio:
                f.write(chunk)
        print(f"[{i+1}/{len(active_core)}] Saved {passage_id} (rollout {rollout})")
    except Exception as e:
        status_note = f"ERROR: {e}"
        print(f"[{i+1}/{len(active_core)}] FAILED {passage_id}: {e}")

    manifest_rows.append({
        "Rollout_Number": rollout,
        "Name": passage_id,
        "Status": row[STATUS_COL],
        "Library_Segment": row[SEGMENT_COL],
        "Word_Count": row.get("Word Count", ""),
        "Characters": len(text),
        "Output_Path": str(out_path) if status_note == "OK" else "",
        "Result": status_note,
        "Generated_At": datetime.now().isoformat(timespec="seconds"),
    })

    time.sleep(0.3)

manifest_df = pd.DataFrame(manifest_rows)
manifest_df.to_csv(MANIFEST_PATH, index=False)
print(f"\nDone. Manifest written to {MANIFEST_PATH}")
print(f"Success: {(manifest_df['Result']=='OK').sum()} / {len(manifest_df)}")
