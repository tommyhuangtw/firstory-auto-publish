import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import { embedTexts } from '@/services/trends/embeddings';
import { resolveSource } from './sources';
import { extractInsights } from './extractor';
import { loadInterestProfile, scoreResonance } from './resonance';
import { upsertVec } from './vectorIndex';
import { loadThemeVectors, assignThemesWith, setInsightThemes, recomputeThemeCounts } from './themeService';
import { youTubeId } from './sources';
import { parseAppleUrl } from './applePodcast';
import type { IngestInput } from './types';

const log = createChildLogger('inspiration-pipeline');

/** Create a content_summaries row in 'processing' state; returns its id. */
export function createSourceRow(input: IngestInput): number {
  const db = getDb();
  const sourceType = input.text && !input.url ? 'manual'
    : /youtube\.com|youtu\.be/i.test(input.url || '') ? 'youtube'
    : /podcasts\.apple\.com/i.test(input.url || '') ? 'apple_podcast' : 'manual';
  // Derive the dedup key from the URL when not supplied (so manual ingests dedup against crawls).
  let externalId = input.externalId ?? null;
  if (!externalId && input.url) {
    if (sourceType === 'youtube') externalId = youTubeId(input.url);
    else if (sourceType === 'apple_podcast') externalId = parseAppleUrl(input.url).episodeId ?? null;
  }
  const r = db.prepare(
    `INSERT INTO content_summaries (url, source_type, title, status, channel_id, external_id)
     VALUES (?, ?, ?, 'processing', ?, ?)`,
  ).run(input.url || '(manual)', sourceType, input.title || null, input.channelId ?? null, externalId);
  return Number(r.lastInsertRowid);
}

/**
 * Full ingest for one source row: resolve transcript → extract insights →
 * embed + score resonance → insert insight rows. Updates content_summaries status.
 * Loop-ready: future channel pipeline calls createSourceRow + runIngest per item.
 */
export async function runIngest(sourceId: number, input: IngestInput): Promise<{ insightCount: number }> {
  const db = getDb();
  try {
    const resolved = await resolveSource(input);
    db.prepare(
      `UPDATE content_summaries SET title = COALESCE(title, ?), channel_name = ?, thumbnail_url = ?, transcript = ?, source_type = ?, cost_usd = ? WHERE id = ?`,
    ).run(resolved.title, resolved.channelName, resolved.thumbnailUrl, resolved.transcript, resolved.sourceType, resolved.costUsd, sourceId);

    const origin = input.userPoints?.trim() ? 'user_marked' : 'ai_mined';
    const candidates = await extractInsights(resolved.transcript, { title: resolved.title || undefined, userPoints: input.userPoints });
    if (!candidates.length) throw new Error('No insights extracted');

    const vecs = await embedTexts(candidates.map((c) => `${c.hook}\n${c.idea}`));
    const profile = loadInterestProfile();

    const insert = db.prepare(
      `INSERT INTO insights (source_id, hook, idea, why_share, category, resonance, embedding, origin, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new')`,
    );
    const inserted: Array<{ id: number; vec: number[] }> = [];
    const tx = db.transaction(() => {
      candidates.forEach((c, i) => {
        const vec = vecs[i] || null;
        const resonance = scoreResonance(vec, profile);
        const r = insert.run(sourceId, c.hook, c.idea, c.why_share, c.category, resonance, vec ? JSON.stringify(vec) : null, origin);
        if (vec) inserted.push({ id: Number(r.lastInsertRowid), vec });
      });
    });
    tx();

    // Index vectors + assign themes AFTER the insights are committed, best-effort per insight —
    // a sqlite-vec / theme failure must NOT roll back the insights themselves.
    const themeVecs = loadThemeVectors();
    for (const { id, vec } of inserted) {
      try { upsertVec(id, vec); } catch (e) { log.warn({ id, err: (e as Error).message }, 'vector index failed'); }
      try { setInsightThemes(id, assignThemesWith(vec, themeVecs)); } catch (e) { log.warn({ id, err: (e as Error).message }, 'theme tagging failed'); }
    }
    if (inserted.length && themeVecs.length) { try { recomputeThemeCounts(); } catch { /* best effort */ } }

    db.prepare(`UPDATE content_summaries SET status = 'completed', completed_at = datetime('now') WHERE id = ?`).run(sourceId);
    log.info({ sourceId, insightCount: candidates.length, origin }, 'Ingest complete');
    return { insightCount: candidates.length };
  } catch (e) {
    const msg = (e as Error).message;
    db.prepare(`UPDATE content_summaries SET status = 'failed', error_message = ? WHERE id = ?`).run(msg, sourceId);
    log.error({ sourceId, err: msg }, 'Ingest failed');
    throw e;
  }
}
