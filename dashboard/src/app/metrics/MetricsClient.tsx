'use client';

import { useEffect, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

interface MetricsData {
  costPerEpisode: { episode_number: number; total_cost: number; call_count: number }[];
  costByStage: { stage: string; model: string; calls: number; total_cost: number; avg_cost: number; avg_latency: number; avg_quality: number | null }[];
  qualityTrend: { episode_number: number; quality_score: number; total_cost_usd: number }[];
  pipelineRuns: { id: number; episode_number: number; segment_type: string; status: string; current_stage: string; started_at: string; completed_at: string | null; error_log: string | null }[];
  summary: { totalCost: number; totalCalls: number; avgQuality: number; totalEpisodes: number };
}

const STAGE_COLORS: Record<string, string> = {
  classify: '#8b5cf6',
  script_en: '#3b82f6',
  script_zh: '#06b6d4',
  scoring: '#10b981',
  title_gen: '#f59e0b',
  tool_extraction: '#ec4899',
  recall_generation: '#f97316',
  translate: '#6366f1',
};

const STATUS_COLORS: Record<string, string> = {
  completed: 'text-green-400',
  running: 'text-yellow-400',
  failed: 'text-red-400',
};

export default function MetricsClient() {
  const [data, setData] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/metrics')
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="p-8 text-zinc-500">Loading metrics...</div>;
  }

  if (!data) {
    return <div className="p-8 text-red-400">Failed to load metrics.</div>;
  }

  const hasData = data.summary.totalCalls > 0;

  return (
    <div className="p-6 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <span className="w-1 h-6 rounded-full bg-brand" />
          LLM Metrics
        </h1>
        <p className="text-brand-taupe text-sm mt-1">Cost tracking, quality trends, and pipeline history</p>
      </header>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Cost" value={`$${data.summary.totalCost.toFixed(3)}`} />
        <StatCard label="LLM Calls" value={data.summary.totalCalls.toString()} />
        <StatCard label="Avg Quality" value={data.summary.avgQuality ? data.summary.avgQuality.toFixed(1) : '-'} />
        <StatCard label="Episodes" value={data.summary.totalEpisodes.toString()} />
      </div>

      {hasData ? (
        <>
          {/* Cost per Episode Chart */}
          {data.costPerEpisode.length > 0 && (
            <section className="mb-8 bg-zinc-900 rounded-lg border border-zinc-800 p-4">
              <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider mb-4">Cost per Episode</h2>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={data.costPerEpisode}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="episode_number" tick={{ fill: '#a1a1aa', fontSize: 12 }} />
                  <YAxis tick={{ fill: '#a1a1aa', fontSize: 12 }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: 8 }}
                    labelStyle={{ color: '#a1a1aa' }}
                    formatter={(value) => [`$${Number(value).toFixed(4)}`, 'Cost']}
                    labelFormatter={(v) => `EP #${v}`}
                  />
                  <Bar dataKey="total_cost" fill="#c9956b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </section>
          )}

          {/* Quality Trend Chart */}
          {data.qualityTrend.length > 0 && (
            <section className="mb-8 bg-zinc-900 rounded-lg border border-zinc-800 p-4">
              <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider mb-4">Quality Score Trend</h2>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={data.qualityTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="episode_number" tick={{ fill: '#a1a1aa', fontSize: 12 }} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#a1a1aa', fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: 8 }}
                    labelStyle={{ color: '#a1a1aa' }}
                    labelFormatter={(v) => `EP #${v}`}
                  />
                  <Line type="monotone" dataKey="quality_score" stroke="#e8c66a" strokeWidth={2} dot={{ fill: '#e8c66a', r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </section>
          )}

          {/* Cost by Stage Table */}
          {data.costByStage.length > 0 && (
            <section className="mb-8 bg-zinc-900 rounded-lg border border-zinc-800 p-4">
              <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider mb-4">Cost by Stage & Model</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-zinc-300 border-b border-zinc-800">
                      <th className="text-left py-2 pr-4">Stage</th>
                      <th className="text-left py-2 pr-4">Model</th>
                      <th className="text-right py-2 pr-4">Calls</th>
                      <th className="text-right py-2 pr-4">Total Cost</th>
                      <th className="text-right py-2 pr-4">Avg Cost</th>
                      <th className="text-right py-2">Avg Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.costByStage.map((row, i) => (
                      <tr key={i} className="border-b border-zinc-800/50">
                        <td className="py-2 pr-4">
                          <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: STAGE_COLORS[row.stage] || '#71717a' }} />
                          {row.stage}
                        </td>
                        <td className="py-2 pr-4 text-zinc-400 text-xs">{row.model.split('/').pop()}</td>
                        <td className="py-2 pr-4 text-right">{row.calls}</td>
                        <td className="py-2 pr-4 text-right">${row.total_cost.toFixed(4)}</td>
                        <td className="py-2 pr-4 text-right">${row.avg_cost.toFixed(4)}</td>
                        <td className="py-2 text-right">{row.avg_latency ? `${Math.round(row.avg_latency)}ms` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      ) : (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-400">No LLM call data yet. Run a pipeline to start collecting metrics.</p>
        </div>
      )}

      {/* Pipeline Runs */}
      <section className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
        <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider mb-4">Pipeline Runs</h2>
        {data.pipelineRuns.length === 0 ? (
          <p className="text-zinc-400 text-sm">No pipeline runs yet.</p>
        ) : (
          <div className="space-y-2">
            {data.pipelineRuns.map((run) => (
              <div key={run.id} className="flex items-center justify-between py-2 border-b border-zinc-800/50 last:border-0">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm">EP#{run.episode_number}</span>
                  <span className="text-xs text-zinc-400">{run.segment_type}</span>
                  <span className={`text-xs font-medium ${STATUS_COLORS[run.status] || 'text-zinc-400'}`}>
                    {run.status}
                  </span>
                  {run.current_stage && (
                    <span className="text-xs text-zinc-400">@ {run.current_stage}</span>
                  )}
                </div>
                <span className="text-xs text-zinc-400">{run.started_at}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4 hover:border-brand/30 transition-colors">
      <p className="text-xs font-medium text-brand-taupe uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}
