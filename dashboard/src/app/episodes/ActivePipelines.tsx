'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const STAGES = [
  { key: 'fetchYoutube', label: '抓取' },
  { key: 'classify', label: '分類' },
  { key: 'scriptEnglish', label: '講稿' },
  { key: 'extractTools', label: '工具' },
  { key: 'translate', label: '翻譯' },
  { key: 'customContentInsert', label: '插入' },
  { key: 'enrichMemory', label: '記憶' },
  { key: 'scoreQuality', label: '評分' },
  { key: 'generateMeta', label: '描述' },
  { key: 'generateCover', label: '封面' },
  { key: 'synthesizeTts', label: '語音' },
  { key: 'uploadAssets', label: '上傳' },
  { key: 'notify', label: '通知' },
] as const;

interface PipelineInfo {
  episode_number: number;
  segment_type: string;
  current_stage: string | null;
  pipeline_status: string | null;
  error_log: string | null;
}

interface Props {
  initialRuns: PipelineInfo[];
}

export default function ActivePipelines({ initialRuns }: Props) {
  const router = useRouter();
  const [runs, setRuns] = useState(initialRuns);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/pipeline/status');
        if (!res.ok) return;
        const data = await res.json();
        const active = (data.runs || []).filter(
          (r: { status: string }) => r.status === 'running'
        );

        if (active.length === 0) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          intervalRef.current = null;
          router.refresh();
          return;
        }

        setRuns(
          active.map((r: Record<string, unknown>) => ({
            episode_number: r.episode_number as number,
            segment_type: r.segment_type as string,
            current_stage: r.current_stage as string | null,
            pipeline_status: r.status as string,
            error_log: r.error_log as string | null,
          }))
        );
      } catch {
        // ignore
      }
    }, 2000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [router]);

  if (runs.length === 0) return null;

  return (
    <div className="space-y-3">
      {runs.map((run) => {
        const currentIdx = STAGES.findIndex((s) => s.key === run.current_stage);
        const progress = currentIdx >= 0 ? ((currentIdx + 1) / STAGES.length) * 100 : 0;

        return (
          <div
            key={run.episode_number}
            className="rounded-xl bg-zinc-900 border border-zinc-800 overflow-hidden"
          >
            {/* Progress bar */}
            <div className="h-1 bg-zinc-800">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-700 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>

            <div className="p-4">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="font-mono font-semibold text-zinc-200">
                    EP {run.episode_number}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs text-blue-400">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75 animate-ping" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
                    </span>
                    生成中
                  </span>
                </div>
                <span className="text-xs text-zinc-400 tabular-nums">
                  {currentIdx + 1} / {STAGES.length}
                </span>
              </div>

              {/* Horizontal stepper */}
              <div className="flex gap-1">
                {STAGES.map((stage, i) => {
                  const isDone = i < currentIdx;
                  const isActive = i === currentIdx;
                  const isPending = i > currentIdx;

                  return (
                    <div key={stage.key} className="flex-1 group relative">
                      {/* Bar segment */}
                      <div
                        className={`h-1.5 rounded-full transition-all duration-300 ${
                          isDone
                            ? 'bg-emerald-500/80'
                            : isActive
                              ? 'bg-blue-500 animate-pulse'
                              : 'bg-zinc-800'
                        }`}
                      />
                      {/* Label (only show on hover or active) */}
                      <div
                        className={`absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] transition-opacity ${
                          isActive
                            ? 'opacity-100 text-blue-400 font-medium'
                            : isDone
                              ? 'opacity-0 group-hover:opacity-100 text-emerald-500/70'
                              : isPending
                                ? 'opacity-0 group-hover:opacity-100 text-zinc-500'
                                : 'opacity-0'
                        }`}
                      >
                        {stage.label}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Current stage label */}
              <p className="mt-7 text-xs text-zinc-400">
                目前：<span className="text-zinc-300">{STAGES[currentIdx]?.label || '準備中'}</span>
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
