// dashboard/src/services/resources/pipeline.ts
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import { crawlAll } from './crawler';
import { annotateMentions } from './extract';
import { enrichAll, expandMentionedRepos } from './enrich';
import { applyFreshnessGate, dedupeForSurface } from './freshness';
import { scoreAll } from './scorer';
import { sendResourceDigest } from './digest';
import { rgetNum } from './settings';
import type { ResourceScanResult } from './types';

const log = createChildLogger('resource-pipeline');

export async function runResourceScan(opts: { trigger?: string } = {}): Promise<ResourceScanResult> {
  const db = getDb();
  const t0 = Date.now();
  const runId = Number(db.prepare('INSERT INTO resource_scan_runs (started_at, trigger) VALUES (?, ?)')
    .run(new Date().toISOString(), opts.trigger ?? null).lastInsertRowid);
  const result: ResourceScanResult = { scraped: 0, belowGate: 0, deduped: 0, scored: 0, drafted: 0, recorded: 0 };

  // 成本基準：跑前先記 llm_calls 累計花費，跑完取差值＝本次 LLM 成本（涵蓋評分+生草稿 best-of-N）。
  const sumLlmCost = () => Number((db.prepare('SELECT COALESCE(SUM(cost_usd),0) c FROM llm_calls').get() as { c: number }).c);
  const llmCostBefore = sumLlmCost();

  try {
    const raw = annotateMentions(await crawlAll());
    result.scraped = raw.length;
    const xCount = raw.filter((r) => r.contentType === 'x').length; // Apify 按結果計費
    const enriched = await enrichAll(expandMentionedRepos(raw));

    // Star-history snapshot for ALL enriched GitHub repos (not just drafted ones), so
    // cross-run star-velocity has a baseline even for repos that never get surfaced.
    // status='tracked' on insert; on conflict only star columns move (status preserved,
    // so a 'surfaced' row is never downgraded).
    const snap = db.prepare(`
      INSERT INTO curated_resources (guid, content_type, title, url, author, published_at, stars, last_stars, last_stars_at, star_velocity, status, scan_run_id)
      VALUES (@guid,@content_type,@title,@url,@author,@published_at,@stars,@stars,datetime('now'),@star_velocity,'tracked',@scan_run_id)
      ON CONFLICT(guid) DO UPDATE SET
        last_stars = curated_resources.stars,
        stars = @stars,
        last_stars_at = datetime('now'),
        star_velocity = @star_velocity
    `);
    const snapTx = db.transaction(() => {
      for (const r of enriched) {
        if (r.contentType !== 'github' || r.stars == null) continue;
        snap.run({ guid: r.guid, content_type: r.contentType, title: r.title, url: r.url,
          author: r.author, published_at: r.createdAt ?? r.publishedAt ?? null,
          stars: r.stars, star_velocity: r.starVelocity ?? null, scan_run_id: runId });
      }
    });
    snapTx();

    const gate = applyFreshnessGate(enriched);
    result.belowGate = gate.belowGate;
    const { fresh, deduped } = dedupeForSurface(gate.passed);
    result.deduped = deduped;

    const scored = await scoreAll(fresh);
    result.scored = scored.length;
    const worthy = scored.filter((r) => r.worthSharing).sort((a, b) => b.aiScore - a.aiScore);
    // 不再自動生草稿（best-of-N 太貴又非每篇都要）。改：surface top-N 帶「中文重點 summary」，
    // 草稿改成 /resources 頁上對某篇有興趣時「✍️ 改寫成我的貼文」按鈕 on-demand 生成。
    const topN = worthy.slice(0, rgetNum('resource_top_n'));

    const upsert = db.prepare(`
      INSERT INTO curated_resources (guid, content_type, title, description, url, author, published_at, source,
        stars, likes, comments, reposts, last_stars, last_stars_at, star_velocity, social_buzz, freshness_score, freshness_reason,
        ai_score, ai_summary, ai_reasoning, ai_highlights, ai_angle, status, last_surfaced_at, scan_run_id)
      VALUES (@guid,@content_type,@title,@description,@url,@author,@published_at,@source,
        @stars,@likes,@comments,@reposts,@stars,datetime('now'),@star_velocity,@social_buzz,@freshness_score,@freshness_reason,
        @ai_score,@ai_summary,@ai_reasoning,@ai_highlights,@ai_angle,'surfaced',datetime('now'),@scan_run_id)
      ON CONFLICT(guid) DO UPDATE SET
        likes=@likes, comments=@comments, reposts=@reposts,
        star_velocity=@star_velocity, social_buzz=@social_buzz, freshness_score=@freshness_score,
        freshness_reason=@freshness_reason, ai_score=@ai_score, ai_summary=@ai_summary, ai_reasoning=@ai_reasoning,
        ai_highlights=@ai_highlights, ai_angle=@ai_angle, status='surfaced', last_surfaced_at=datetime('now'),
        scan_run_id=@scan_run_id
    `);
    const tx = db.transaction(() => {
      for (const r of topN) {
        upsert.run({
          guid: r.guid, content_type: r.contentType, title: r.title, description: r.description, url: r.url,
          author: r.author, published_at: r.publishedAt ?? null, source: r.source, stars: r.stars ?? null,
          likes: r.engagement?.likes ?? null, comments: r.engagement?.comments ?? null, reposts: r.engagement?.reposts ?? null,
          star_velocity: r.starVelocity ?? null, social_buzz: r.socialBuzz, freshness_score: r.freshnessScore,
          freshness_reason: r.freshnessReason, ai_score: r.aiScore, ai_summary: r.aiSummary, ai_reasoning: r.aiReasoning,
          ai_highlights: JSON.stringify(r.aiHighlights), ai_angle: r.aiAngle, scan_run_id: runId,
        });
        result.recorded++;
      }
    });
    tx();

    // 寫入已 commit → 本次掃描在資料層已成功。Email digest 是副作用，失敗只記 warn，
    // 不可讓它把整輪 run 標成 error（否則 audit 信號反轉、funnel 計數遺失）。
    // 成本：LLM 差值 + Apify X（每則估價 × 結果數）。GitHub API 免費、無其他付費呼叫。
    const costUsd = (sumLlmCost() - llmCostBefore) + xCount * rgetNum('resource_apify_cost_per_item');

    if (topN.length) {
      try { await sendResourceDigest(topN, costUsd); }
      catch (e) { log.warn({ runId, err: (e as Error).message }, 'digest send failed (run still succeeded)'); }
    }

    db.prepare(`UPDATE resource_scan_runs SET finished_at=?, duration_ms=?, scraped=?, below_gate=?, deduped=?, scored=?, drafted=?, recorded=?, cost_usd=? WHERE id=?`)
      .run(new Date().toISOString(), Date.now() - t0, result.scraped, result.belowGate, result.deduped, result.scored, result.drafted, result.recorded, costUsd, runId);
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
