#!/usr/bin/env python3
"""
upload_orient_corpus.py
B10-PP — Upload 18 ORIENT passages to Firebase Storage + Firestore
Run from: ~/b10_corpus/b10_practice_platform/
Usage:    python3 upload_orient_corpus.py [--dry-run]

Audio source: ~/Documents/OPI SLT/B10 Project/B10 Azure/output_mp3_orient/
CSV source:   ~/b10_corpus/b10_practice_platform/docs/b10_orient.csv
Storage:      audio/corpus/ORI/{passageId}.mp3
Firestore:    /passages/{passageId}

corpusType: 'ORI'  taskType: 'PARAPHRASE'  (same scoring prompt as COR)
No arc anchor fields — ORIENT uses no MF vocabulary system.
"""

import os
import sys
import argparse
import pandas as pd
import firebase_admin
from firebase_admin import credentials, firestore, storage

# ── CONFIG ──────────────────────────────────────────────────────────────────

SCRIPT_DIR      = os.path.dirname(os.path.abspath(__file__))
SERVICE_ACCOUNT = os.path.join(SCRIPT_DIR, "service-account.json")

AUDIO_DIR = os.path.expanduser(
    "~/Documents/OPI SLT/B10 Project/B10 Azure/output_mp3_orient"
)

CSV_PATH = os.path.join(SCRIPT_DIR, "docs", "b10_orient.csv")

STORAGE_BUCKET  = "b10-practice-platform.firebasestorage.app"
STORAGE_PREFIX  = "audio/corpus/ORI"
FIRESTORE_COLL  = "passages"

# ── CSV LOADER ───────────────────────────────────────────────────────────────

def load_passage_data(csv_path):
    """Load passageId → {passageText, wordCount, algorithm} from CSV."""
    df = pd.read_csv(csv_path)
    df = df[df["Name"].notna() & df["Passage_Text"].notna()]
    result = {}
    for _, row in df.iterrows():
        pid = row["Name"].strip()
        result[pid] = {
            "passageText": row["Passage_Text"].strip(),
            "wordCount":   int(row["Word Count"]) if pd.notna(row["Word Count"]) else 0,
            "algorithm":   row["Algorithm"].strip() if pd.notna(row["Algorithm"]) else "",
        }
    return result

# ── FIREBASE INIT ────────────────────────────────────────────────────────────

def init_firebase():
    cred = credentials.Certificate(SERVICE_ACCOUNT)
    firebase_admin.initialize_app(cred, {"storageBucket": STORAGE_BUCKET})
    return firestore.client(), storage.bucket()

# ── UPLOAD ONE PASSAGE ────────────────────────────────────────────────────────

def upload_passage(db, bucket, passage_id, mp3_path, data, dry_run=False):
    audio_path = f"{STORAGE_PREFIX}/{passage_id}.mp3"
    has_text   = bool(data.get("passageText"))
    text_flag  = "✅" if has_text else "⚠️  NO TEXT"

    if dry_run:
        print(f"  [DRY RUN] {passage_id}  text:{text_flag}  words:{data.get('wordCount')}  alg:{data.get('algorithm')}")
        return True

    blob = bucket.blob(audio_path)
    blob.upload_from_filename(mp3_path, content_type="audio/mpeg")
    blob.make_public()

    doc_data = {
        "passageId":   passage_id,
        "passageText": data.get("passageText", ""),
        "taskType":    "PARAPHRASE",
        "corpusType":  "ORI",
        "wordCount":   data.get("wordCount", 0),
        "algorithm":   data.get("algorithm", ""),
        "audioPath":   audio_path,
        "status":      "active",
    }

    if not has_text:
        print(f"  ⚠️  WARNING: no passage text for {passage_id}")

    db.collection(FIRESTORE_COLL).document(passage_id).set(doc_data)
    return True

# ── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Upload ORIENT corpus to Firebase.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print what would happen without uploading.")
    args = parser.parse_args()
    dry_run = args.dry_run

    # 1. Load passage data from CSV
    if not os.path.isfile(CSV_PATH):
        print(f"ERROR: CSV not found: {CSV_PATH}")
        sys.exit(1)
    print(f"Loading passage data from:\n  {CSV_PATH}")
    passage_data = load_passage_data(CSV_PATH)
    print(f"  Loaded {len(passage_data)} passages.\n")

    # 2. Collect audio files
    if not os.path.isdir(AUDIO_DIR):
        print(f"ERROR: Audio directory not found: {AUDIO_DIR}")
        sys.exit(1)

    all_files = sorted([f for f in os.listdir(AUDIO_DIR) if f.endswith(".mp3")])
    print(f"Audio files found:  {len(all_files)}")
    print(f"To upload:          {len(all_files)}\n")

    if not dry_run:
        print("Initializing Firebase...")
        db, bucket = init_firebase()
        print("Firebase ready.\n")
    else:
        db, bucket = None, None
        print("=== DRY RUN — no files will be uploaded ===\n")

    # 3. Upload
    success_count = 0
    fail_count    = 0
    no_text       = []

    for filename in all_files:
        passage_id = filename[:-4]  # strip .mp3
        mp3_path   = os.path.join(AUDIO_DIR, filename)
        data       = passage_data.get(passage_id, {})

        if not data:
            print(f"  ⚠️  {passage_id} — no CSV entry found, skipping")
            fail_count += 1
            continue

        if not data.get("passageText"):
            no_text.append(passage_id)

        try:
            upload_passage(db, bucket, passage_id, mp3_path, data, dry_run)
            if not dry_run:
                print(f"  ✅ {passage_id}")
            success_count += 1
        except Exception as e:
            print(f"  ❌ {passage_id}  ERROR: {e}")
            fail_count += 1

    # 4. Summary
    print(f"\n{'='*60}")
    print(f"Done.  Uploaded: {success_count}  |  Errors: {fail_count}")
    if no_text:
        print(f"⚠️  No passage text ({len(no_text)}): {no_text}")
    print(f"{'='*60}")

if __name__ == "__main__":
    main()
