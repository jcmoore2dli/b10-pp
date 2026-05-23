#!/usr/bin/env python3
"""
B10-PP ESO Question Upload Script
Uploads 60 [CURR] ESO questions to Firestore /passages collection.

Usage:
  python3 upload_eso_questions.py --dry-run    # Simulate without uploading
  python3 upload_eso_questions.py              # Live upload

Prerequisites:
  Service account key at: ~/b10_corpus/b10_practice_platform/service-account.json

Output:
  Firestore collection: /passages
  Document ID: ESO question ID (e.g., EDU-001)
  Log file: ~/b10_corpus/b10_practice_platform/upload_eso_log.txt
"""

import os
import sys
import argparse
from datetime import datetime

# ── ESO Question Data ──────────────────────────────────────────────────────
# All 60 [CURR] questions from B10-CC-ESO Beta 10.3
# Organized by domain with set mapping derived from COR corpus

ESO_QUESTIONS = {
    # EDU — Education & Learning
    'EDU-001': {'question': 'Should standardized testing be eliminated as the main tool for measuring student achievement?', 'domain': 'EDU', 'algorithm': 'A02'},
    'EDU-003': {'question': 'Should college education be free for all students?', 'domain': 'EDU', 'algorithm': 'A02'},
    'EDU-005': {'question': 'Should vocational education be expanded in secondary schools?', 'domain': 'EDU', 'algorithm': 'A02'},
    'EDU-006': {'question': 'Should financial literacy be a required subject in school curricula?', 'domain': 'EDU', 'algorithm': 'A02'},
    'EDU-012': {'question': 'Should schools teach critical media literacy as a required subject?', 'domain': 'EDU', 'algorithm': 'A02'},
    'EDU-015': {'question': 'Should governments provide financial incentives to address teacher shortages in rural areas?', 'domain': 'EDU', 'algorithm': 'A02'},
    'EDU-018': {'question': 'Should teacher salaries be significantly increased?', 'domain': 'EDU', 'algorithm': 'A02'},
    'EDU-022': {'question': 'Should class sizes be reduced in public schools?', 'domain': 'EDU', 'algorithm': 'A02'},
    'EDU-025': {'question': 'Should arts education be mandatory in all schools?', 'domain': 'EDU', 'algorithm': 'A02'},
    # WRK — Labor & Employment
    'WRK-003': {'question': 'Should workers have the legal right to disconnect from work communications outside office hours?', 'domain': 'WRK', 'algorithm': 'A02'},
    'WRK-007': {'question': 'Should a four-day work week be adopted as national labor policy?', 'domain': 'WRK', 'algorithm': 'A03'},
    'WRK-008': {'question': 'Should parental leave be significantly extended?', 'domain': 'WRK', 'algorithm': 'A02'},
    'WRK-012': {'question': 'Should governments raise the minimum wage to ensure a living standard?', 'domain': 'WRK', 'algorithm': 'A02'},
    'WRK-015': {'question': 'Should the retirement age be raised?', 'domain': 'WRK', 'algorithm': 'A02'},
    # ECN — Economic Systems
    'ECN-008': {'question': 'Should workers in app-based or platform jobs be classified as employees with full benefits?', 'domain': 'ECN', 'algorithm': 'A02'},
    'ECN-012': {'question': 'Should governments do more to protect consumers from high-interest loans and exploitative lending practices?', 'domain': 'ECN', 'algorithm': 'A02'},
    'ECN-018': {'question': 'Should subscription pricing models be regulated to protect consumers?', 'domain': 'ECN', 'algorithm': 'A02'},
    # GOV — Governance & Civic Life
    'GOV-003': {'question': 'Should voting be mandatory for all citizens?', 'domain': 'GOV', 'algorithm': 'A02'},
    'GOV-008': {'question': 'Should campaign contributions be limited by law?', 'domain': 'GOV', 'algorithm': 'A02'},
    'GOV-012': {'question': 'Should there be term limits for legislators?', 'domain': 'GOV', 'algorithm': 'A02'},
    'GOV-015': {'question': 'Should the practice of manipulating electoral district boundaries for political advantage be prohibited by law?', 'domain': 'GOV', 'algorithm': 'A02'},
    'GOV-018': {'question': 'Should lobbying be more strictly regulated?', 'domain': 'GOV', 'algorithm': 'A02'},
    'GOV-022': {'question': 'Should employees who report government or corporate wrongdoing receive stronger legal protections?', 'domain': 'GOV', 'algorithm': 'A02'},
    'GOV-025': {'question': 'Should political advertising be regulated?', 'domain': 'GOV', 'algorithm': 'A02'},
    # HLT — Health & Medicine
    'HLT-005': {'question': 'Should sugary drinks be taxed to discourage unhealthy consumption?', 'domain': 'HLT', 'algorithm': 'A02'},
    'HLT-008': {'question': 'Should organ donation be opt-out by default?', 'domain': 'HLT', 'algorithm': 'A08'},
    'HLT-012': {'question': 'Should vaccinations be mandatory for all schoolchildren?', 'domain': 'HLT', 'algorithm': 'A02'},
    'HLT-015': {'question': 'Should pharmaceutical advertising to consumers be restricted?', 'domain': 'HLT', 'algorithm': 'A08'},
    'HLT-018': {'question': 'Should processed foods carry warning labels?', 'domain': 'HLT', 'algorithm': 'A02'},
    'HLT-020': {'question': 'Should prescription drug prices be regulated by government?', 'domain': 'HLT', 'algorithm': 'A02'},
    'HLT-022': {'question': 'Should healthcare be provided universally to all citizens?', 'domain': 'HLT', 'algorithm': 'A08'},
    'HLT-025': {'question': 'Should alternative medicine be regulated for safety?', 'domain': 'HLT', 'algorithm': 'A08'},
    'HLT-028': {'question': 'Should mental health services be significantly expanded?', 'domain': 'HLT', 'algorithm': 'A02'},
    'HLT-032': {'question': 'Should end-of-life care decision-making be expanded for patients?', 'domain': 'HLT', 'algorithm': 'A05'},
    # TEC — Technology & Digital Society
    'TEC-003': {'question': 'Should social media have age restrictions for minors?', 'domain': 'TEC', 'algorithm': 'A02'},
    'TEC-008': {'question': 'Should facial recognition technology be banned in public spaces?', 'domain': 'TEC', 'algorithm': 'A02'},
    'TEC-012': {'question': 'Should AI-generated content be labeled as such?', 'domain': 'TEC', 'algorithm': 'A02'},
    'TEC-015': {'question': 'Should technology companies be required to give law enforcement access to encrypted devices and communications?', 'domain': 'TEC', 'algorithm': 'A02'},
    'TEC-018': {'question': 'Should autonomous vehicles be allowed on public roads?', 'domain': 'TEC', 'algorithm': 'A02'},
    'TEC-022': {'question': 'Should data brokers be regulated to protect consumer privacy?', 'domain': 'TEC', 'algorithm': 'A02'},
    'TEC-025': {'question': 'Should genetic engineering of humans be permitted?', 'domain': 'TEC', 'algorithm': 'A02'},
    'TEC-028': {'question': 'Should space resources be privately owned?', 'domain': 'TEC', 'algorithm': 'A02'},
    'TEC-032': {'question': 'Should brain-computer interfaces be regulated?', 'domain': 'TEC', 'algorithm': 'A02'},
    'TEC-035': {'question': 'Should algorithmic hiring be regulated to prevent bias?', 'domain': 'TEC', 'algorithm': 'A02'},
    # ENV — Environment & Resources
    'ENV-003': {'question': 'Should carbon taxes be implemented to address climate change?', 'domain': 'ENV', 'algorithm': 'A02'},
    'ENV-008': {'question': 'Should single-use plastics be banned?', 'domain': 'ENV', 'algorithm': 'A02'},
    'ENV-012': {'question': 'Should deforestation be banned globally?', 'domain': 'ENV', 'algorithm': 'A02'},
    'ENV-015': {'question': 'Should nuclear energy be expanded as part of climate policy?', 'domain': 'ENV', 'algorithm': 'A02'},
    'ENV-018': {'question': 'Should water usage be rationed during shortages?', 'domain': 'ENV', 'algorithm': 'A02'},
    # JUS — Justice & Rights
    'JUS-003': {'question': 'Should the death penalty be abolished?', 'domain': 'JUS', 'algorithm': 'A02'},
    'JUS-005': {'question': 'Should defendants be released before trial based on risk assessment rather than ability to pay?', 'domain': 'JUS', 'algorithm': 'A02'},
    'JUS-008': {'question': 'Should marijuana possession be decriminalized?', 'domain': 'JUS', 'algorithm': 'A02'},
    'JUS-015': {'question': 'Should restorative justice programs replace traditional incarceration?', 'domain': 'JUS', 'algorithm': 'A08'},
    # INT — International Systems
    'INT-004': {'question': 'Should countries accept more refugees?', 'domain': 'INT', 'algorithm': 'A02'},
    'INT-006': {'question': 'Should refugee integration programs be expanded?', 'domain': 'INT', 'algorithm': 'A02'},
    'INT-008': {'question': 'Should international trade agreements prioritize labor standards?', 'domain': 'INT', 'algorithm': 'A02'},
    'INT-012': {'question': 'Should sanctions be used as a foreign policy tool?', 'domain': 'INT', 'algorithm': 'A03'},
    # CUL — Culture & Society
    'CUL-005': {'question': 'Should cultural appropriation be regulated?', 'domain': 'CUL', 'algorithm': 'A02'},
    'CUL-012': {'question': 'Should cultural heritage sites be protected from development?', 'domain': 'CUL', 'algorithm': 'A02'},
    # SOC — Social Systems
    'SOC-010': {'question': 'Should social media platforms be required to moderate harmful content?', 'domain': 'SOC', 'algorithm': 'A02'},
}

HOME = os.path.expanduser('~')
BASE = os.path.join(HOME, 'b10_corpus', 'b10_practice_platform')
SERVICE_ACCOUNT = os.path.join(BASE, 'service-account.json')
LOG_PATH = os.path.join(BASE, 'upload_eso_log.txt')
STORAGE_BUCKET = 'b10-practice-platform.firebasestorage.app'

def log(msg, logfile=None):
    timestamp = datetime.now().strftime('%H:%M:%S')
    line = f"[{timestamp}] {msg}"
    print(line)
    if logfile:
        logfile.write(line + '\n')
        logfile.flush()

def main():
    parser = argparse.ArgumentParser(description='Upload ESO questions to Firestore')
    parser.add_argument('--dry-run', action='store_true', help='Simulate without uploading')
    args = parser.parse_args()

    if args.dry_run:
        print(f"\n*** DRY RUN MODE — no uploads will occur ***\n")
        print(f"Would upload {len(ESO_QUESTIONS)} ESO questions")
        for qid, data in list(ESO_QUESTIONS.items())[:5]:
            print(f"  {qid} | {data['domain']} | {data['question'][:60]}...")
        print(f"  ... and {len(ESO_QUESTIONS) - 5} more")
        return

    # Initialize Firebase
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
        if not firebase_admin._apps:
            cred = credentials.Certificate(SERVICE_ACCOUNT)
            firebase_admin.initialize_app(cred, {'storageBucket': STORAGE_BUCKET})
        db = firestore.client()
        print("Firebase initialized ✅")
    except Exception as e:
        print(f"ERROR initializing Firebase: {e}")
        sys.exit(1)

    results = {'uploaded': [], 'skipped': [], 'errors': []}

    with open(LOG_PATH, 'w') as logfile:
        log(f"B10-PP ESO Upload — {datetime.now().strftime('%Y-%m-%d %H:%M')}", logfile)
        log(f"Questions to upload: {len(ESO_QUESTIONS)}", logfile)
        log('─' * 60, logfile)

        for qid, data in ESO_QUESTIONS.items():
            # Check if already exists
            try:
                existing = db.collection('passages').document(qid).get()
                if existing.exists:
                    log(f"SKIP (exists): {qid}", logfile)
                    results['skipped'].append(qid)
                    continue
            except Exception as e:
                pass

            doc_data = {
                'passageId':    qid,
                'taskType':     'ESO',
                'corpusType':   'ESO',
                'domain':       data['domain'],
                'algorithm':    data['algorithm'],
                'question':     data['question'],
                'promptDescription': data['question'],
                'status':       'active',
                'curr':         True,
            }

            try:
                db.collection('passages').document(qid).set(doc_data)
                log(f"FIRESTORE OK: {qid} ({data['domain']}) — {data['question'][:50]}...", logfile)
                results['uploaded'].append(qid)
            except Exception as e:
                log(f"ERROR: {qid} — {e}", logfile)
                results['errors'].append(qid)

        log('─' * 60, logfile)
        log(f"SUMMARY:", logfile)
        log(f"  Uploaded: {len(results['uploaded'])}", logfile)
        log(f"  Skipped:  {len(results['skipped'])}", logfile)
        log(f"  Errors:   {len(results['errors'])}", logfile)

    print(f"\nLog saved to: {LOG_PATH}")

if __name__ == '__main__':
    main()
