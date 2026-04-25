'use client';

import { useState } from 'react';

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
}

export default function SourceVideos({ videos }: Props) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (videos.length === 0) return null;

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800">
        <h3 className="text-sm font-medium text-zinc-300">Source Videos ({videos.length})</h3>
      </div>

      <div className="divide-y divide-zinc-800/50">
        {videos.map((v, i) => {
          const isExpanded = expandedIdx === i;
          const channel = v.channelName || v.channelTitle || 'Unknown';
          return (
            <div key={i}>
              <button
                onClick={() => setExpandedIdx(isExpanded ? null : i)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-800/30 transition-colors cursor-pointer"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-300 truncate">{v.title || 'Untitled'}</p>
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
