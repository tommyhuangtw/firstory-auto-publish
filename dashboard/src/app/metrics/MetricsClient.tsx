'use client';

import { useEffect, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ComposedChart,
} from 'recharts';

interface CostPerEpisode {
  episode_number: number;
  llm_cost: number;
  tts_cost: number;
  image_cost: number;
  total_cost: number;
  call_count: number;
}

interface CostByStage {
  stage: string;
  model: string;
  calls: number;
  total_cost: number;
  avg_cost: number;
  avg_latency: number;
  category: string;
}

interface QualityTrend {
  episode_number: number;
  quality_score: number;
  total_cost_usd: number;
}

interface PipelineRun {
  id: number;
  episode_number: number;
  segment_type: string;
  status: string;
  current_stage: string;
  started_at: string;
  completed_at: string | null;
  error_log: string | null;
  run_cost: number;
}

interface LatencyByStage {
  stage: string;
  avg_latency: number;
  calls: number;
}

interface MetricsData {
  costPerEpisode: CostPerEpisode[];
  costByStage: CostByStage[];
  qualityTrend: QualityTrend[];
  pipelineRuns: PipelineRun[];
  latencyByStage: LatencyByStage[];
  summary: {
    totalCost: number;
    llmCost: number;
    ttsCost: number;
    imageCost: number;
    totalCalls: number;
    avgQuality: number;
    totalEpisodes: number;
    avgCostPerEpisode: number;
    costPerQualityPoint: number;
    mostExpensiveStage: string;
  };
}

type Tab = 'cost' | 'quality' | 'history';

const STAGE_LABELS: Record<string, string> = {
  classify: 'Classify',
  script_en: 'Script (EN)',
  script_zh: 'Script (ZH)',
  scoring: 'Quality Score',
  title_gen: 'Title Gen',
  tool_extraction: 'Tool Extract',
  recall_generation: 'Recall Gen',
  translate: 'Translate',
  ig_scenario: 'IG Scenario',
  voai_tts: 'VoAI TTS',
  kieai_cover: 'Cover Image',
  kieai_veo3: 'Hero B-roll',
  kieai_kling: 'Sloth Video',
  kieai_edit: 'Cover Edit',
  shorts_ig_caption: 'Shorts Caption',
};

const STATUS_DOTS: Record<string, string> = {
  completed: 'bg-green-400',
  running: 'bg-yellow-400',
  failed: 'bg-red-400',
};

export default function MetricsClient() {
  const [data, setData] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('cost');

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

  const tabs: { key: Tab; label: string }[] = [
    { key: 'cost', label: 'Cost Analysis' },
    { key: 'quality', label: 'Quality & Performance' },
    { key: 'history', label: 'Pipeline History' },
  ];

  return (
    <div className="p-6 md:p-8">
      {/* Header */}
      <header className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <span className="w-1 h-6 rounded-full bg-brand" />
          Pipeline Metrics
        </h1>
        <p className="text-brand-taupe text-sm mt-1">Cost tracking, quality trends, and pipeline analytics</p>
      </header>

      {/* Hero Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Total Pipeline Cost"
          value={`$${data.summary.totalCost.toFixed(2)}`}
          subtitle={`LLM $${data.summary.llmCost.toFixed(2)} / TTS $${data.summary.ttsCost.toFixed(2)} / Media $${data.summary.imageCost.toFixed(2)}`}
        />
        <StatCard
          label="Avg Cost / Episode"
          value={`$${data.summary.avgCostPerEpisode.toFixed(3)}`}
        />
        <StatCard
          label="Avg Quality"
          value={data.summary.avgQuality ? data.summary.avgQuality.toFixed(1) : '-'}
          subtitle={data.summary.avgQuality ? `/ 100` : undefined}
        />
        <StatCard
          label="Cost Efficiency"
          value={data.summary.costPerQualityPoint > 0 ? `$${data.summary.costPerQualityPoint.toFixed(4)}` : '-'}
          subtitle="per quality point"
        />
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-6 border-b border-zinc-800">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? 'text-brand border-brand'
                : 'text-zinc-400 border-transparent hover:text-zinc-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'cost' && <CostTab data={data} />}
      {activeTab === 'quality' && <QualityTab data={data} />}
      {activeTab === 'history' && <HistoryTab data={data} />}
    </div>
  );
}

// ── Cost Analysis Tab ──

function CostTab({ data }: { data: MetricsData }) {
  const hasEpisodeCosts = data.costPerEpisode.length > 0;
  const totalAllCosts = data.costByStage.reduce((sum, r) => sum + r.total_cost, 0);

  return (
    <>
      {/* Stacked Cost per Episode Chart */}
      {hasEpisodeCosts && (
        <section className="mb-6 bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider mb-4">Cost per Episode</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.costPerEpisode}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="episode_number" tick={{ fill: '#a1a1aa', fontSize: 12 }} />
              <YAxis tick={{ fill: '#a1a1aa', fontSize: 12 }} tickFormatter={(v) => `$${v}`} />
              <Tooltip
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: 8 }}
                labelStyle={{ color: '#a1a1aa' }}
                formatter={(value, name) => [
                  `$${Number(value).toFixed(4)}`,
                  name === 'llm_cost' ? 'LLM' : name === 'tts_cost' ? 'TTS' : 'Media',
                ]}
                labelFormatter={(v) => `EP #${v}`}
              />
              <Legend
                formatter={(value) =>
                  value === 'llm_cost' ? 'LLM' : value === 'tts_cost' ? 'TTS' : 'Media'
                }
              />
              <Bar dataKey="llm_cost" stackId="cost" fill="#3b82f6" radius={[0, 0, 0, 0]} />
              <Bar dataKey="tts_cost" stackId="cost" fill="#f97316" radius={[0, 0, 0, 0]} />
              <Bar dataKey="image_cost" stackId="cost" fill="#a855f7" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* Insight Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Most Expensive Stage</p>
          <p className="text-lg font-semibold">{STAGE_LABELS[data.summary.mostExpensiveStage] || data.summary.mostExpensiveStage}</p>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">Episodes Produced</p>
          <p className="text-lg font-semibold">{data.summary.totalEpisodes}</p>
          <p className="text-xs text-zinc-500">{data.summary.totalCalls} total LLM calls</p>
        </div>
      </div>

      {/* Cost Breakdown Table */}
      {data.costByStage.length > 0 && (
        <section className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider mb-4">Cost Breakdown</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-400 border-b border-zinc-800">
                  <th className="text-left py-2 pr-4">Category</th>
                  <th className="text-left py-2 pr-4">Stage</th>
                  <th className="text-right py-2 pr-4">Calls</th>
                  <th className="text-right py-2 pr-4">Total Cost</th>
                  <th className="text-right py-2">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {data.costByStage.map((row, i) => (
                  <tr key={i} className="border-b border-zinc-800/50">
                    <td className="py-2 pr-4">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        row.category === 'LLM' ? 'bg-blue-500/20 text-blue-400' :
                        row.category === 'TTS' ? 'bg-orange-500/20 text-orange-400' :
                        'bg-purple-500/20 text-purple-400'
                      }`}>
                        {row.category}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      {STAGE_LABELS[row.stage] || row.stage}
                      <span className="text-xs text-zinc-500 ml-2">{row.model.split('/').pop()}</span>
                    </td>
                    <td className="py-2 pr-4 text-right">{row.calls}</td>
                    <td className="py-2 pr-4 text-right">${row.total_cost.toFixed(4)}</td>
                    <td className="py-2 text-right text-zinc-400">
                      {totalAllCosts > 0 ? ((row.total_cost / totalAllCosts) * 100).toFixed(1) : '0'}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!hasEpisodeCosts && data.costByStage.length === 0 && (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-400">No cost data yet. Run a pipeline to start collecting metrics.</p>
        </div>
      )}
    </>
  );
}

// ── Quality & Performance Tab ──

function QualityTab({ data }: { data: MetricsData }) {
  return (
    <>
      {/* Dual-axis: Quality Score vs Cost */}
      {data.qualityTrend.length > 0 && (
        <section className="mb-6 bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider mb-4">Quality vs Cost Trend</h2>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={data.qualityTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="episode_number" tick={{ fill: '#a1a1aa', fontSize: 12 }} />
              <YAxis yAxisId="quality" domain={[0, 100]} tick={{ fill: '#a1a1aa', fontSize: 12 }} />
              <YAxis yAxisId="cost" orientation="right" tick={{ fill: '#a1a1aa', fontSize: 12 }} tickFormatter={(v) => `$${v}`} />
              <Tooltip
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: 8 }}
                labelStyle={{ color: '#a1a1aa' }}
                labelFormatter={(v) => `EP #${v}`}
                formatter={(value, name) => [
                  name === 'quality_score' ? Number(value).toFixed(1) : `$${Number(value).toFixed(4)}`,
                  name === 'quality_score' ? 'Quality' : 'Cost',
                ]}
              />
              <Legend formatter={(value) => value === 'quality_score' ? 'Quality Score' : 'Total Cost'} />
              <Line yAxisId="quality" type="monotone" dataKey="quality_score" stroke="#e8c66a" strokeWidth={2} dot={{ fill: '#e8c66a', r: 4 }} />
              <Bar yAxisId="cost" dataKey="total_cost_usd" fill="#3b82f6" opacity={0.3} radius={[4, 4, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* Latency by Stage */}
      {data.latencyByStage.length > 0 && (
        <section className="mb-6 bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider mb-4">Avg Latency by Stage</h2>
          <ResponsiveContainer width="100%" height={Math.max(200, data.latencyByStage.length * 36)}>
            <BarChart data={data.latencyByStage} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis type="number" tick={{ fill: '#a1a1aa', fontSize: 12 }} tickFormatter={(v) => `${(v / 1000).toFixed(1)}s`} />
              <YAxis
                dataKey="stage"
                type="category"
                tick={{ fill: '#a1a1aa', fontSize: 12 }}
                width={120}
                tickFormatter={(v) => STAGE_LABELS[v] || v}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: 8 }}
                formatter={(value) => [`${(Number(value) / 1000).toFixed(2)}s`, 'Avg Latency']}
              />
              <Bar dataKey="avg_latency" fill="#06b6d4" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* Model Selection Table */}
      {data.costByStage.filter(r => r.category === 'LLM').length > 0 && (
        <section className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider mb-4">Model Selection</h2>
          <p className="text-xs text-zinc-500 mb-3">Demonstrates intentional model routing — cheap models for simple tasks, powerful models for complex ones.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-400 border-b border-zinc-800">
                  <th className="text-left py-2 pr-4">Stage</th>
                  <th className="text-left py-2 pr-4">Model</th>
                  <th className="text-right py-2 pr-4">Calls</th>
                  <th className="text-right py-2 pr-4">Avg Cost</th>
                  <th className="text-right py-2">Avg Latency</th>
                </tr>
              </thead>
              <tbody>
                {data.costByStage.filter(r => r.category === 'LLM').map((row, i) => (
                  <tr key={i} className="border-b border-zinc-800/50">
                    <td className="py-2 pr-4">{STAGE_LABELS[row.stage] || row.stage}</td>
                    <td className="py-2 pr-4 text-zinc-400 text-xs font-mono">{row.model.split('/').pop()}</td>
                    <td className="py-2 pr-4 text-right">{row.calls}</td>
                    <td className="py-2 pr-4 text-right">${row.avg_cost.toFixed(4)}</td>
                    <td className="py-2 text-right">{row.avg_latency ? `${(row.avg_latency / 1000).toFixed(1)}s` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data.qualityTrend.length === 0 && data.latencyByStage.length === 0 && (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-400">No quality data yet. Run a pipeline to start collecting metrics.</p>
        </div>
      )}
    </>
  );
}

// ── Pipeline History Tab ──

function HistoryTab({ data }: { data: MetricsData }) {
  return (
    <section className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
      <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider mb-4">Pipeline Runs</h2>
      {data.pipelineRuns.length === 0 ? (
        <p className="text-zinc-400 text-sm">No pipeline runs yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-zinc-400 border-b border-zinc-800">
                <th className="text-left py-2 pr-4">Episode</th>
                <th className="text-left py-2 pr-4">Type</th>
                <th className="text-left py-2 pr-4">Status</th>
                <th className="text-left py-2 pr-4">Stage</th>
                <th className="text-right py-2 pr-4">Cost</th>
                <th className="text-right py-2 pr-4">Duration</th>
                <th className="text-right py-2">Started</th>
              </tr>
            </thead>
            <tbody>
              {data.pipelineRuns.map((run) => {
                const duration = run.completed_at && run.started_at
                  ? formatDuration(new Date(run.completed_at).getTime() - new Date(run.started_at).getTime())
                  : run.status === 'running' ? 'running...' : '-';

                return (
                  <tr key={run.id} className="border-b border-zinc-800/50">
                    <td className="py-2 pr-4 font-mono">EP#{run.episode_number}</td>
                    <td className="py-2 pr-4 text-zinc-400">{run.segment_type}</td>
                    <td className="py-2 pr-4">
                      <span className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${STATUS_DOTS[run.status] || 'bg-zinc-500'}`} />
                        <span className="text-xs">{run.status}</span>
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-xs text-zinc-400">
                      {run.current_stage ? (STAGE_LABELS[run.current_stage] || run.current_stage) : '-'}
                    </td>
                    <td className="py-2 pr-4 text-right">{run.run_cost > 0 ? `$${run.run_cost.toFixed(4)}` : '-'}</td>
                    <td className="py-2 pr-4 text-right text-zinc-400">{duration}</td>
                    <td className="py-2 text-right text-zinc-500 text-xs">{formatTime(run.started_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Shared Components ──

function StatCard({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4 hover:border-brand/30 transition-colors">
      <p className="text-xs font-medium text-brand-taupe uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {subtitle && <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return `${min}m ${remSec}s`;
}

function formatTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return isoString;
  }
}
