import os
import pathlib
import pandas as pd
from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs

BASE_DIR = pathlib.Path(__file__).parent
CSV_PATH = BASE_DIR / "docs" / "Canonized 2ff2fc7288bd80d18463dcb42428dcdc_all.csv"
ID_COL = "Name"
TEXT_COL = "Passage_Text"
STATUS_COL = "Status"
SEGMENT_COL = "Library Segment"
OUT_DIR = BASE_DIR / "audio" / "ext_flash_test"

load_dotenv()
api_key = os.getenv("ELEVENLABS_API_KEY")
voice_id = os.getenv("ELEVENLABS_VOICE_ID")
if not api_key:
    raise ValueError("Missing ELEVENLABS_API_KEY in .env")
if not voice_id:
    raise ValueError("Missing ELEVENLABS_VOICE_ID in .env")

OUT_DIR.mkdir(parents=True, exist_ok=True)

df = pd.read_csv(CSV_PATH)
ext_validated = df[(df[STATUS_COL] == "Validated") & (df[SEGMENT_COL] == "EXT")]
if ext_validated.empty:
    raise ValueError("No Validated EXT passages found")

row = ext_validated.iloc[0]
passage_id = str(row[ID_COL]).strip()
text = str(row[TEXT_COL]).strip()

client = ElevenLabs(api_key=api_key)
audio = client.text_to_speech.convert(
    voice_id=voice_id,
    model_id="eleven_flash_v2_5",
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

out_path = OUT_DIR / f"{passage_id}.mp3"
with open(out_path, "wb") as f:
    for chunk in audio:
        f.write(chunk)

print(f"Saved {out_path}")
print(f"Passage ID: {passage_id}")
print(f"Status: {row[STATUS_COL]} | Segment: {row[SEGMENT_COL]}")
print(f"Characters: {len(text)}")
