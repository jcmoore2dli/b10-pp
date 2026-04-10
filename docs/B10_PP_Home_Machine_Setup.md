# B10-PP HOME MACHINE SETUP
## For: Linux Mint — Jeff Moore home machine
## Date: April 3, 2026

---

## WHAT YOU NEED TO REPLICATE

Your work machine has:
- Node v20.20.2
- npm 10.8.2
- Firebase CLI 15.13.0
- gcloud CLI 563.0.0
- Git configured with GitHub access
- The b10-pp repo cloned locally

---

## STEP 1 — CLONE THE REPO

```bash
git clone https://github.com/jcmoore2dli/b10-pp.git ~/b10_corpus/b10_practice_platform
cd ~/b10_corpus/b10_practice_platform
```

If you already have the repo cloned, just pull latest:
```bash
cd ~/b10_corpus/b10_practice_platform
git pull
```

---

## STEP 2 — CHECK NODE VERSION

```bash
node --version
```

You need v18 or v20. If you have an older version:

```bash
# Install nvm (Node Version Manager)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc

# Install and use Node 20
nvm install 20
nvm use 20
node --version  # should show v20.x.x
```

---

## STEP 3 — INSTALL FRONTEND DEPENDENCIES

```bash
cd ~/b10_corpus/b10_practice_platform/frontend
npm install
```

---

## STEP 4 — INSTALL FUNCTIONS DEPENDENCIES

```bash
cd ~/b10_corpus/b10_practice_platform/functions
npm install
```

---

## STEP 5 — INSTALL FIREBASE CLI

```bash
npm install -g firebase-tools
firebase --version  # should show 15.x.x
```

---

## STEP 6 — LOGIN TO FIREBASE

```bash
BROWSER=google-chrome firebase login
```

(Use Chrome — Firefox clicks don't work in the auth flow on Linux Mint)

Select your Google account: jcmoore2dli@gmail.com

---

## STEP 7 — SET ACTIVE PROJECT

```bash
cd ~/b10_corpus/b10_practice_platform
firebase use b10-practice-platform
```

Confirm with:
```bash
firebase projects:list
```

You should see b10-practice-platform with a ✅ next to it.

---

## STEP 8 — INSTALL GCLOUD CLI (optional but useful)

Only needed if you need to run billing or IAM commands. Skip if not needed.

```bash
curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg

echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | sudo tee /etc/apt/sources.list.d/google-cloud-sdk.list

sudo apt update && sudo apt install google-cloud-cli

gcloud auth login  # opens browser
```

---

## STEP 9 — START THE DEV SERVER

```bash
cd ~/b10_corpus/b10_practice_platform/frontend
npm run dev
```

Open browser to: http://localhost:5173/b10_practice_platform/

---

## VERIFY SETUP IS WORKING

- [ ] `node --version` → v18 or v20
- [ ] `firebase --version` → 15.x.x
- [ ] `firebase projects:list` → b10-practice-platform listed
- [ ] `npm run dev` in frontend → dev server starts, app loads in browser
- [ ] Entry screen loads, access code entry visible

If all five check out, your home machine is ready.

---

## NOTE ON API KEYS

Do NOT store OpenAI or Anthropic API keys anywhere in the repo or frontend code.
When Phase 3 Cloud Functions are ready, keys will be stored as Firebase secrets:
```bash
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:secrets:set ANTHROPIC_API_KEY
```
You will need your actual API keys available when that step runs.

---

*B10-PP Home Machine Setup — April 3, 2026 — Jeff Moore*
