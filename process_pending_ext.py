import os
import time
import pathlib
import pandas as pd
from datetime import datetime
from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs
import firebase_admin
from firebase_admin import credentials, firestore, storage

BASE_DIR = pathlib.Path(__file__).parent
CSV_PATH = BASE_DIR / "docs" / "Canonized 2ff2fc7288bd80d18463dcb42428dcdc_all.csv"
CRED_PATH = BASE_DIR / "key" / "b10-pp-firebase-adminsdk-260525.json"
STORAGE_BUCKET = "b10-practice-platform.firebasestorage.app"
COLLECTION = "passages"
OUT_DIR = BASE_DIR / "audio" / "ext_full"
LOG_PATH = BASE_DIR / "audio" / "ext_pending_fix_log.csv"

PENDING_IDS = [
    "EXT-1A-01", "EXT-CUL-001", "EXT-3A-03", "EXT-CUL-007", "EXT-4A-01",
    "EXT-EDU-002", "EXT-4B-02", "EXT-5B-01", "EXT-ENV-004", "EXT-6B-03",
]

load_dotenv()
api_key = os.getenv("ELEVENLABS_API_KEY")
voice_id = os.getenv("ELEVENLABS_VOICE_ID")

cred = credentials.Certificate(str(CRED_PATH))
firebase_admin.initialize_app(cred, {"storageBucket": STORAGE_BUCKET})
db = firestore.client()
bucket = storage.bucket()

client = ElevenLabs(api_key=api_key)
df = pd.read_csv(CSV_PATH)

AUDIO_GENERATION_META = {
    "voice": "Nichalia Schwartz – Bright and Friendly",
    "model": "eleven_flash_v2_5",
    "speed": 1.05,
    "stability": 0.76,
    "similarity": 0.80,
    "styleExaggeration": 0.0,
    "speakerBoost": True,
    "outputFormat": "mp3_44100_128",
}

OUT_DIR.mkdir(parents=True, exist_ok=True)
log = []

for i, passage_id in enumerate(PENDING_IDS):
    match = df[df["Name"].str.strip() == passage_id]
    result = "OK"
    try:
        if match.empty:
            raise ValueError("Not found in CSV")
        text = str(match.iloc[0]["Passage_Text"]).strip()

        doc_ref = db.collection(COLLECTION).document(passage_id)
        if not doc_ref.get().exists:
            raise ValueError("No Firestore document found")

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

        storage_path = f"audio/corpus/EXT/{passage_id}.mp3"
        bucket.blob(storage_path).upload_from_filename(str(out_path), content_type="audio/mpeg")

        doc_ref.update({
            "audioPath": storage_path,
            "audioGeneration": {**AUDIO_GENERATION_META, "syncedAt": firestore.SERVER_TIMESTAMP},
        })
        print(f"[{i+1}/{len(PENDING_IDS)}] DONE {passage_id}")

    except Exception as e:
        result = f"ERROR: {e}"
        print(f"[{i+1}/{len(PENDING_IDS)}] FAILED {passage_id}: {e}")

    log.append({"Name": passage_id, "Result": result, "Timestamp": datetime.now().isoformat(timespec="seconds")})
    time.sleep(0.3)

log_df = pd.DataFrame(log)
log_df.to_csv(LOG_PATH, index=False)
print(f"\nDone. {(log_df['Result']=='OK').sum()}/{len(log_df)} processed. Log: {LOG_PATH}")
