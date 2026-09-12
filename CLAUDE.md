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

## B10-PP operating status — permanent, not a freeze that lifts
- The B10-PP pilot is officially over, but participating students and their
  instructor may continue using the platform indefinitely by informal
  agreement — there is no fixed end date. Non-interruption of that active
  population is a permanent operating constraint for the rest of this
  build and beyond, not a one-time Day-1 gate.
- Frontend and Firestore-rules deploys are safe when additive (separate
  bundle/path, B10-PP's existing match blocks never edited). Cloud
  Functions deploys are the one real risk, since all routes share one
  deployment.
- Every Cloud Functions deploy command must explicitly name its target
  function(s) (e.g., `firebase deploy --only functions:scoreToeflInterview`).
  An unscoped `--only functions` redeploys every function in the codebase,
  including B10-PP's six live routes, unnecessarily exposing an active
  user population to avoidable risk. Scoped deploys only, without
  exception, for the remaining life of this build.


## Functions emulator note
- Inside the Cloud Functions emulator's runtime (not plain Node, not
  production), admin.firestore.FieldValue is undefined — the runtime
  wraps admin.firestore as a bare function without carrying its static
  properties. Use the modular import instead:
  const { FieldValue } = require("firebase-admin/firestore");
  This only affects emulator testing; existing deployed functions using
  the namespaced form are unaffected in production.
