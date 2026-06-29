// dashboard/src/services/resources/pipeline.ts
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import { crawlAll } from './crawler';
import { annotateMentions } from './extract';
import { enrichAll, expandMentionedRepos } from './enrich';
import { applyFreshnessGate, dedupeForSurface } from './freshness';
import { scoreAll } from './scorer';
import { draftResource } from './draft';
import { sendResourceDigest } from './digest';
import { rgetNum } from './settings';
import type { ResourceScanResult, ScoredResource } from './types';

const log = createChildLogger('resource-pipeline');

export async function runResourceScan(opts: { trigger?: string } = {}): Promise<ResourceScanResult> {
  const db = getDb();
  const t0 = Date.now();
  const runId = Number(db.prepare('INSERT INTO resource_scan_runs (started_at, trigger) VALUES (?, ?)')
    .run(new Date().toISOString(), opts.trigger ?? null).lastInsertRowid);
  const result: ResourceScanResult = { scraped: 0, belowGate: 0, deduped: 0, scored: 0, drafted: 0, recorded: 0 };

  try {
    const raw = annotateMentions(await crawlAll());
    result.scraped = raw.length;
    const enriched = await enrichAll(expandMentionedRepos(raw));
    const gate = applyFreshnessGate(enriched);
    result.belowGate = gate.belowGate;
    const { fresh, deduped } = dedupeForSurface(gate.passed);
    result.deduped = deduped;

    const scored = await scoreAll(fresh);
    result.scored = scored.length;
    const worthy = scored.filter((r) => r.worthSharing).sort((a, b) => b.aiScore - a.aiScore);
    const topN = worthy.slice(0, rgetNum('resource_top_n'));

    const drafts: Array<{ r: ScoredResource; text: string; viral: number }> = [];
    for (const r of topN) {
      try { const d = await draftResource(r); drafts.push({ r, text: d.draftText, viral: d.viralScore }); result.drafted++; }
      catch (e) { log.warn({ guid: r.guid, err: (e as Error).message }, 'draft failed'); }
    }

    const upsert = db.prepare(`
      INSERT INTO curated_resources (guid, content_type, title, description, url, author, published_at, source,
        stars, last_stars, last_stars_at, star_velocity, social_buzz, freshness_score, freshness_reason,
        ai_score, ai_reasoning, ai_highlights, ai_angle, status, last_surfaced_at, scan_run_id)
      VALUES (@guid,@content_type,@title,@description,@url,@author,@published_at,@source,
        @stars,@stars,datetime('now'),@star_velocity,@social_buzz,@freshness_score,@freshness_reason,
        @ai_score,@ai_reasoning,@ai_highlights,@ai_angle,'surfaced',datetime('now'),@scan_run_id)
      ON CONFLICT(guid) DO UPDATE SET stars=@stars, last_stars=curated_resources.stars, last_stars_at=datetime('now'),
        star_velocity=@star_velocity, social_buzz=@social_buzz, freshness_score=@freshness_score,
        freshness_reason=@freshness_reason, ai_score=@ai_score, ai_reasoning=@ai_reasoning,
        ai_highlights=@ai_highlights, ai_angle=@ai_angle, status='surfaced', last_surfaced_at=datetime('now'),
        scan_run_id=@scan_run_id
    `);
    const insDraft = db.prepare('INSERT INTO resource_drafts (resource_guid, draft_text, viral_score) VALUES (?, ?, ?)');
    const tx = db.transaction(() => {
      for (const { r, text, viral } of drafts) {
        upsert.run({
          guid: r.guid, content_type: r.contentType, title: r.title, description: r.description, url: r.url,
          author: r.author, published_at: r.publishedAt ?? null, source: r.source, stars: r.stars ?? null,
          star_velocity: r.starVelocity ?? null, social_buzz: r.socialBuzz, freshness_score: r.freshnessScore,
          freshness_reason: r.freshnessReason, ai_score: r.aiScore, ai_reasoning: r.aiReasoning,
          ai_highlights: JSON.stringify(r.aiHighlights), ai_angle: r.aiAngle, scan_run_id: runId,
        });
        insDraft.run(r.guid, text, viral);
        result.recorded++;
      }
    });
    tx();

    // 寫入已 commit → 本次掃描在資料層已成功。Email digest 是副作用，失敗只記 warn，
    // 不可讓它把整輪 run 標成 error（否則 audit 信號反轉、funnel 計數遺失）。
    if (drafts.length) {
      try { await sendResourceDigest(drafts); }
      catch (e) { log.warn({ runId, err: (e as Error).message }, 'digest send failed (run still succeeded)'); }
    }

    db.prepare(`UPDATE resource_scan_runs SET finished_at=?, duration_ms=?, scraped=?, below_gate=?, deduped=?, scored=?, drafted=?, recorded=? WHERE id=?`)
      .run(new Date().toISOString(), Date.now() - t0, result.scraped, result.belowGate, result.deduped, result.scored, result.drafted, result.recorded, runId);
    db.prepare('DELETE FROM resource_scan_runs WHERE id NOT IN (SELECT id FROM resource_scan_runs ORDER BY id DESC LIMIT 60)').run();
    log.info({ runId, ...result }, 'resource scan complete');
    return result;
  } catch (e) {
    db.prepare('UPDATE resource_scan_runs SET finished_at=?, duration_ms=?, error=? WHERE id=?')
      .run(new Date().toISOString(), Date.now() - t0, (e as Error).message, runId);
    log.error({ runId, err: (e as Error).message }, 'resource scan failed');
    throw e;
  }
}
