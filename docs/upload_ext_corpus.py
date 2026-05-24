#!/usr/bin/env python3
"""
upload_ext_corpus.py
B10-PP — Upload 71 EXT passages to Firebase Storage + Firestore
Run from: ~/b10_corpus/b10_practice_platform/
Usage:    python3 upload_ext_corpus.py [--dry-run]

Skips:    B10_001.mp3, EXT-TEST-01.mp3, EXT-GOV-001.mp3 (already live)
Storage:  audio/corpus/EXT/{passageId}.mp3
Firestore: /passages/{passageId}

Passage text source: Canonized_Notion_A.CSV (or _B.csv — same EXT rows)
Place either CSV at: ~/b10_corpus/b10_practice_platform/Canonized_Notion_A.CSV
"""

import os
import sys
import re
import argparse
import pandas as pd
import firebase_admin
from firebase_admin import credentials, firestore, storage

# ── CONFIG ──────────────────────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVICE_ACCOUNT = os.path.join(SCRIPT_DIR, "service-account.json")
AUDIO_DIR       = os.path.join(SCRIPT_DIR, "audio", "ext")
ARC_ANCHOR_FILE = os.path.join(SCRIPT_DIR, "B10_EXT_Snorkl_Eval_Criteria_and_Arc_Anchors.txt")

# Accept either CSV filename
CSV_CANDIDATES = [
    os.path.join(SCRIPT_DIR, "Canonized_Notion_A.CSV"),
    os.path.join(SCRIPT_DIR, "Canonized_Notion_A.csv"),
    os.path.join(SCRIPT_DIR, "Canonized_Notion_B.csv"),
]

STORAGE_BUCKET  = "b10-practice-platform.firebasestorage.app"
STORAGE_PREFIX  = "audio/corpus/EXT"
FIRESTORE_COLL  = "passages"

SKIP_FILES = {
    "B10_001.mp3",
    "EXT-TEST-01.mp3",
    "EXT-GOV-001.mp3",   # already live in Firestore + Storage
}

# ── CSV PASSAGE TEXT LOADER ──────────────────────────────────────────────────

def load_passage_texts(candidates):
    """
    Load passageId → passageText from the first CSV found.
    Returns dict: { passageId: passageText }
    Skips rows where Name is null (Notion export artifacts).
    """
    csv_path = None
    for c in candidates:
        if os.path.isfile(c):
            csv_path = c
            break

    if not csv_path:
        print("WARNING: No passage CSV found. passageText will be empty.")
        print(f"  Looked for: {candidates}")
        return {}

    print(f"Loading passage text from: {csv_path}")
    df = pd.read_csv(csv_path)
    df = df[df["Name"].notna() & df["Passage_Text"].notna()]
    # Keep only EXT rows (in case using File B which has COR too)
    df = df[df["Name"].str.startswith("EXT-", na=False)]
    result = dict(zip(df["Name"].str.strip(), df["Passage_Text"].str.strip()))
    print(f"  Loaded {len(result)} EXT passage texts.\n")
    return result


# ── ARC ANCHOR PARSER ────────────────────────────────────────────────────────

def parse_arc_anchors(filepath):
    anchors = {}
    with open(filepath, "r", encoding="utf-8") as f:
        text = f.read()
    entry_pattern = re.compile(
        r"(?m)^\d+\.\s+(EXT-[\w-]+)\s*\|[^\n]*\n"
        r"Common assumption:\s*(.+?)\n"
        r"Actual mechanism:\s*(.+?)(?=\n\d+\.\s+EXT-|\nPART 4|\nEND|\Z)",
        re.DOTALL
    )
    for match in entry_pattern.finditer(text):
        passage_id    = match.group(1).strip()
        common_assump = match.group(2).strip()
        actual_mech   = match.group(3).strip()
        anchors[passage_id] = {
            "commonAssumption": common_assump,
            "actualMechanism":  actual_mech,
        }

    return anchors


# ── FIREBASE INIT ────────────────────────────────────────────────────────────

def init_firebase():
    cred = credentials.Certificate(SERVICE_ACCOUNT)
    firebase_admin.initialize_app(cred, {"storageBucket": STORAGE_BUCKET})
    db     = firestore.client()
    bucket = storage.bucket()
    return db, bucket


# ── UPLOAD ONE PASSAGE ────────────────────────────────────────────────────────

def upload_passage(db, bucket, passage_id, mp3_path, arc_anchors, passage_texts, dry_run=False):
    audio_path   = f"{STORAGE_PREFIX}/{passage_id}.mp3"
    has_anchor   = passage_id in arc_anchors
    has_text     = passage_id in passage_texts
    anchor_flag  = "✅" if has_anchor else "❌ NO ANCHOR"
    text_flag    = "✅" if has_text   else "⚠️  NO TEXT"

    if dry_run:
        print(f"  [DRY RUN] {passage_id}  arc:{anchor_flag}  text:{text_flag}")
        return True

    # 1. Upload to Firebase Storage
    blob = bucket.blob(audio_path)
    blob.upload_from_filename(mp3_path, content_type="audio/mpeg")
    blob.make_public()

    # 2. Build Firestore doc
    anchor = arc_anchors.get(passage_id, {})
    doc_data = {
        "passageId":        passage_id,
        "passageText":      passage_texts.get(passage_id, ""),
        "taskType":         "EXTENDED_LISTENING",
        "corpusType":       "EXT",
        "commonAssumption": anchor.get("commonAssumption", ""),
        "actualMechanism":  anchor.get("actualMechanism",  ""),
        "audioPath":        audio_path,
        "status":           "active",
    }

    if not has_anchor:
        print(f"  ⚠️  WARNING: no arc anchor for {passage_id}")
    if not has_text:
        print(f"  ⚠️  WARNING: no passage text for {passage_id}")

    # 3. Write to Firestore
    db.collection(FIRESTORE_COLL).document(passage_id).set(doc_data)
    return True


# ── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Upload EXT corpus to Firebase.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print what would happen without uploading.")
    args = parser.parse_args()
    dry_run = args.dry_run

    # 1. Load passage texts from CSV
    passage_texts = load_passage_texts(CSV_CANDIDATES)

    # 2. Parse arc anchors
    print(f"Parsing arc anchors from:\n  {ARC_ANCHOR_FILE}\n")
    arc_anchors = parse_arc_anchors(ARC_ANCHOR_FILE)
    print(f"  Found {len(arc_anchors)} arc anchors.\n")

    # 3. Collect audio files
    if not os.path.isdir(AUDIO_DIR):
        print(f"ERROR: Audio directory not found: {AUDIO_DIR}")
        sys.exit(1)

    all_files = sorted([f for f in os.listdir(AUDIO_DIR) if f.endswith(".mp3")])
    to_upload = [f for f in all_files if f not in SKIP_FILES]
    skipped   = [f for f in all_files if f in SKIP_FILES]

    print(f"Audio files found:  {len(all_files)}")
    print(f"Skipping:           {len(skipped)}  → {skipped}")
    print(f"To upload:          {len(to_upload)}\n")

    if not dry_run:
        print("Initializing Firebase...")
        db, bucket = init_firebase()
        print("Firebase ready.\n")
    else:
        db, bucket = None, None
        print("=== DRY RUN — no files will be uploaded ===\n")

    # 4. Upload
    success_count = 0
    fail_count    = 0
    no_anchor     = []
    no_text       = []

    for filename in to_upload:
        passage_id = filename[:-4]  # strip .mp3
        mp3_path   = os.path.join(AUDIO_DIR, filename)

        if passage_id not in arc_anchors:
            no_anchor.append(passage_id)
        if passage_id not in passage_texts:
            no_text.append(passage_id)

        try:
            upload_passage(db, bucket, passage_id, mp3_path,
                           arc_anchors, passage_texts, dry_run)
            if not dry_run:
                print(f"  ✅ {passage_id}")
            success_count += 1
        except Exception as e:
            print(f"  ❌ {passage_id}  ERROR: {e}")
            fail_count += 1

    # 5. Summary
    print(f"\n{'='*60}")
    print(f"Done.  Uploaded: {success_count}  |  Errors: {fail_count}")
    if no_anchor:
        print(f"\n⚠️  No arc anchor ({len(no_anchor)}): {no_anchor}")
    if no_text:
        print(f"⚠️  No passage text ({len(no_text)}): {no_text}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
