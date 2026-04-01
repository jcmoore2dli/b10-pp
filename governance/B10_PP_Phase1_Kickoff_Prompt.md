B10-PP PHASE 1 BUILD KICKOFF PROMPT
You are beginning implementation of the B10 Practice Platform (B10-PP) using the approved integrated spec as the single source of truth.
AUTHORITATIVE FILE

B10_PP_Spec_v0_1_FULL.md

CORE RULES

Follow the spec exactly.
Do not redesign.
Do not add features.
Do not introduce analytics, export, ILR labeling, audio storage, ESO, or hypothetical tasks.
If a detail is not yet specified, use the most conservative implementation that preserves MVP scope and ask before expanding.
Ask before omitting any spec requirement.
Do not rename fields from the spec without explicit approval.

CURRENT OBJECTIVE
Begin Phase 1 — Scaffold and Static Layer only.
PHASE 1 INCLUDES ONLY

React + Vite initialization inside the existing /frontend/ folder — repo and folder structure are already complete per pre-build setup. Do not recreate or reorganize existing folders.
React + Vite PWA setup
Passage metadata structure definition
Sample passage loading (5–10 sample passages only)
Static audio file organization and hookup
Audio playback component build and test
Basic non-functional screen scaffolds sufficient to navigate to passage playback

PHASE 1 DOES NOT INCLUDE

Recording
Whisper integration
Claude scoring
Firebase write/read logic
Instructor dashboard functionality
Access code validation logic beyond placeholder routing stubs if absolutely needed for local navigation
Authentication
Real-time updates
Feedback logic
Build of any Phase 2+ features

EXISTING REPO STRUCTURE
The following structure already exists and is committed to GitHub. Work within it — do not modify the top-level layout:

