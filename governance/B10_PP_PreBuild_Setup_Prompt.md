B10-PP PRE-BUILD ENVIRONMENT SETUP PROMPT

You are assisting with pre-build setup for the B10 Practice Platform (B10-PP).

IMPORTANT: This is NOT Phase 1 implementation yet.
Your role is to guide environment and repository setup only.

DO NOT:

* create application code
* initialize React/Vite yet
* build components
* generate app logic

---

OBJECTIVE

Guide me step-by-step to:

1. Create a GitHub repository
2. Clone it locally on Linux Mint
3. Place existing project files correctly
4. Verify folder structure alignment
5. Prepare the environment for Phase 1 kickoff

---

CONTEXT

* OS: Linux Mint

* User is working locally in terminal

* Some files already exist:

  * `/docs/` (spec, overview, flowchart)
  * `/governance/` (prompts, logs, reference)

* These must be placed INSIDE the repo root

---

REQUIRED STRUCTURE (TARGET)

B10-PP/
├── README.md
├── docs/
├── governance/
├── frontend/ (empty for now)
├── audio/ (empty for now)
├── data/ (empty for now)
└── scripts/ (empty for now)

---

TASK

Guide me through this process step-by-step.

At each step:

* Provide exact terminal commands OR exact GitHub UI actions
* Wait for confirmation before proceeding
* Do not skip steps

---

PHASES

PHASE A — GITHUB REPO CREATION

* Create repository named: b10-pp
* Public or private (ask me)
* No auto-generated files unless explicitly needed

PHASE B — LOCAL SETUP

* Clone repo
* Navigate into repo
* Confirm working directory

PHASE C — FILE PLACEMENT

* Move existing `/docs` and `/governance` into repo
* Ensure correct structure

PHASE D — INITIAL COMMIT

* Stage all files
* Commit with message:
  "Initial project setup: spec + governance"
* Push to GitHub

PHASE E — STRUCTURE VERIFICATION

* Confirm final folder layout matches spec
* Identify any missing folders

---

OUTPUT FORMAT

For each step:

1. What to do
2. Exact commands (copy-paste ready)
3. What I should see
4. Wait for confirmation

---

CONSTRAINTS

* Do not proceed to Phase 1 build
* Do not create frontend app yet
* Do not modify spec or governance files
* Keep instructions simple and precise
* Ask before making assumptions

---

SUCCESS CONDITION

At the end:

* GitHub repo exists
* Local repo is correctly set up
* All files are in proper locations
* Repo is ready for Phase 1 kickoff

Begin with PHASE A.
