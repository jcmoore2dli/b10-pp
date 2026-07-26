# B10-PP Workflow Reference
## Terminal, GitHub, and Platform Operations

**For use in any new Claude session working on B10-PP**

---

## Two Linux Mint Computers

| Machine | Hostname | Primary Use |
|---|---|---|
| Home | moore-Inspiron-3505 | Secondary - pull and review only unless at home |
| Work | jcmoore2-Inspiron-15-3567 | Primary development and deployment |

**To sync home computer before working:**
```bash
cd ~/b10_corpus/b10_practice_platform && git pull origin main
```

**Always push from work before leaving:**
```bash
cd ~/b10_corpus/b10_practice_platform && git status
# Then add/commit/push any unstaged changes
```

---

## Repository Structure

**Root:** `~/b10_corpus/b10_practice_platform/`

```
b10_practice_platform/
├── frontend/                    # React/Vite app - student and instructor UI
│   └── src/screens/             # Key screens: InstructorDashboardScreen.jsx, etc.
├── functions/                   # Firebase Cloud Functions (scoring pipeline)
│   ├── index.js                 # Main Cloud Functions entry point
│   └── lib/claudeScorer.js      # Claude API scoring logic
├── docs/                        # Source documents (not deployed directly)
│   ├── sops/                    # SOP HTML files (source of truth for content)
│   ├── enabling_activities/     # Enabling activity HTML files
│   └── binder_pdfs/             # All binder-related PDFs
├── hosting/                     # Deployed static files (gitignored - Firebase handles)
│   └── b10_practice_platform/
│       └── materials/SOPs/      # Deployed HTML versions of SOPs
└── governance/                  # Governance and compliance documents
```

---

## Key Files

| File | Purpose |
|---|---|
| `functions/index.js` | Cloud Functions - processSubmission, createInstructorAccount, etc. |
| `functions/lib/claudeScorer.js` | Claude API scoring logic and task routing |
| `frontend/src/screens/InstructorDashboardScreen.jsx` | Instructor dashboard UI |
| `docs/sops/B10PP_Daily_Instructor_Quick_Reference.html` | Quick Reference source |
| `docs/sops/B10PP_ESO_Frames_Daily_Protocol_SOP.html` | ESO SOP source |
| `hosting/b10_practice_platform/materials/SOPs/` | Deployed SOP HTML files |

---

## Standard Git Workflow

### Check status before anything
```bash
cd ~/b10_corpus/b10_practice_platform && git status
```

### Stage, commit, push
```bash
git add <file(s)>
git commit -m "Descriptive message"
git push origin main
```

### Common add patterns
```bash
# Single file
git add docs/sops/B10PP_ESO_Frames_Daily_Protocol_SOP.html

# All SOPs
git add docs/sops/

# All enabling activities
git add docs/enabling_activities/

# Frontend screen
git add frontend/src/screens/InstructorDashboardScreen.jsx

# All binder PDFs (safe - no code)
git add docs/binder_pdfs/
```

### NEVER add hosting/ directly
The hosting/ folder is gitignored. Firebase deploy handles it separately.

---

## Deploy to Live Platform

**Always run from the frontend/ directory:**
```bash
cd ~/b10_corpus/b10_practice_platform/frontend && npm run deploy
```

This deploys the hosting/ folder to Firebase Hosting at:
**https://b10-practice-platform.web.app/b10_practice_platform/**

### Full workflow: commit + push + deploy
```bash
cd ~/b10_corpus/b10_practice_platform
git add <files>
git commit -m "Message"
git push origin main
cd frontend && npm run deploy
```

---

## Updating HTML Documents

There are TWO copies of each SOP HTML that must both be updated:

| Copy | Path | Purpose |
|---|---|---|
| Source | `docs/sops/B10PP_XXX.html` | Git source of truth |
| Deployed | `hosting/b10_practice_platform/materials/SOPs/B10PP_XXX.html` | What the live platform serves |

**Always update both.** The hosting/ copy is what instructors and students see on the platform. The docs/ copy is what gets committed to GitHub.

### Typical SOP update pattern
```bash
python3 update_sop.py
```
(Use a small Python script with a list of file paths and old/new text replacements - safer than editing by hand across two copies.)

Then commit docs/ only (hosting/ is gitignored) and deploy:
```bash
git add docs/sops/B10PP_XXX.html && git commit -m "Fix: description" && git push origin main && cd frontend && npm run deploy
```

---

## PDF Build Scripts

PDF build scripts live on **Claude's server** (`/home/claude/`) - not on the user's machine. They are rebuilt each session as needed.

Key scripts (rebuilt by Claude when needed):
- `build_qr_pdf.py` - Daily Quick Reference (4pp, LF Step 4a/4b)
- `build_ea_v2.py` - All 6 enabling activities PDFs
- `build_mts_v2.py` - MTS All (6pp)
- `build_core_sop.py` - CORE SOP (5pp)
- `build_eso_sop.py` - ESO SOP (11pp)
- `build_toc.py` - TOC (1pp, 14 entries, References at p.84)
- `build_cover.py` - Cover (1pp, "Reference Guide / Scaffolded Discourse Development")
- `build_references.py` - References page (1pp, 5 citations)
- `build_leave_behind.py` - Instructor leave-behind (1pp)
- `build_briefing_script.py` - Briefing script (2pp)

---

## Binder PDF Merge

Master binder: `docs/binder_pdfs/B10PP_Instructor_Reference_Guide.pdf` (84 pages)

**Current merge order and file names:**
```bash
pdfunite \
  ~/b10_corpus/b10_practice_platform/docs/binder_pdfs/B10PP_Binder_Cover-3.pdf \
  ~/b10_corpus/b10_practice_platform/docs/binder_pdfs/B10PP_TOC-3.pdf \
  ~/b10_corpus/b10_practice_platform/docs/binder_pdfs/B10PP_Daily_Quick_Reference-2.pdf \
  ~/b10_corpus/b10_practice_platform/docs/binder_pdfs/B10PP_Student_Onboarding_Protocol.pdf \
  ~/b10_corpus/b10_practice_platform/docs/binder_pdfs/B10PP_CORE_Daily_Protocol_SOP.pdf \
  ~/b10_corpus/b10_practice_platform/docs/binder_pdfs/B10PP_ESO_Frames_Daily_Protocol_SOP-1.pdf \
  ~/b10_corpus/b10_practice_platform/docs/binder_pdfs/B10PP_LF_Daily_Protocol_SOP.pdf \
  ~/b10_corpus/b10_practice_platform/docs/binder_pdfs/B10PP_MTS_All.pdf \
  ~/b10_corpus/b10_practice_platform/docs/binder_pdfs/B10PP_Frames_Argument_Builder.pdf \
  ~/b10_corpus/b10_practice_platform/docs/binder_pdfs/B10PP_W1_Scale_Stakeholder_Enabling_Activities_v2.pdf \
  ~/b10_corpus/b10_practice_platform/docs/binder_pdfs/B10PP_W2_Tradeoffs_Constraints_Enabling_Activities_v2.pdf \
  ~/b10_corpus/b10_practice_platform/docs/binder_pdfs/B10PP_W3_Causal_Systems_Enabling_Activities_v2.pdf \
  ~/b10_corpus/b10_practice_platform/docs/binder_pdfs/B10PP_W4_Hypothetical_Conditional_Enabling_Activities_v2.pdf \
  ~/b10_corpus/b10_practice_platform/docs/binder_pdfs/B10PP_W5_Values_Heuristics_Bias_Enabling_Activities_v2.pdf \
  ~/b10_corpus/b10_practice_platform/docs/binder_pdfs/B10PP_W6_Synthesis_Judgment_Enabling_Activities_v2.pdf \
  ~/b10_corpus/b10_practice_platform/docs/binder_pdfs/B10PP_References.pdf \
  ~/b10_corpus/b10_practice_platform/docs/binder_pdfs/B10PP_Instructor_Reference_Guide.pdf
```

**TOC page numbers (current - 84 pages total):**
| # | Document | Start Page |
|---|---|---|
| - | Cover | 1 |
| - | TOC | 2 |
| 1 | Daily Quick Reference | 3 |
| 2 | Student Onboarding Protocol | 7 |
| 3 | CORE Bundle SOP | 8 |
| 4 | ESO/Frames SOP | 13 |
| 5 | LF SOP | 24 |
| 6 | MTS All | 35 |
| 7 | Frames Argument Builder | 41 |
| 8 | W1 Enabling Activities | 42 |
| 9 | W2 Enabling Activities | 49 |
| 10 | W3 Enabling Activities | 56 |
| 11 | W4 Enabling Activities | 63 |
| 12 | W5 Enabling Activities | 70 |
| 13 | W6 Enabling Activities | 77 |
| 14 | References | 84 |

---

## Platform URL and Access

- **Live platform:** https://b10-practice-platform.web.app/b10_practice_platform/ - note the `/b10_practice_platform/` subpath is required; the bare domain root does not serve the app and just lands on Firebase
- **Firebase console:** https://console.firebase.google.com/project/b10-practice-platform
- **GitHub repo:** https://github.com/jcmoore2dli/b10-pp

---

## Critical Notes for New Sessions

1. **Never commit hosting/ directly** - it is gitignored; Firebase deploy handles it
2. **Always update BOTH copies of HTML files** - docs/sops/ AND hosting/.../SOPs/
3. **ESO questions have no audio** - instructors read the question aloud; only student response audio is played
4. **LF questions are pre-loaded for students** - instructor assigns category verbally (WFF/SV/SC/PI); students self-select questions within that category
5. **Bundle preloading requires instructor assignment at account creation** - students created without an instructor assigned will not have bundles loaded
6. **PDF build scripts do not persist between Claude sessions** - Claude rebuilds them from scratch each session using stored content knowledge
7. **pdfunite is available on Linux Mint** - used for all PDF merging
