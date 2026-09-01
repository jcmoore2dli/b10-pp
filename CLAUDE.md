# Governance for AI-assisted work in this repo

## Branch discipline
- Work happens on `feature/toefl-platform-build`. Never commit or push
  directly to `main`.
- `main` is merged only by JC, via reviewed pull request.
- Never run `firebase deploy`, `npm run deploy`, or any Cloud Functions/Firestore
  rules deploy command. Deploys are JC-triggered only, always.

## Data
- Firestore is the sole source of truth. Never reintroduce static JSON files.
- Scoring rubrics are never edited for grammar/wording fixes — use a
  post-generation validation pass instead. Rubric content changes require
  explicit JC sign-off.

## TOEFL corpus (toefl-corpus repo, read-only)
- Read only top-level item folders per task type. Never read from `_archive/`.
- Week-assignment fields inside corpus item files are historical and unused.
  The authoritative week map is the external file from ISD v1.3.1.

## During the B10-PP pilot freeze
- No deploys of any kind to the shared Firebase project, even for TOEFL-only
  changes, until JC confirms the freeze has lifted.
