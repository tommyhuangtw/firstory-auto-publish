'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface VideoSource {
  videoId?: string;
  title?: string;
  channelName?: string;
  channelTitle?: string;
  viewCount?: number;
  publishedAt?: string;
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

  const [copied, setCopied] = useState(false);

  if (videos.length === 0) return null;

  function copyUrls() {
    const urls = videos
      .filter(v => v.videoId)
      .map(v => `https://www.youtube.com/watch?v=${v.videoId}`)
      .join('\n');
    navigator.clipboard.writeText(urls).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

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
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-zinc-300">Source Videos ({videos.length})</h3>
          <button
            onClick={copyUrls}
            className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
            title="複製所有 YouTube URLs"
          >
            {copied ? (
              <>
                <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                <span className="text-emerald-400">已複製</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                </svg>
                <span>複製 URLs</span>
              </>
            )}
          </button>
        </div>
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
                {videoId && (
                  <a
                    href={`https://www.youtube.com/watch?v=${videoId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="shrink-0 ml-4 p-2 text-red-400/60 hover:text-red-400 transition-colors"
                    title="在 YouTube 開啟"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.546 12 3.546 12 3.546s-7.505 0-9.377.504A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.504 9.376.504 9.376.504s7.505 0 9.377-.504a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                    </svg>
                  </a>
                )}
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
                      {v.publishedAt && (
                        <span className="text-[11px] text-zinc-500 tabular-nums">
                          {new Date(v.publishedAt).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })}
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
