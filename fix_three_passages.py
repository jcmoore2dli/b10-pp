import pathlib
import firebase_admin
from firebase_admin import credentials, firestore, storage

BASE_DIR = pathlib.Path(__file__).parent
CRED_PATH = BASE_DIR / "key" / "b10-pp-firebase-adminsdk-260525.json"
STORAGE_BUCKET = "b10-practice-platform.firebasestorage.app"
COLLECTION = "passages"

cred = credentials.Certificate(str(CRED_PATH))
firebase_admin.initialize_app(cred, {"storageBucket": STORAGE_BUCKET})
db = firestore.client()
bucket = storage.bucket()

# Map: malformed CSV name (and its local file) -> correct Firestore doc ID
FIXES = {
    "COR-BIO-007 (1)": "COR-BIO-007",
    "COR- HLT-025": "COR-HLT-025",
    "COR-TEC-032 (1)": "COR-TEC-032",
}

for malformed_name, clean_id in FIXES.items():
    local_path = BASE_DIR / "audio" / "core_full" / f"{malformed_name}.mp3"
    if not local_path.exists():
        print(f"SKIP {clean_id}: local file not found at {local_path}")
        continue

    doc_ref = db.collection(COLLECTION).document(clean_id)
    if not doc_ref.get().exists:
        print(f"SKIP {clean_id}: no Firestore document found — needs manual review")
        continue

    storage_path = f"audio/corpus/COR/{clean_id}.mp3"
    bucket.blob(storage_path).upload_from_filename(str(local_path), content_type="audio/mpeg")
    doc_ref.update({
        "audioPath": storage_path,
        "audioGeneration": {
            "voice": "Nichalia Schwartz – Bright and Friendly",
            "model": "eleven_multilingual_v2",
            "speed": 1.05,
            "stability": 0.76,
            "similarity": 0.80,
            "styleExaggeration": 0.0,
            "speakerBoost": True,
            "outputFormat": "mp3_44100_128",
            "syncedAt": firestore.SERVER_TIMESTAMP,
        },
    })
    print(f"FIXED: {malformed_name} -> {clean_id}")
