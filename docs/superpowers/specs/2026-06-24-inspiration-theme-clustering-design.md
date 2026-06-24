# Sub-project C — Auto Theme Tags (Clustering) Design Spec

**Date**: 2026-06-24
**Status**: Approved design, ready for implementation planning
**Builds on**: [[inspiration-library]] + channel-crawl (524+ insights across 5 creators) + sub-project A (sqlite-vec). Sequence: do **A first**, then C.

---

## 1. Problem & Goal

Tommy wants to pull insights by **topic theme** — 創業 / AI mindset / business / 行銷 / 創意發想 — not just by the 4 coarse categories (mindset/tactic/contrarian/story) or by channel. Give each insight one or more **emergent, navigable theme tags** derived from his actual corpus, and filter the wall by them.

**Chosen approach (decided): LLM-derived taxonomy + nearest-assignment.** An LLM reads a representative sample of the corpus and proposes ~15 named themes (grounded in *his* content); each theme is embedded; every insight is tagged with its top 1–2 nearest themes by cosine. Stable names, auto-extends to future crawls, no fragile clustering library. (Alternative considered & rejected for v1: pure k-means + LLM-label — clusters wobble as the corpus grows and JS k-means is finicky.)

---

## 2. Scope

### ✅ This sub-project
- Derive a taxonomy of ~15 themes from a representative sample of insights (LLM, Traditional Chinese names + 1-line descriptions).
- Embed each theme; store in a `themes` table.
- Tag every insight with its top 1–2 nearest themes (cosine ≥ threshold) → `insight_themes` join.
- Auto-tag new insights on ingest.
- A re-derive job (manual trigger) to regenerate the taxonomy + re-tag all.
- Theme filter on the `/inspiration` wall (`?theme={id}`), composing with the A-era pagination/search.

### 🔜 Later / out of scope
- Per-theme analytics, theme mer/split editing UI, hierarchical themes.
- Graph/relational features (deferred indefinitely — hybrid retrieval covers the need).

---

## 3. Data Model

```
themes  (NEW)
  id            INTEGER PK
  name          TEXT      -- e.g. '創業冷啟動', 'AI agent 心法', '行銷定位'
  description   TEXT      -- 1-line, used (with name) to build the theme embedding
  embedding     TEXT      -- JSON 1536-d
  insight_count INTEGER DEFAULT 0
  created_at    TEXT DEFAULT (datetime('now'))

insight_themes  (NEW join — multi-theme per insight)
  insight_id  INTEGER → insights.id ON DELETE CASCADE
  theme_id    INTEGER → themes.id  ON DELETE CASCADE
  score       REAL     -- cosine similarity at assignment time
  PRIMARY KEY (insight_id, theme_id)
```
Indexes on `insight_themes(theme_id)` and `(insight_id)`.

---

## 4. Taxonomy Derivation

`deriveThemes()`:
1. **Sample** ~100 insights spread across channels (e.g. round-robin by channel) — take `hook` + `idea`.
2. **LLM** (via `llmService`): "Here are representative insights from my content library. Propose ~15 distinct, useful **themes** I could browse by (創業/AI/business/行銷/創意 style). For each: a short 繁中 name + one-line description. No overlap." → JSON `{ themes: [{name, description}] }`.
3. **Embed** each `name + ' — ' + description` via `embedTexts`.
4. **Replace** the `themes` table contents with the new set (a re-derive is a full refresh).

---

## 5. Assignment

`assignThemes(insightEmbedding) → {themeId, score}[]`:
- Cosine the insight embedding against all theme embeddings.
- Take the **top 1–2** with `score ≥ 0.30` (tunable; at least the top-1 if any theme clears a lower floor, else leave untagged).
- Write to `insight_themes`.

`tagAllInsights()`: assign across the whole library (used after `deriveThemes`).
**On ingest** (`pipeline.ts`): after embedding a new insight, call `assignThemes` and insert its `insight_themes` rows — new crawls auto-tag.

`themes.insight_count` is recomputed after a full re-tag.

---

## 6. API & UI

- `GET /api/inspiration/themes` — list themes (+ insight_count), ordered by count.
- `GET /api/inspiration/insights?theme={id}` — filter via `JOIN insight_themes` (composes with A's pagination/search/other filters).
- `POST /api/inspiration/themes/rederive` — fire-and-forget re-derive + re-tag (background).
- **UI**: a **theme dropdown** on the wall (populated from `/themes`), sitting alongside the channel filter; the coarse `category` filter stays (they're orthogonal — category = rhetorical type, theme = topic). Optionally show an insight's themes as small badges on its card.

---

## 7. Success Criteria (verifiable)

1. `deriveThemes()` produces ~15 named 繁中 themes grounded in the corpus (e.g. surfaces 創業 / AI / 行銷 style themes given the 5 creators).
2. `tagAllInsights()` tags the 524 insights; most get 1–2 themes; `insight_count` per theme is populated and plausible.
3. Filtering the wall by a theme returns on-topic insights spanning multiple channels (cross-creator — the point of themes vs channel filter).
4. Crawling a new video auto-tags its insights (no manual re-derive needed for assignment).
5. `POST /themes/rederive` regenerates the taxonomy + re-tags in the background.
6. `npm run build` passes; a smoke script asserts derive → tag → theme-filter.

---

## 8. Out-of-Scope Reminders
- Themes are *assigned by embedding*, not hand-curated; re-derive refreshes them. Category (4 coarse) and theme (topic) coexist. No graph/Neo4j. Depends on A being in place (sqlite-vec) but uses `insights.embedding` JSON for cosine assignment.
