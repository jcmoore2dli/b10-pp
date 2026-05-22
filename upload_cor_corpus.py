#!/usr/bin/env python3
"""
B10-PP COR Corpus Upload Script
Uploads COR passage MP3s to Firebase Storage and creates Firestore docs.

Usage:
  python3 upload_cor_corpus.py --set 1          # Upload Set 1 only (test run)
  python3 upload_cor_corpus.py --set 1 2 3      # Upload Sets 1, 2, 3
  python3 upload_cor_corpus.py --all            # Upload all 120 passages
  python3 upload_cor_corpus.py --dry-run --all  # Dry run — no uploads

Prerequisites:
  pip3 install firebase-admin --break-system-packages
  Service account key at: ~/b10_corpus/b10_practice_platform/service-account.json

Input files:
  CSV:   ~/b10_corpus/b10_practice_platform/B10PP_A.csv
  Audio: ~/b10_corpus/b10_practice_platform/audio/core/

Output:
  Firestore collection: /passages
  Firebase Storage:     audio/corpus/COR/{passageId}.mp3
  Log file:             ~/b10_corpus/b10_practice_platform/upload_log.txt
"""

import csv
import os
import re
import sys
import argparse
from datetime import datetime

# ── Configuration ──────────────────────────────────────────────────────────

HOME = os.path.expanduser('~')
BASE = os.path.join(HOME, 'b10_corpus', 'b10_practice_platform')
CSV_PATH = os.path.join(BASE, 'B10PP_A.csv')
AUDIO_DIR = os.path.join(BASE, 'audio', 'core')
SERVICE_ACCOUNT = os.path.join(BASE, 'service-account.json')
LOG_PATH = os.path.join(BASE, 'upload_log.txt')
STORAGE_BUCKET = 'b10-practice-platform.firebasestorage.app'
STORAGE_PREFIX = 'audio/corpus/COR'

# Passages already in Firestore — skip these
ALREADY_UPLOADED = {'COR-SCI-002', 'COR-HLT-002', 'COR-ENV-001'}

# Files to skip in audio directory
SKIP_FILES = {'B10_001.mp3', 'EXT-TEST-01.mp3', 'EXT-GOV-001.mp3'}

# ESO source model values (everything else is LEG)
ESO_SOURCE_VALUES = {'ESO'}

# ── Helpers ────────────────────────────────────────────────────────────────

def log(msg, logfile=None):
    timestamp = datetime.now().strftime('%H:%M:%S')
    line = f"[{timestamp}] {msg}"
    print(line)
    if logfile:
        logfile.write(line + '\n')
        logfile.flush()

def strip_prefix(filename):
    """Strip DEMO_R###__ prefix from filename."""
    return re.sub(r'^DEMO_R\d+__', '', filename)

def find_audio_file(passage_id, audio_dir):
    """Find audio file for a passage ID — with or without prefix."""
    # Try with prefix pattern
    for f in os.listdir(audio_dir):
        clean = strip_prefix(f).replace('.mp3', '')
        if clean == passage_id:
            return os.path.join(audio_dir, f)
    return None

def normalize_tier(tier_str):
    """Normalize tier string to integer."""
    if not tier_str:
        return None
    match = re.search(r'\d+', tier_str)
    return int(match.group()) if match else None

def normalize_source(source_str):
    """Normalize source model to ESO or LEG."""
    if not source_str:
        return 'LEG'
    return 'ESO' if source_str.strip() in ESO_SOURCE_VALUES else 'LEG'

def derive_eso_question_id(passage_id, source):
    """
    Derive ESO question ID from passage ID for ESO-derived passages.
    COR-EDU-001 → EDU-001
    Returns None for LEG passages.
    """
    if source != 'ESO':
        return None
    # Strip COR- prefix
    return re.sub(r'^COR-', '', passage_id)

# ── Main ───────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Upload COR corpus to Firebase')
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--set', nargs='+', type=int, help='Set number(s) to upload')
    group.add_argument('--all', action='store_true', help='Upload all active passages')
    parser.add_argument('--dry-run', action='store_true', help='Simulate without uploading')
    args = parser.parse_args()

    # ── Load CSV ──────────────────────────────────────────────────────────
    if not os.path.exists(CSV_PATH):
        print(f"ERROR: CSV not found at {CSV_PATH}")
        print(f"Please copy B10PP_A.csv to {BASE}/")
        sys.exit(1)

    with open(CSV_PATH, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        all_rows = list(reader)

    # Filter to Active only
    active_rows = [r for r in all_rows if r.get('Status', '').strip() == 'Active']
    print(f"Loaded {len(active_rows)} active passages from CSV")

    # Filter by set if specified
    if args.set:
        target_sets = set(str(s) for s in args.set)
        rows = [r for r in active_rows if r.get('Set', '').strip() in target_sets]
        print(f"Filtered to sets {args.set}: {len(rows)} passages")
    else:
        rows = active_rows
        print(f"Uploading all {len(rows)} active passages")

    if args.dry_run:
        print("\n*** DRY RUN MODE — no uploads will occur ***\n")

    # ── Initialize Firebase (skip in dry run) ─────────────────────────────
    db = None
    bucket = None
    if not args.dry_run:
        try:
            import firebase_admin
            from firebase_admin import credentials, firestore, storage
            if not firebase_admin._apps:
                cred = credentials.Certificate(SERVICE_ACCOUNT)
                firebase_admin.initialize_app(cred, {'storageBucket': STORAGE_BUCKET})
            db = firestore.client()
            bucket = storage.bucket()
            print("Firebase initialized ✅")
        except Exception as e:
            print(f"ERROR initializing Firebase: {e}")
            print(f"Make sure service-account.json is at: {SERVICE_ACCOUNT}")
            sys.exit(1)

    # ── Process passages ──────────────────────────────────────────────────
    results = {'uploaded': [], 'skipped': [], 'missing_audio': [], 'errors': []}

    with open(LOG_PATH, 'w') as logfile:
        log(f"B10-PP COR Upload — {datetime.now().strftime('%Y-%m-%d %H:%M')}", logfile)
        log(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}", logfile)
        log(f"Passages to process: {len(rows)}", logfile)
        log('─' * 60, logfile)

        for r in rows:
            passage_id = r['Name'].strip()

            # Skip already uploaded
            if passage_id in ALREADY_UPLOADED:
                log(f"SKIP (already uploaded): {passage_id}", logfile)
                results['skipped'].append(passage_id)
                continue

            # Find audio file
            audio_path = find_audio_file(passage_id, AUDIO_DIR)
            if not audio_path:
                log(f"MISSING AUDIO: {passage_id}", logfile)
                results['missing_audio'].append(passage_id)
                continue

            # Build Firestore doc
            source = normalize_source(r.get('Source Model', ''))
            eso_question_id = derive_eso_question_id(passage_id, source)
            tier = normalize_tier(r.get('Tier Type', ''))
            domain = r.get('Domain 1', '').strip()
            algorithm = r.get('Algorithm', '').strip()
            set_num = r.get('Set', '').strip()
            passage_text = r.get('Passage_Text', '').strip()
            word_count_str = r.get('Word Count', '').strip()
            word_count = int(word_count_str) if word_count_str.isdigit() else None

            storage_path = f"{STORAGE_PREFIX}/{passage_id}.mp3"

            doc_data = {
                'passageId':      passage_id,
                'passageText':    passage_text,
                'taskType':       'PARAPHRASE',
                'corpusType':     'COR',
                'set':            int(set_num) if set_num.isdigit() else None,
                'tier':           tier,
                'domain':         domain,
                'algorithm':      algorithm,
                'source':         source,
                'esoQuestionId':  eso_question_id,
                'wordCount':      word_count,
                'audioPath':      storage_path,
                'status':         'active',
            }

            if args.dry_run:
                log(f"DRY RUN — would upload: {passage_id}", logfile)
                log(f"  Audio:   {os.path.basename(audio_path)}", logfile)
                log(f"  Storage: {storage_path}", logfile)
                log(f"  Set: {set_num} | Tier: {tier} | Domain: {domain} | Source: {source}", logfile)
                log(f"  esoQuestionId: {eso_question_id}", logfile)
                log(f"  Text (first 80): {passage_text[:80]}", logfile)
                results['uploaded'].append(passage_id)
                continue

            # Upload MP3 to Firebase Storage
            try:
                blob = bucket.blob(storage_path)
                blob.upload_from_filename(audio_path, content_type='audio/mpeg')
                log(f"STORAGE OK: {passage_id} → {storage_path}", logfile)
            except Exception as e:
                log(f"STORAGE ERROR: {passage_id} — {e}", logfile)
                results['errors'].append(passage_id)
                continue

            # Write Firestore doc
            try:
                db.collection('passages').document(passage_id).set(doc_data)
                log(f"FIRESTORE OK: {passage_id} (Set {set_num}, {source}, {domain})", logfile)
                results['uploaded'].append(passage_id)
            except Exception as e:
                log(f"FIRESTORE ERROR: {passage_id} — {e}", logfile)
                results['errors'].append(passage_id)

        # ── Summary ───────────────────────────────────────────────────────
        log('─' * 60, logfile)
        log(f"SUMMARY:", logfile)
        log(f"  Uploaded:      {len(results['uploaded'])}", logfile)
        log(f"  Skipped:       {len(results['skipped'])}", logfile)
        log(f"  Missing audio: {len(results['missing_audio'])}", logfile)
        log(f"  Errors:        {len(results['errors'])}", logfile)
        if results['missing_audio']:
            log(f"\nMISSING AUDIO FILES:", logfile)
            for p in results['missing_audio']:
                log(f"  {p}", logfile)
        if results['errors']:
            log(f"\nERRORS:", logfile)
            for p in results['errors']:
                log(f"  {p}", logfile)

    print(f"\nLog saved to: {LOG_PATH}")

if __name__ == '__main__':
    main()
