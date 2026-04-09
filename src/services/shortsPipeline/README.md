# shortsPipeline

Auto-generate **40–60 second podcast highlight short videos** for IG Reels / YouTube Shorts / TikTok.

See the full design rationale in [`docs/shorts-pipeline-plan.md`](../../../docs/shorts-pipeline-plan.md).

## Pipeline (9 stages)

```
audio.mp3 + 樹懶圖
  → 1. transcribe         (OpenAI Whisper, word-level timestamps)
  → 2. extractHighlight   (Gemini via OpenRouter — finds 40–60s + writes hook/outro scripts)
  → 3. cutClips           (FFmpeg slices the original audio at chosen timestamps)
  → 4. voai TTS           (Hook + Outro narration in 台灣口音)
  → 5. hedra animate      (Character-3 lip-syncs the sloth image to VoAI audio)
  → 6. pexels broll       (Stock B-roll matching extracted keywords)
  → 7. concat master      (hook → clips → outro into one master audio track)
  → 8. build remotion props
  → 9. remotion render    (9:16 1080×1920 MP4)
```

Every stage **gracefully degrades to a deterministic stub** when its API key is
missing, so you can develop end-to-end without paying for any services. Stub
outputs are clearly logged with `⚠️` prefixes.

## Quick start (no API keys required)

```bash
# 1. Pull a small test podcast + cover from your Drive
node scripts/fetch-test-assets.js

# 2. Install Remotion deps (~200MB, includes headless Chromium)
cd remotion && npm install && cd ..

# 3. Run the full pipeline (uses stubs for missing API keys)
node scripts/generate-short.js
```

You'll get an MP4 at `remotion/out/short_<timestamp>.mp4`. With all stubs active
this proves the wiring; visuals will be a static cover + placeholder captions.

## Real run (with API keys)

Add to `.env`:

```
OPENAI_API_KEY=sk-...           # Whisper
VOAI_API_KEY=...                # VoAI TTS
VOAI_VOICE_ID=...               # 你選的台灣聲優
HEDRA_API_KEY=...               # Hedra Character-3
PEXELS_API_KEY=...              # B-roll (free)
# OPENROUTER_API_KEY already exists for highlight extraction
```

Then re-run `node scripts/generate-short.js` — each stage will switch from stub to real automatically.

## Module map

| File | Stage | API |
|---|---|---|
| `transcribe.js` | 1 | OpenAI Whisper |
| `highlightExtractor.js` | 2 | OpenRouter (Gemini 2.5 Flash) |
| `audioCutter.js` | 3, 7 | FFmpeg (local) |
| `voai.js` | 4 | VoAI |
| `hedra.js` | 5 | Hedra Character-3 |
| `pexels.js` | 6 | Pexels Videos |
| `index.js` | orchestration | — |

## CLI

```bash
node scripts/generate-short.js \
  --audio=path/to/episode.mp3 \
  --avatar=path/to/sloth.png \
  --title="EP123: 今天的 AI 大新聞" \
  --output=path/to/output.mp4
```

All flags are optional; defaults point at `remotion/assets/test-*`.

## Intermediate artifacts

Every run dumps a folder under `temp/shorts_<timestamp>/` containing:
- `01_transcript.json` — Whisper output
- `02_plan.json` — Highlight plan from Gemini
- `clips/clip_*.m4a` — Sliced original audio
- `04_hook.m4a`, `04_outro.m4a` — VoAI TTS
- `05_sloth_hook.mp4`, `05_sloth_outro.mp4` — Hedra animation
- `broll/*.mp4` — Pexels downloads
- `07_master.m4a` — Concatenated master audio
- `08_props.json` — Remotion render props
- `99_manifest.json` — Full pipeline summary

Useful for debugging which stage produced bad output.

## Phase status

- [x] **Phase 1**: Pipeline scaffold + Remotion 9:16 composition + stubs (you are here)
- [ ] **Phase 2**: Real Hedra avatar overlay during hook/outro segments
- [ ] **Phase 3**: B-roll background layer in Remotion
- [ ] **Phase 4**: web-console integration + auto-publish to YouTube Shorts
