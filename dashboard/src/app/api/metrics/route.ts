import { NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET() {
  const db = getDb();

  // Cost per episode — combined LLM + service costs, using episode_id as primary key
  const costPerEpisode = db.prepare(`
    SELECT COALESCE(e.episode_number, e.id) as episode_number,
      COALESCE(lc.llm_cost, 0) as llm_cost,
      COALESCE(sc.tts_cost, 0) as tts_cost,
      COALESCE(sc.image_cost, 0) as image_cost,
      COALESCE(lc.llm_cost, 0) + COALESCE(sc.tts_cost, 0) + COALESCE(sc.image_cost, 0) as total_cost
    FROM episodes e
    LEFT JOIN (
      SELECT episode_id, SUM(cost_usd) as llm_cost
      FROM llm_calls WHERE episode_id IS NOT NULL
      GROUP BY episode_id
    ) lc ON lc.episode_id = e.id
    LEFT JOIN (
      SELECT episode_id,
        SUM(CASE WHEN service = 'voai_tts' THEN cost_usd ELSE 0 END) as tts_cost,
        SUM(CASE WHEN service != 'voai_tts' THEN cost_usd ELSE 0 END) as image_cost
      FROM service_costs WHERE episode_id IS NOT NULL
      GROUP BY episode_id
    ) sc ON sc.episode_id = e.id
    ORDER BY e.id
  `).all();

  // Cost breakdown by stage (LLM stages + service types)
  const costByStage = db.prepare(`
    SELECT stage, model, calls, total_cost, avg_cost, avg_latency, category
    FROM (
      SELECT stage, model, COUNT(*) as calls, SUM(cost_usd) as total_cost,
             AVG(cost_usd) as avg_cost, AVG(latency_ms) as avg_latency, 'LLM' as category
      FROM llm_calls
      GROUP BY stage, model
      UNION ALL
      SELECT service as stage, model, COUNT(*) as calls, SUM(cost_usd) as total_cost,
             AVG(cost_usd) as avg_cost, AVG(latency_ms) as avg_latency,
             CASE WHEN service = 'voai_tts' THEN 'TTS' ELSE 'Image/Video' END as category
      FROM service_costs
      GROUP BY service, model
    )
    ORDER BY total_cost DESC
  `).all();

  // Quality score trend with full cost overlay (LLM + service costs)
  const qualityTrend = db.prepare(`
    SELECT e.episode_number, e.quality_score,
      COALESCE(lc.llm_cost, 0) + COALESCE(sc.service_cost, 0) as total_cost_usd
    FROM episodes e
    LEFT JOIN (
      SELECT episode_id, SUM(cost_usd) as llm_cost
      FROM llm_calls WHERE episode_id IS NOT NULL
      GROUP BY episode_id
    ) lc ON lc.episode_id = e.id
    LEFT JOIN (
      SELECT episode_id, SUM(cost_usd) as service_cost
      FROM service_costs WHERE episode_id IS NOT NULL
      GROUP BY episode_id
    ) sc ON sc.episode_id = e.id
    WHERE e.quality_score IS NOT NULL
    ORDER BY e.episode_number
  `).all();

  // Pipeline runs summary — include both LLM and service costs
  const pipelineRuns = db.prepare(`
    SELECT pr.id, pr.episode_number, pr.segment_type, pr.status, pr.current_stage,
           pr.started_at, pr.completed_at, pr.error_log,
           COALESCE(lc.llm_cost, 0) + COALESCE(sc.svc_cost, 0) as run_cost
    FROM pipeline_runs pr
    LEFT JOIN (
      SELECT episode_id, SUM(cost_usd) as llm_cost
      FROM llm_calls WHERE episode_id IS NOT NULL
      GROUP BY episode_id
    ) lc ON lc.episode_id = pr.episode_id
    LEFT JOIN (
      SELECT episode_id, SUM(cost_usd) as svc_cost
      FROM service_costs WHERE episode_id IS NOT NULL
      GROUP BY episode_id
    ) sc ON sc.episode_id = pr.episode_id
    ORDER BY pr.id DESC
    LIMIT 20
  `).all();

  // Summary stats
  const llmCost = db.prepare('SELECT COALESCE(SUM(cost_usd), 0) as total FROM llm_calls').get() as { total: number };
  const ttsCost = db.prepare("SELECT COALESCE(SUM(cost_usd), 0) as total FROM service_costs WHERE service = 'voai_tts'").get() as { total: number };
  const imageCost = db.prepare("SELECT COALESCE(SUM(cost_usd), 0) as total FROM service_costs WHERE service != 'voai_tts'").get() as { total: number };
  const totalCalls = db.prepare('SELECT COUNT(*) as total FROM llm_calls').get() as { total: number };
  const avgQuality = db.prepare('SELECT AVG(quality_score) as avg FROM episodes WHERE quality_score IS NOT NULL').get() as { avg: number | null };
  const totalEpisodes = db.prepare('SELECT COUNT(*) as total FROM episodes').get() as { total: number };

  const totalCost = llmCost.total + ttsCost.total + imageCost.total;
  // Calculate avg from per-episode data (only episodes with attributed costs)
  const episodes = costPerEpisode as { total_cost: number }[];
  const episodesWithCost = episodes.filter(e => e.total_cost > 0);
  const avgCostPerEpisode = episodesWithCost.length > 0
    ? episodesWithCost.reduce((sum, e) => sum + e.total_cost, 0) / episodesWithCost.length
    : 0;
  const costPerQualityPoint = (avgQuality.avg ?? 0) > 0 ? avgCostPerEpisode / (avgQuality.avg ?? 1) : 0;

  // Most expensive stage
  const expensiveStage = db.prepare(`
    SELECT stage, SUM(cost_usd) as total FROM llm_calls GROUP BY stage ORDER BY total DESC LIMIT 1
  `).get() as { stage: string; total: number } | undefined;

  // LLM latency by stage
  const latencyByStage = db.prepare(`
    SELECT stage, AVG(latency_ms) as avg_latency, COUNT(*) as calls
    FROM llm_calls
    WHERE latency_ms IS NOT NULL
    GROUP BY stage
    ORDER BY avg_latency DESC
  `).all();

  return NextResponse.json({
    costPerEpisode,
    costByStage,
    qualityTrend,
    pipelineRuns,
    latencyByStage,
    summary: {
      totalCost,
      llmCost: llmCost.total,
      ttsCost: ttsCost.total,
      imageCost: imageCost.total,
      totalCalls: totalCalls.total,
      avgQuality: avgQuality.avg ?? 0,
      totalEpisodes: totalEpisodes.total,
      avgCostPerEpisode,
      costPerQualityPoint,
      mostExpensiveStage: expensiveStage?.stage || '-',
    },
  });
}
