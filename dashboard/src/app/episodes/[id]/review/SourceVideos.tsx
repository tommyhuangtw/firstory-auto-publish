'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface VideoSource {
  videoId?: string;
  title?: string;
  channelName?: string;
  channelTitle?: string;
  viewCount?: number;
  classification?: string;
  transcript?: string;
}

interface Props {
  videos: VideoSource[];
  canEdit?: boolean;
  pipelineRunId?: number;
}

export default function SourceVideos({ videos, canEdit, pipelineRunId }: Props) {
  const router = useRouter();
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  if (videos.length === 0) return null;

  function toggleRemove(videoId: string) {
    setRemovedIds((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      return next;
    });
    setMessage('');
  }

  async function handleRegenerate() {
    if (!pipelineRunId || removedIds.size === 0) return;
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/pipeline/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pipelineRunId,
          fromStage: 'classify',
          stateOverrides: { excludedVideoIds: [...removedIds] },
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      setMessage('已重新生成，影片將被替換...');
      setRemovedIds(new Set());
      router.refresh();
    } catch (err) {
      setMessage(`失敗: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  const removedCount = removedIds.size;

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-300">Source Videos ({videos.length})</h3>
        {canEdit && removedCount > 0 && (
          <button
            onClick={handleRegenerate}
            disabled={loading}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-500/20 transition-colors cursor-pointer disabled:opacity-50"
          >
            <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
            {loading ? '重新生成中...' : `移除 ${removedCount} 部並重新生成`}
          </button>
        )}
      </div>

      {message && (
        <div className={`px-4 py-2 text-xs ${message.includes('失敗') ? 'text-red-400' : 'text-emerald-400'}`}>
          {message}
        </div>
      )}

      <div className="divide-y divide-zinc-800/50">
        {videos.map((v, i) => {
          const isExpanded = expandedIdx === i;
          const channel = v.channelName || v.channelTitle || 'Unknown';
          const videoId = v.videoId || '';
          const isRemoved = removedIds.has(videoId);

          return (
            <div key={i} className={isRemoved ? 'opacity-40' : ''}>
              <div className="flex items-center">
                <button
                  onClick={() => setExpandedIdx(isExpanded ? null : i)}
                  className="flex-1 flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-800/30 transition-colors cursor-pointer min-w-0"
                >
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${isRemoved ? 'line-through text-zinc-500' : 'text-zinc-300'}`}>
                      {v.title || 'Untitled'}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-zinc-400">{channel}</span>
                      {v.viewCount != null && (
                        <span className="text-[11px] text-zinc-400 tabular-nums">
                          {v.viewCount.toLocaleString()} views
                        </span>
                      )}
                      {v.classification && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          v.classification === 'is_tool' || v.classification === 'true'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-zinc-800 text-zinc-500'
                        }`}>
                          {v.classification}
                        </span>
                      )}
                    </div>
                  </div>
                  <svg
                    className={`w-3.5 h-3.5 text-zinc-400 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>

                {canEdit && videoId && (
                  <button
                    onClick={() => toggleRemove(videoId)}
                    className={`shrink-0 mr-3 p-1.5 rounded-md transition-colors cursor-pointer ${
                      isRemoved
                        ? 'text-emerald-400 hover:bg-emerald-900/30'
                        : 'text-zinc-500 hover:text-red-400 hover:bg-red-950/30'
                    }`}
                    aria-label={isRemoved ? 'Undo remove' : 'Remove video'}
                  >
                    {isRemoved ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                  </button>
                )}
              </div>

              {isExpanded && v.transcript && (
                <div className="px-4 pb-3">
                  <pre className="bg-zinc-950 rounded-lg px-3 py-2.5 text-[11px] text-zinc-400 font-mono leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
                    {v.transcript.slice(0, 1000)}
                    {v.transcript.length > 1000 && '...'}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
