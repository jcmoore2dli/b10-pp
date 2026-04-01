# B10-PP Audio Directory

Pre-generated Azure TTS MP3 files for B10 passages.

## Directory Structure

```
audio/
  orient/   — ORIENT layer passages (B10-ORI-{DOMAIN}-{NUM}.mp3)
  core/     — CORE layer passages  (B10-COR-{DOMAIN}-{NUM}.mp3)
  ext/      — EXT layer passages   (B10-EXT-{DOMAIN}-{NUM}.mp3)
```

## Naming Convention

File names match passage IDs exactly:

```
{PASSAGE_ID}.mp3
```

Examples:
- `core/B10-COR-HLT-001.mp3`
- `orient/B10-ORI-HLT-001.mp3`
- `ext/B10-EXT-GOV-001.mp3`

## Generation

Audio files are pre-generated offline using Microsoft Azure Cognitive Services TTS
before platform deployment. They are NOT generated at runtime.

Generation workflow:
1. Passage text finalized in corpus
2. Azure TTS batch script runs against passage text
3. MP3 files reviewed by Jeff Moore for prosody and pacing
4. Approved files committed here
5. Passage JSON `audio_path` field references the committed file

See spec Section 6 for full audio delivery specification.

## Status

Directories are currently empty — awaiting Azure TTS pilot batch generation.
Pilot batch: 5–10 passages (one per passage in `/data/passages.json`).
