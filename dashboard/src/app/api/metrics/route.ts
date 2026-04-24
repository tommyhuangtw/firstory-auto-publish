import { NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET() {
  const db = getDb();

  // Cost per episode
  const costPerEpisode = db.prepare(`
    SELECT episode_number, SUM(cost_usd) as total_cost, COUNT(*) as call_count
    FROM llm_calls
    WHERE episode_number IS NOT NULL
    GROUP BY episode_number
    ORDER BY episode_number
  `).all();

  // Cost breakdown by stage
  const costByStage = db.prepare(`
    SELECT stage, model, COUNT(*) as calls, SUM(cost_usd) as total_cost,
           AVG(cost_usd) as avg_cost, AVG(latency_ms) as avg_latency,
           AVG(quality_score) as avg_quality
    FROM llm_calls
    GROUP BY stage, model
    ORDER BY total_cost DESC
  `).all();

  // Quality score trend
  const qualityTrend = db.prepare(`
    SELECT episode_number, quality_score, total_cost_usd
    FROM episodes
    WHERE quality_score IS NOT NULL
    ORDER BY episode_number
  `).all();

  // Pipeline runs summary
  const pipelineRuns = db.prepare(`
    SELECT id, episode_number, segment_type, status, current_stage,
           started_at, completed_at, error_log
    FROM pipeline_runs
    ORDER BY id DESC
    LIMIT 20
  `).all();

  // Overall stats
  const totalCost = db.prepare('SELECT SUM(cost_usd) as total FROM llm_calls').get() as { total: number | null };
  const totalCalls = db.prepare('SELECT COUNT(*) as total FROM llm_calls').get() as { total: number };
  const avgQuality = db.prepare('SELECT AVG(quality_score) as avg FROM episodes WHERE quality_score IS NOT NULL').get() as { avg: number | null };
  const totalEpisodes = db.prepare('SELECT COUNT(*) as total FROM episodes').get() as { total: number };

  return NextResponse.json({
    costPerEpisode,
    costByStage,
    qualityTrend,
    pipelineRuns,
    summary: {
      totalCost: totalCost.total ?? 0,
      totalCalls: totalCalls.total,
      avgQuality: avgQuality.avg ?? 0,
      totalEpisodes: totalEpisodes.total,
    },
  });
}
