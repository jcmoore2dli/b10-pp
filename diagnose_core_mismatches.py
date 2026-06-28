import pathlib
import pandas as pd
import firebase_admin
from firebase_admin import credentials, firestore

BASE_DIR = pathlib.Path(__file__).parent
CRED_PATH = BASE_DIR / "key" / "b10-pp-firebase-adminsdk-260525.json"
CSV_PATH = BASE_DIR / "docs" / "Canonized 2ff2fc7288bd80d18463dcb42428dcdc_all.csv"

MISMATCH_IDS = ["COR-GOV-022", "COR-SCI-004", "COR-SOC-001", "COR-TEC-006", "COR-TEC-007"]

cred = credentials.Certificate(str(CRED_PATH))
firebase_admin.initialize_app(cred)
db = firestore.client()

df = pd.read_csv(CSV_PATH)

for passage_id in MISMATCH_IDS:
    print(f"\n{'='*60}\n{passage_id}\n{'='*60}")
    match = df[df["Name"].str.strip() == passage_id]
    csv_text = str(match.iloc[0]["Passage_Text"]).strip() if not match.empty else "NOT FOUND"
    print(f"\n--- CSV ---\n{csv_text}")

    doc = db.collection("passages").document(passage_id).get()
    fs_text = str(doc.to_dict().get("passageText", "")).strip() if doc.exists else "DOC NOT FOUND"
    print(f"\n--- Firestore ---\n{fs_text}")

