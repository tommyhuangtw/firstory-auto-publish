'use client';

import { useState } from 'react';

interface QualityScore {
  overall: number;
  dimensions: {
    chat_feel: number;
    eng_mix: number;
    tw_localization: number;
    clarity: number;
    word_count: number;
  };
  comments: {
    chat_feel: string;
    eng_mix: string;
    tw_localization: string;
    clarity: string;
    word_count: string;
    summary: string;
  };
}

interface QualityIteration {
  iteration: number;
  score: QualityScore;
  scriptZh: string;
}

interface Props {
  history: QualityIteration[];
}

const DIMENSIONS = [
  { key: 'chat_feel', label: '聊天感', max: 25, color: 'bg-violet-500' },
  { key: 'eng_mix', label: '中英夾雜', max: 20, color: 'bg-blue-500' },
  { key: 'tw_localization', label: '台灣用語', max: 20, color: 'bg-cyan-500' },
  { key: 'clarity', label: '具體性', max: 20, color: 'bg-emerald-500' },
  { key: 'word_count', label: '字數', max: 15, color: 'bg-amber-500' },
] as const;

export default function QualityHistory({ history }: Props) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [showScript, setShowScript] = useState<number | null>(null);

  if (history.length <= 1) return null;

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
      <h3 className="text-sm font-medium text-zinc-300 mb-3">Iteration History</h3>
      <div className="space-y-2">
        {history.map((iter, idx) => {
          const isLast = idx === history.length - 1;
          const isExpanded = expandedIdx === idx;
          const scoreColor =
            iter.score.overall >= 88 ? 'text-emerald-400' :
            iter.score.overall >= 75 ? 'text-amber-400' : 'text-red-400';

          return (
            <div key={idx} className="rounded-lg bg-zinc-950 border border-zinc-800/60 overflow-hidden">
              {/* Iteration header — clickable */}
              <button
                onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                className="w-full flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-zinc-800/30 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-[11px] text-zinc-500 font-mono">#{iter.iteration}</span>
                  <span className={`text-sm font-semibold tabular-nums ${scoreColor}`}>
                    {iter.score.overall.toFixed(0)}
                  </span>
                  <span className="text-[11px] text-zinc-500">/100</span>
                  {isLast && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                      Final
                    </span>
                  )}
                </div>
                <svg
                  className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-3">
                  {/* Dimension bars */}
                  <div className="space-y-2">
                    {DIMENSIONS.map(({ key, label, max, color }) => {
                      const value = iter.score.dimensions[key];
                      const pct = (value / max) * 100;
                      return (
                        <div key={key}>
                          <div className="flex items-center justify-between text-[11px] mb-0.5">
                            <span className="text-zinc-500">{label}</span>
                            <span className="text-zinc-500 tabular-nums">{value}/{max}</span>
                          </div>
                          <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${color} transition-all duration-500`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Comments */}
                  <div className="space-y-1.5">
                    {DIMENSIONS.map(({ key, label }) => {
                      const comment = iter.score.comments[key];
                      if (!comment) return null;
                      return (
                        <div key={key} className="bg-zinc-900 rounded px-2.5 py-1.5">
                          <p className="text-[10px] text-zinc-500 mb-0.5">{label}</p>
                          <p className="text-[11px] text-zinc-400 leading-relaxed">{comment}</p>
                        </div>
                      );
                    })}
                    {iter.score.comments.summary && (
                      <div className="bg-zinc-900 rounded px-2.5 py-1.5">
                        <p className="text-[10px] text-zinc-500 mb-0.5">Summary</p>
                        <p className="text-[11px] text-zinc-400 leading-relaxed">{iter.score.comments.summary}</p>
                      </div>
                    )}
                  </div>

                  {/* Script toggle */}
                  <button
                    onClick={() => setShowScript(showScript === idx ? null : idx)}
                    className="text-[11px] text-zinc-500 hover:text-zinc-400 transition-colors cursor-pointer"
                  >
                    {showScript === idx ? '隱藏講稿' : '顯示講稿'}
                  </button>

                  {showScript === idx && (
                    <div className="bg-zinc-900 rounded-lg p-3 max-h-64 overflow-y-auto">
                      <pre className="text-[11px] text-zinc-400 whitespace-pre-wrap font-mono leading-relaxed">
                        {iter.scriptZh}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
