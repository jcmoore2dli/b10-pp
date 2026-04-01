B10-PP PHASE 1 BUILD KICKOFF PROMPT

You are beginning implementation of the B10 Practice Platform (B10-PP) using the approved integrated spec as the single source of truth.

AUTHORITATIVE FILE

* `B10_PP_Spec_v0_1_FULL.md`

CORE RULES

* Follow the spec exactly.
* Do not redesign.
* Do not add features.
* Do not introduce analytics, export, ILR labeling, audio storage, ESO, or hypothetical tasks.
* If a detail is not yet specified, use the most conservative implementation that preserves MVP scope and ask before expanding.
* Ask before omitting any spec requirement.
* Do not rename fields from the spec without explicit approval.

CURRENT OBJECTIVE
Begin **Phase 1 — Scaffold and Static Layer** only.

PHASE 1 INCLUDES ONLY

1. Repository/project scaffold
2. React + Vite PWA setup
3. Folder structure creation/alignment
4. Passage metadata structure definition
5. Sample passage loading (5–10 sample passages only)
6. Static audio file organization and hookup
7. Audio playback component build and test
8. Basic non-functional screen scaffolds sufficient to navigate to passage playback

PHASE 1 DOES NOT INCLUDE

* Recording
* Whisper integration
* Claude scoring
* Firebase write/read logic
* Instructor dashboard functionality
* Access code validation logic beyond placeholder routing stubs if absolutely needed for local navigation
* Authentication
* Real-time updates
* Feedback logic
* Build of any Phase 2+ features

REQUIRED FOLDER STRUCTURE
Use or align to this structure unless the existing repo already contains equivalent folders:

* `/docs/`
* `/governance/`
* `/frontend/`

  * `/src/components/`
  * `/src/pages/`
  * `/src/services/`
  * `/src/hooks/`
  * `/src/utils/`
  * `/public/`
* `/audio/`

  * `/orient/`
  * `/core/`
  * `/ext/`
* `/data/`
* `/scripts/`

FRONTEND REQUIREMENTS

* Use **React + Vite**
* Configure as **PWA**
* Keep implementation simple and modular
* Mobile-friendly by default
* No unnecessary libraries unless clearly justified by Phase 1 requirements

PHASE 1 DELIVERABLES
Deliver the following:

1. PROJECT SCAFFOLD

* React + Vite app initialized
* PWA plugin/config added
* Basic route/page structure created for:

  * Entry Screen
  * Passage Menu
  * Passage Detail
* These may be static scaffolds for now

2. ENTRY SCREEN SCAFFOLD
   Build a basic Entry Screen scaffold showing:

* platform title
* access code field
* name / student ID field
* Begin button
* no real validation logic yet

3. PASSAGE DATA MODEL
   Create a clean sample metadata structure for 5–10 sample passages that supports:

* `passage_id`
* `domain`
* `layer`
* `tier` or EXT band/PIL where relevant
* `audio_file`
* `passage_text`
* `session_type`
* assigned/available placeholder status if needed

Use spec-consistent naming and field logic only.

4. AUDIO STRUCTURE

* Create/confirm static audio directory structure
* Wire sample passage metadata to sample audio paths
* If real audio files are not yet present, use clearly labeled placeholder references without fabricating content

5. AUDIO PLAYBACK COMPONENT
   Build a simple audio playback component that:

* loads a static MP3
* supports Play / Pause / Replay
* does not allow scrubbing
* does not include speed controls
* does not autoplay

6. PASSAGE MENU SCAFFOLD
   Build a basic menu view showing sample passage cards with:

* Passage ID
* Domain
* Layer
* Tier or EXT band/PIL where relevant
* Completion status placeholder

7. PASSAGE DETAIL SCAFFOLD
   Build a basic detail screen showing:

* passage metadata
* audio player
* Begin Task button scaffold
* no task logic yet

OUTPUT FORMAT REQUIRED
Return your response in these sections only:

1. PHASE 1 IMPLEMENTATION PLAN

* concise step list of exactly what you will build now

2. FILES TO BE CREATED OR MODIFIED

* explicit file/folder list

3. ASSUMPTIONS

* only minimal assumptions required to proceed

4. CHECKPOINT 1 READINESS CRITERIA

* Passage JSON loads correctly
* Audio playback works (Play / Pause / Replay, no scrub)
* PWA install prompt appears on mobile browser
* Navigation between Entry, Menu, and Passage Detail screens functions

IMPORTANT CONSTRAINTS

* Do not proceed into Phase 2
* Do not generate fake production content
* Do not improvise architecture beyond the spec
* Keep everything lightweight and MVP-disciplined
* Treat the integrated spec as authoritative over any older section file if there is any conflict

SUCCESS CONDITION FOR THIS TURN
Your job in this turn is to present the concrete Phase 1 implementation plan and file map before deeper coding proceeds.
