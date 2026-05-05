'use client';

import { useEffect, useState } from 'react';

interface Snapshot {
  id: number;
  stage: string;
  output_data: string;
  started_at: string;
  elapsed_ms: number;
}

interface LlmCall {
  id: number;
  stage: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  success: number;
  error_message: string | null;
  created_at: string;
}

interface Props {
  pipelineRunId: number;
  currentStage: string | null;
  pipelineStatus: string;
  errorLog: string | null;
  llmCalls: LlmCall[];
}

const STAGE_LABELS: Record<string, string> = {
  fetchYoutube: '抓取 YouTube',
  classify: '影片分類',
  scriptEnglish: '英文講稿',
  extractTools: '工具擷取',
  translate: '中文翻譯',
  customContentInsert: '客製內容插入',
  scoreQuality: '品質評分',
  generateMeta: '標題描述',
  generateCover: '封面生成',
  synthesizeTts: '語音合成',
  uploadAssets: '上傳素材',
  notify: '通知發送',
};

/** Map LLM call stage names to pipeline node names */
const LLM_STAGE_TO_NODE: Record<string, string> = {
  classify: 'classify',
  summarize_transcript: 'scriptEnglish',
  script_en: 'scriptEnglish',
  tool_extraction: 'extractTools',
  script_zh: 'translate',
  custom_content_insert: 'customContentInsert',
  scoring: 'scoreQuality',
  script_refine: 'scoreQuality',
  script_summary: 'generateMeta',
  title_gen: 'generateMeta',
  description_gen: 'generateMeta',
  tags_gen: 'generateMeta',
  ig_scenario_extract: 'generateCover',
  ig_scenario: 'generateCover',
  ig_caption: 'notify',
  email_content: 'notify',
  email_html: 'notify',
  fb_caption: 'notify',
  threads_caption: 'notify',
};

export default function PipelineTimeline({ pipelineRunId, currentStage, pipelineStatus, errorLog, llmCalls }: Props) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showSnapshot, setShowSnapshot] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/pipeline/snapshots/${pipelineRunId}`)
      .then((res) => res.json())
      .then((data) => setSnapshots(data.snapshots || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [pipelineRunId]);

  // Group LLM calls by pipeline node
  const callsByNode = new Map<string, LlmCall[]>();
  for (const call of llmCalls) {
    const node = LLM_STAGE_TO_NODE[call.stage] || call.stage;
    const arr = callsByNode.get(node) || [];
    arr.push(call);
    callsByNode.set(node, arr);
  }

  const totalCost = llmCalls.reduce((sum, c) => sum + (c.cost_usd || 0), 0);
  const totalTokens = llmCalls.reduce((sum, c) => sum + (c.input_tokens || 0) + (c.output_tokens || 0), 0);
  const failedCount = llmCalls.filter((c) => !c.success).length;

  if (loading) {
    return (
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
        <div className="h-4 w-32 bg-zinc-800 rounded animate-pulse" />
      </div>
    );
  }

  const snapshotMap = new Map(snapshots.map((s) => [s.stage, s]));
  const stageKeys = Object.keys(STAGE_LABELS);

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-300">Pipeline Timeline</h3>
        <div className="flex items-center gap-3 text-[11px] text-zinc-400">
          {llmCalls.length > 0 && (
            <>
              <span>{llmCalls.length} calls</span>
              <span className="tabular-nums">{totalTokens.toLocaleString()} tokens</span>
              <span className="tabular-nums">${totalCost.toFixed(4)}</span>
              {failedCount > 0 && (
                <span className="text-red-400">{failedCount} failed</span>
              )}
              <span className="text-zinc-600">|</span>
            </>
          )}
          <span>Run #{pipelineRunId}</span>
        </div>
      </div>

      <div className="divide-y divide-zinc-800/50">
        {stageKeys.map((stage) => {
          const snap = snapshotMap.get(stage);
          const isCurrent = stage === currentStage && pipelineStatus === 'running';
          const isFailed = stage === currentStage && pipelineStatus === 'failed';
          const isDone = !!snap;
          const isExpanded = expanded === stage;
          const nodeCalls = callsByNode.get(stage) || [];

          return (
            <div key={stage}>
              <button
                onClick={() => (snap || nodeCalls.length > 0) && setExpanded(isExpanded ? null : stage)}
                disabled={!snap && nodeCalls.length === 0}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors cursor-pointer ${
                  snap || nodeCalls.length > 0 ? 'hover:bg-zinc-800/50' : ''
                } ${isExpanded ? 'bg-zinc-800/30' : ''}`}
              >
                {/* Status indicator */}
                <div className="shrink-0">
                  {isCurrent ? (
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75 animate-ping" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500" />
                    </span>
                  ) : isFailed ? (
                    <span className="flex h-2.5 w-2.5 rounded-full bg-red-500" />
                  ) : isDone ? (
                    <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  ) : (
                    <span className="flex h-2.5 w-2.5 rounded-full bg-zinc-700" />
                  )}
                </div>

                {/* Stage name */}
                <span className={`text-xs flex-1 ${
                  isCurrent ? 'text-blue-400 font-medium' :
                  isFailed ? 'text-red-400' :
                  isDone ? 'text-zinc-300' : 'text-zinc-400'
                }`}>
                  {STAGE_LABELS[stage] || stage}
                </span>

                {/* LLM call count + cost for this stage */}
                {nodeCalls.length > 0 && (() => {
                  const stageCost = nodeCalls.reduce((sum, c) => sum + (c.cost_usd || 0), 0);
                  return (
                    <span className="text-[11px] text-zinc-500 tabular-nums flex items-center gap-2">
                      <span>{nodeCalls.length} {nodeCalls.length === 1 ? 'call' : 'calls'}</span>
                      {stageCost > 0 && <span>${stageCost.toFixed(4)}</span>}
                    </span>
                  );
                })()}

                {/* Elapsed time */}
                {snap && (
                  <span className="text-[11px] text-zinc-400 tabular-nums">
                    {snap.elapsed_ms >= 1000
                      ? `${(snap.elapsed_ms / 1000).toFixed(1)}s`
                      : `${snap.elapsed_ms}ms`}
                  </span>
                )}

                {/* Expand icon */}
                {(snap || nodeCalls.length > 0) && (
                  <svg
                    className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                )}
              </button>

              {/* Expanded: LLM calls + snapshot */}
              {isExpanded && (
                <div className="px-4 pb-3 space-y-2">
                  {/* LLM calls table */}
                  {nodeCalls.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="text-zinc-500">
                            <th className="text-left py-1 pr-3 font-medium">Stage</th>
                            <th className="text-left py-1 pr-3 font-medium">Model</th>
                            <th className="text-right py-1 pr-3 font-medium">Tokens</th>
                            <th className="text-right py-1 pr-3 font-medium">Cost</th>
                            <th className="text-right py-1 pr-3 font-medium">Latency</th>
                            <th className="text-center py-1 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {nodeCalls.map((call) => (
                            <tr key={call.id} className="text-zinc-400">
                              <td className="py-1 pr-3">{call.stage}</td>
                              <td className="py-1 pr-3 font-mono">{call.model.split('/').pop()}</td>
                              <td className="py-1 pr-3 text-right tabular-nums">
                                {((call.input_tokens || 0) + (call.output_tokens || 0)).toLocaleString()}
                              </td>
                              <td className="py-1 pr-3 text-right tabular-nums">
                                {call.cost_usd != null ? `$${call.cost_usd.toFixed(4)}` : '-'}
                              </td>
                              <td className="py-1 pr-3 text-right tabular-nums">
                                {call.latency_ms != null ? `${(call.latency_ms / 1000).toFixed(1)}s` : '-'}
                              </td>
                              <td className="py-1 text-center">
                                {call.success ? (
                                  <span className="text-emerald-500">ok</span>
                                ) : (
                                  <span className="text-red-400" title={call.error_message || ''}>fail</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Snapshot JSON (collapsible) */}
                  {snap && (
                    <div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowSnapshot(showSnapshot === stage ? null : stage);
                        }}
                        className="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-400 transition-colors cursor-pointer"
                      >
                        <svg
                          className={`w-3 h-3 transition-transform ${showSnapshot === stage ? 'rotate-90' : ''}`}
                          fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                        Snapshot JSON
                      </button>
                      {showSnapshot === stage && (
                        <pre className="mt-1.5 bg-zinc-950 rounded-lg p-3 text-[11px] text-zinc-400 font-mono overflow-x-auto max-h-64 overflow-y-auto leading-relaxed">
                          {formatJSON(snap.output_data)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Error display */}
      {pipelineStatus === 'failed' && errorLog && (
        <div className="px-4 py-3 border-t border-red-900/30 bg-red-950/20">
          <p className="text-[11px] font-medium text-red-400 mb-1">Error</p>
          <p className="text-[11px] text-red-300/80 font-mono break-all">{errorLog}</p>
        </div>
      )}
    </div>
  );
}

function formatJSON(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    const truncated = JSON.parse(JSON.stringify(parsed, (_, v) => {
      if (typeof v === 'string' && v.length > 500) return v.slice(0, 500) + '...';
      return v;
    }));
    return JSON.stringify(truncated, null, 2);
  } catch {
    return raw;
  }
}
