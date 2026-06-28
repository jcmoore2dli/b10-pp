import pathlib
import pandas as pd
import firebase_admin
from firebase_admin import credentials, firestore

BASE_DIR = pathlib.Path(__file__).parent
CRED_PATH = BASE_DIR / "key" / "b10-pp-firebase-adminsdk-260525.json"
CSV_PATH = BASE_DIR / "docs" / "Canonized 2ff2fc7288bd80d18463dcb42428dcdc_all.csv"

PENDING_IDS = [
    "EXT-1A-01", "EXT-CUL-001", "EXT-3A-03", "EXT-CUL-007", "EXT-4A-01",
    "EXT-EDU-002", "EXT-4B-02", "EXT-5B-01", "EXT-ENV-004", "EXT-6B-03",
]

cred = credentials.Certificate(str(CRED_PATH))
firebase_admin.initialize_app(cred)
db = firestore.client()

df = pd.read_csv(CSV_PATH)

for passage_id in PENDING_IDS:
    print(f"=== {passage_id} ===")
    match = df[df["Name"].str.strip() == passage_id]
    if match.empty:
        print("  CSV: NOT FOUND")
        continue
    csv_text = str(match.iloc[0]["Passage_Text"]).strip()
    print(f"  CSV  : {csv_text[:90]}...")

    doc = db.collection("passages").document(passage_id).get()
    if not doc.exists:
        print("  Firestore: DOCUMENT DOES NOT EXIST")
        print()
        continue

    fs_text = str(doc.to_dict().get("passageText", "")).strip()
    print(f"  Fire : {fs_text[:90]}...")

    if csv_text == fs_text:
        print("  STATUS: MATCH")
    else:
        print("  STATUS: MISMATCH")
    print()
