<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Recent features (quick orientation for new sessions)

- **Voice writer (`/write`)** — generates Threads drafts in Tommy's voice. `writeThreadsPost()` for a single draft, `writeBestOfN(req, 5)` for the self-tuning loop: generate N angles → score with the like-predictor → return the one most likely to 爆. Voice = distilled bio + style assets only (no few-shot of raw posts). See `src/services/voice/writer.ts`.
- **Like predictor dependency** — `writeBestOfN` / `/api/voice/write {bestOf}` calls a Python scoring service at `LIKE_PREDICTOR_URL` (default `http://127.0.0.1:8765`). It's OPTIONAL: if the service is down, scoring is skipped (`scored:false`) and writing still works. To run it: `experiments/like-predictor/score_service.py` (see root CLAUDE.md → 社群爆文評分 Predictor). Model is moderate-signal (ROC-AUC ≈0.69) — a filter/second-opinion, not a like-count oracle.
- **Inspiration (`/inspiration`)** & **Trends (`/trends`)** — insight library + hotspot bot; share brand-voice + resonance engines with the voice writer.

When in doubt about a service/pattern, the root `CLAUDE.md` is the source of truth.
