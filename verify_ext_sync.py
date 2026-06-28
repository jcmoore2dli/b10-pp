import pathlib
import pandas as pd
import firebase_admin
from firebase_admin import credentials, firestore

BASE_DIR = pathlib.Path(__file__).parent
CRED_PATH = BASE_DIR / "key" / "b10-pp-firebase-adminsdk-260525.json"
CSV_PATH = BASE_DIR / "docs" / "Canonized 2ff2fc7288bd80d18463dcb42428dcdc_all.csv"
SYNC_LOG_PATH = BASE_DIR / "audio" / "ext_sync_log.csv"
COLLECTION = "passages"

cred = credentials.Certificate(str(CRED_PATH))
firebase_admin.initialize_app(cred)
db = firestore.client()

df = pd.read_csv(CSV_PATH)
csv_text_by_id = {str(r["Name"]).strip(): str(r["Passage_Text"]).strip() for _, r in df.iterrows()}

sync_log = pd.read_csv(SYNC_LOG_PATH)
synced_ok = sync_log[sync_log["Result"] == "OK"]

print(f"Verifying {len(synced_ok)} synced EXT passages against live Firestore content...\n")

mismatches = []
for _, row in synced_ok.iterrows():
    passage_id = str(row["Name"]).strip()
    doc = db.collection(COLLECTION).document(passage_id).get()
    if not doc.exists:
        print(f"[MISSING] {passage_id}: document no longer exists?!")
        mismatches.append(passage_id)
        continue

    firestore_text = str(doc.to_dict().get("passageText", "")).strip()
    csv_text = csv_text_by_id.get(passage_id, "")

    if firestore_text != csv_text:
        print(f"[MISMATCH] {passage_id}: Firestore passageText does NOT match CSV text used for audio generation")
        mismatches.append(passage_id)
    else:
        print(f"[OK] {passage_id}")

print(f"\n{'='*50}")
if mismatches:
    print(f"⚠️  {len(mismatches)} MISMATCHES FOUND: {mismatches}")
    print("These passages need investigation before considering EXT sync trustworthy.")
else:
    print(f"✅ All {len(synced_ok)} passages verified — generated audio matches the live Firestore passage text exactly.")

