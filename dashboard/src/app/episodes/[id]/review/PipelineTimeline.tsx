'use client';

import { useEffect, useState } from 'react';

interface Snapshot {
  id: number;
  stage: string;
  output_data: string;
  started_at: string;
  elapsed_ms: number;
}

interface Props {
  pipelineRunId: number;
  currentStage: string | null;
  pipelineStatus: string;
  errorLog: string | null;
}

const STAGE_LABELS: Record<string, string> = {
  fetchYoutube: '抓取 YouTube',
  classify: '影片分類',
  scriptEnglish: '英文講稿',
  extractTools: '工具擷取',
  translate: '中文翻譯',
  customContentInsert: '客製內容插入',
  enrichMemory: '記憶強化',
  scoreQuality: '品質評分',
  generateMeta: '標題描述',
  generateCover: '封面生成',
  synthesizeTts: '語音合成',
  uploadAssets: '上傳素材',
  notify: '通知發送',
};

export default function PipelineTimeline({ pipelineRunId, currentStage, pipelineStatus, errorLog }: Props) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/pipeline/snapshots/${pipelineRunId}`)
      .then((res) => res.json())
      .then((data) => setSnapshots(data.snapshots || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [pipelineRunId]);

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
        <span className="text-[11px] text-zinc-400 tabular-nums">
          Run #{pipelineRunId}
        </span>
      </div>

      <div className="divide-y divide-zinc-800/50">
        {stageKeys.map((stage) => {
          const snap = snapshotMap.get(stage);
          const isCurrent = stage === currentStage && pipelineStatus === 'running';
          const isFailed = stage === currentStage && pipelineStatus === 'failed';
          const isDone = !!snap;
          const isExpanded = expanded === snap?.id;

          return (
            <div key={stage}>
              <button
                onClick={() => snap && setExpanded(isExpanded ? null : snap.id)}
                disabled={!snap}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors cursor-pointer ${
                  snap ? 'hover:bg-zinc-800/50' : ''
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

                {/* Elapsed time */}
                {snap && (
                  <span className="text-[11px] text-zinc-400 tabular-nums">
                    {snap.elapsed_ms >= 1000
                      ? `${(snap.elapsed_ms / 1000).toFixed(1)}s`
                      : `${snap.elapsed_ms}ms`}
                  </span>
                )}

                {/* Expand icon */}
                {snap && (
                  <svg
                    className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                )}
              </button>

              {/* Expanded snapshot data */}
              {isExpanded && snap && (
                <div className="px-4 pb-3">
                  <pre className="bg-zinc-950 rounded-lg p-3 text-[11px] text-zinc-400 font-mono overflow-x-auto max-h-64 overflow-y-auto leading-relaxed">
                    {formatJSON(snap.output_data)}
                  </pre>
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
    // Truncate long strings for display
    const truncated = JSON.parse(JSON.stringify(parsed, (_, v) => {
      if (typeof v === 'string' && v.length > 500) return v.slice(0, 500) + '...';
      return v;
    }));
    return JSON.stringify(truncated, null, 2);
  } catch {
    return raw;
  }
}
