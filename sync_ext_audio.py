import pathlib
import pandas as pd
import firebase_admin
from firebase_admin import credentials, firestore, storage
from datetime import datetime

BASE_DIR = pathlib.Path(__file__).parent
CRED_PATH = BASE_DIR / "key" / "b10-pp-firebase-adminsdk-260525.json"
MANIFEST_PATH = BASE_DIR / "audio" / "ext_full_manifest.csv"
STORAGE_BUCKET = "b10-practice-platform.firebasestorage.app"
COLLECTION = "passages"

cred = credentials.Certificate(str(CRED_PATH))
firebase_admin.initialize_app(cred, {"storageBucket": STORAGE_BUCKET})
db = firestore.client()
bucket = storage.bucket()
print(f"Using bucket: {bucket.name}")

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

manifest = pd.read_csv(MANIFEST_PATH)
to_sync = manifest[manifest["Result"] == "OK"].copy()
print(f"Found {len(to_sync)} successfully generated EXT passages to sync.")

sync_log = []

for i, row in to_sync.iterrows():
    passage_id = str(row["Name"]).strip()
    local_path = pathlib.Path(row["Output_Path"])
    storage_path = f"audio/corpus/EXT/{passage_id}.mp3"

    result = "OK"
    try:
        if not local_path.exists():
            raise FileNotFoundError(f"Local MP3 not found: {local_path}")

        doc_ref = db.collection(COLLECTION).document(passage_id)
        if not doc_ref.get().exists:
            raise ValueError(f"No Firestore document found for {passage_id} — skipping to avoid creating a stray doc")

        blob = bucket.blob(storage_path)
        blob.upload_from_filename(str(local_path), content_type="audio/mpeg")

        doc_ref.update({
            "audioPath": storage_path,
            "audioGeneration": {
                **AUDIO_GENERATION_META,
                "syncedAt": firestore.SERVER_TIMESTAMP,
            },
        })
        print(f"[{i+1}/{len(to_sync)}] Synced {passage_id}")

    except Exception as e:
        result = f"ERROR: {e}"
        print(f"[{i+1}/{len(to_sync)}] FAILED {passage_id}: {e}")

    sync_log.append({
        "Name": passage_id,
        "StoragePath": storage_path,
        "Result": result,
        "SyncedAt": datetime.now().isoformat(timespec="seconds"),
    })

sync_log_df = pd.DataFrame(sync_log)
sync_log_path = BASE_DIR / "audio" / "ext_sync_log.csv"
sync_log_df.to_csv(sync_log_path, index=False)

success_count = (sync_log_df["Result"] == "OK").sum()
print(f"\nDone. {success_count}/{len(sync_log_df)} synced successfully.")
print(f"Sync log written to {sync_log_path}")
if success_count < len(sync_log_df):
    print("⚠️  Some passages failed — check ext_sync_log.csv for details before considering this batch complete.")
