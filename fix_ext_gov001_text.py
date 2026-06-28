import pathlib
import pandas as pd
import firebase_admin
from firebase_admin import credentials, firestore

BASE_DIR = pathlib.Path(__file__).parent
CRED_PATH = BASE_DIR / "key" / "b10-pp-firebase-adminsdk-260525.json"
CSV_PATH = BASE_DIR / "docs" / "Canonized 2ff2fc7288bd80d18463dcb42428dcdc_all.csv"
PASSAGE_ID = "EXT-GOV-001"

cred = credentials.Certificate(str(CRED_PATH))
firebase_admin.initialize_app(cred)
db = firestore.client()

df = pd.read_csv(CSV_PATH)
match = df[df["Name"].str.strip() == PASSAGE_ID]
if len(match) != 1:
    raise ValueError(f"Expected exactly 1 CSV row for {PASSAGE_ID}, found {len(match)}")

correct_text = str(match.iloc[0]["Passage_Text"]).strip()

doc_ref = db.collection("passages").document(PASSAGE_ID)
doc = doc_ref.get()
if not doc.exists:
    raise ValueError(f"No Firestore document found for {PASSAGE_ID}")

old_text = doc.to_dict().get("passageText", "")
print(f"OLD passageText: {old_text[:80]}...")
print(f"NEW passageText: {correct_text[:80]}...")

doc_ref.update({"passageText": correct_text})
print(f"\nUpdated {PASSAGE_ID}: passageText now matches CSV/current audio.")

# Verify
verify = doc_ref.get().to_dict().get("passageText", "")
print(f"Verification: {'MATCH' if verify == correct_text else 'MISMATCH — something went wrong'}")
