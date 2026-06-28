import pathlib
import pandas as pd
import firebase_admin
from firebase_admin import credentials, firestore

BASE_DIR = pathlib.Path(__file__).parent
CRED_PATH = BASE_DIR / "key" / "b10-pp-firebase-adminsdk-260525.json"
CSV_PATH = BASE_DIR / "docs" / "Canonized 2ff2fc7288bd80d18463dcb42428dcdc_all.csv"

cred = credentials.Certificate(str(CRED_PATH))
firebase_admin.initialize_app(cred)
db = firestore.client()

df = pd.read_csv(CSV_PATH)
matches = df[df["Name"].str.strip() == "EXT-GOV-001"]
print(f"Rows in CSV named EXT-GOV-001: {len(matches)}")
for i, r in matches.iterrows():
    print(f"\n--- CSV row {i} ---")
    print(f"Status: {r['Status']} | Word Count: {r['Word Count']}")
    print(repr(r["Passage_Text"]))

doc = db.collection("passages").document("EXT-GOV-001").get()
print(f"\n--- Firestore passageText ---")
print(repr(doc.to_dict().get("passageText", "")))
