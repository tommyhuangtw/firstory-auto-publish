import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import { embedTexts } from '@/services/trends/embeddings';
import { resolveSource } from './sources';
import { extractInsights } from './extractor';
import { loadInterestProfile, scoreResonance } from './resonance';
import type { IngestInput } from './types';

const log = createChildLogger('inspiration-pipeline');

/** Create a content_summaries row in 'processing' state; returns its id. */
export function createSourceRow(input: IngestInput): number {
  const db = getDb();
  const sourceType = input.text && !input.url ? 'manual'
    : /youtube\.com|youtu\.be/i.test(input.url || '') ? 'youtube'
    : /podcasts\.apple\.com/i.test(input.url || '') ? 'apple_podcast' : 'manual';
  const r = db.prepare(
    `INSERT INTO content_summaries (url, source_type, title, status, channel_id, external_id)
     VALUES (?, ?, ?, 'processing', ?, ?)`,
  ).run(input.url || '(manual)', sourceType, input.title || null, input.channelId ?? null, input.externalId ?? null);
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
    const tx = db.transaction(() => {
      candidates.forEach((c, i) => {
        const vec = vecs[i] || null;
        const resonance = scoreResonance(vec, profile);
        insert.run(sourceId, c.hook, c.idea, c.why_share, c.category, resonance, vec ? JSON.stringify(vec) : null, origin);
      });
    });
    tx();

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
