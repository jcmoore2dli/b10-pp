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
csv_text_by_id = {str(r["Name"]).strip(): str(r["Passage_Text"]).strip() for _, r in df.iterrows()}

targets = []
for _, r in df[(df["Library Segment"]=="CORE") & (df["Status"]=="Active")].iterrows():
    targets.append(str(r["Name"]).strip())
for _, r in df[(df["Library Segment"]=="ORIENT") & (df["Status"]=="Validated")].iterrows():
    targets.append(str(r["Name"]).strip())

print(f"Verifying {len(targets)} CORE+ORIENT passages...\n")
mismatches = []
for passage_id in targets:
    doc = db.collection("passages").document(passage_id).get()
    if not doc.exists:
        print(f"[MISSING] {passage_id}")
        mismatches.append(passage_id)
        continue
    fs_text = str(doc.to_dict().get("passageText","")).strip()
    csv_text = csv_text_by_id.get(passage_id, "")
    if fs_text != csv_text:
        print(f"[MISMATCH] {passage_id}")
        mismatches.append(passage_id)

print(f"\n{'='*50}")
if mismatches:
    print(f"⚠️  {len(mismatches)} issues found: {mismatches}")
else:
    print(f"✅ All {len(targets)} passages verified clean.")
