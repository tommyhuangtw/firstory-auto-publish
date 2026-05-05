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
    structure_flow?: number;
    audio_safety?: number;
  };
  comments: {
    chat_feel: string;
    eng_mix: string;
    tw_localization: string;
    clarity: string;
    word_count: string;
    structure_flow?: string;
    audio_safety?: string;
    summary: string;
  };
}

interface Props {
  qualityScore: QualityScore;
  qualityIterations: number;
  totalCost: number | null;
  wordCount: number | null;
}

type DimensionKey = 'chat_feel' | 'eng_mix' | 'tw_localization' | 'clarity' | 'word_count' | 'structure_flow' | 'audio_safety';

const BASE_DIMENSIONS: { key: DimensionKey; label: string; max: number; color: string }[] = [
  { key: 'chat_feel', label: '聊天感', max: 25, color: 'bg-violet-500' },
  { key: 'eng_mix', label: '中英夾雜', max: 20, color: 'bg-blue-500' },
  { key: 'tw_localization', label: '台灣用語', max: 20, color: 'bg-cyan-500' },
  { key: 'clarity', label: '具體性', max: 20, color: 'bg-emerald-500' },
  { key: 'word_count', label: '字數', max: 15, color: 'bg-amber-500' },
];

const SYSDESIGN_DIMENSIONS: { key: DimensionKey; label: string; max: number; color: string }[] = [
  { key: 'chat_feel', label: '聊天感', max: 20, color: 'bg-violet-500' },
  { key: 'eng_mix', label: '中英夾雜', max: 15, color: 'bg-blue-500' },
  { key: 'tw_localization', label: '台灣用語', max: 10, color: 'bg-cyan-500' },
  { key: 'clarity', label: '具體性', max: 15, color: 'bg-emerald-500' },
  { key: 'word_count', label: '字數', max: 10, color: 'bg-amber-500' },
  { key: 'structure_flow', label: '結構流暢', max: 20, color: 'bg-teal-500' },
  { key: 'audio_safety', label: '聽覺友善', max: 10, color: 'bg-rose-500' },
];

export default function QualityBreakdown({ qualityScore, qualityIterations, totalCost, wordCount }: Props) {
  const [showComments, setShowComments] = useState(false);

  const hasSysdesign = qualityScore.dimensions.structure_flow != null;
  const dimensions = hasSysdesign ? SYSDESIGN_DIMENSIONS : BASE_DIMENSIONS;

  const overallColor =
    qualityScore.overall >= 88 ? 'text-emerald-400' :
    qualityScore.overall >= 75 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-zinc-300">Quality Score</h3>
        <div className="flex items-center gap-3 text-[11px] text-zinc-400">
          {qualityIterations > 0 && (
            <span>重寫 {qualityIterations} 次</span>
          )}
          {totalCost != null && (
            <span className="tabular-nums">${totalCost.toFixed(4)}</span>
          )}
          {wordCount != null && (
            <span className="tabular-nums">{wordCount.toLocaleString()} 字</span>
          )}
        </div>
      </div>

      {/* Overall score */}
      <div className="flex items-baseline gap-2 mb-5">
        <span className={`text-4xl font-bold tabular-nums ${overallColor}`}>
          {qualityScore.overall.toFixed(0)}
        </span>
        <span className="text-zinc-400 text-sm">/100</span>
      </div>

      {/* Dimension bars */}
      <div className="space-y-3">
        {dimensions.map(({ key, label, max, color }) => {
          const value = qualityScore.dimensions[key] ?? 0;
          const pct = Math.min((value / max) * 100, 100);
          return (
            <div key={key}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-zinc-400">{label}</span>
                <span className="text-zinc-400 tabular-nums">{value}/{max}</span>
              </div>
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${color} transition-all duration-500`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Toggle comments */}
      <button
        onClick={() => setShowComments(!showComments)}
        className="mt-4 text-xs text-zinc-400 hover:text-zinc-300 transition-colors cursor-pointer"
      >
        {showComments ? '隱藏評語' : '顯示評語'}
      </button>

      {showComments && (
        <div className="mt-3 space-y-2">
          {dimensions.map(({ key, label }) => {
            const comment = qualityScore.comments[key];
            if (!comment) return null;
            return (
              <div key={key} className="bg-zinc-950 rounded-lg px-3 py-2">
                <p className="text-[11px] text-zinc-400 mb-0.5">{label}</p>
                <p className="text-xs text-zinc-400">{comment}</p>
              </div>
            );
          })}
          {qualityScore.comments.summary && (
            <div className="bg-zinc-950 rounded-lg px-3 py-2">
              <p className="text-[11px] text-zinc-500 mb-0.5">總結</p>
              <p className="text-xs text-zinc-400">{qualityScore.comments.summary}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
