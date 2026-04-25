'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const SEGMENTS = [
  { value: 'daily', label: 'AI懶人報', desc: '每日精選', color: 'border-blue-500/40 bg-blue-500/10 text-blue-400' },
  { value: 'weekly', label: 'AI精選週報', desc: '一週重點', color: 'border-violet-500/40 bg-violet-500/10 text-violet-400' },
  { value: 'robot', label: '機器人週報', desc: '自動化新聞', color: 'border-amber-500/40 bg-amber-500/10 text-amber-400' },
] as const;

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

interface PipelineRun {
  id: number;
  episode_number: number;
  status: string;
  current_stage: string | null;
  error_log: string | null;
  completed_at: string | null;
}

export default function NewEpisodeForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [episodeNumber, setEpisodeNumber] = useState('');
  const [segmentType, setSegmentType] = useState<string>('daily');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const [tracking, setTracking] = useState<PipelineRun | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-fetch next episode number from SoundOn RSS
  useEffect(() => {
    fetch('/api/soundon/latest')
      .then((res) => res.json())
      .then((data) => {
        if (data.nextEpisodeNumber && !episodeNumber) {
          setEpisodeNumber(String(data.nextEpisodeNumber));
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  function startPolling(runId: number) {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/pipeline/status/${runId}`);
        if (!res.ok) return;
        const run: PipelineRun = await res.json();
        setTracking(run);
        if (run.status === 'completed' || run.status === 'failed') {
          if (intervalRef.current) clearInterval(intervalRef.current);
          intervalRef.current = null;
          if (run.status === 'completed') router.refresh();
        }
      } catch {
        // ignore
      }
    }, 2000);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const num = parseInt(episodeNumber);
    if (isNaN(num) || num <= 0) {
      setMessage('請輸入有效的集數');
      return;
    }
    setLoading(true);
    setMessage('');
    setTracking(null);
    try {
      const res = await fetch('/api/pipeline/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeNumber: num, segmentType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTracking({
        id: data.pipelineRunId,
        episode_number: num,
        status: 'running',
        current_stage: 'fetchYoutube',
        error_log: null,
        completed_at: null,
      });
      startPolling(data.pipelineRunId);
    } catch (err) {
      setMessage(`${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    setTracking(null);
    setOpen(false);
    setMessage('');
    setEpisodeNumber('');
  }

  // Collapsed button
  if (!open && !tracking) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm cursor-pointer"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        建立新集數
      </button>
    );
  }

  // Pipeline tracking — compact card with stepper
  if (tracking) {
    const currentIdx = STAGES.findIndex((s) => s.key === tracking.current_stage);
    const isRunning = tracking.status === 'running';
    const isCompleted = tracking.status === 'completed';
    const isFailed = tracking.status === 'failed';
    const progress = currentIdx >= 0 ? ((currentIdx + 1) / STAGES.length) * 100 : 0;

    return (
      <div className="w-full mt-6">
        <div className="rounded-xl bg-zinc-900 border border-zinc-800 overflow-hidden">
          {/* Top progress bar */}
          <div className="h-1 bg-zinc-800">
            <div
              className={`h-full transition-all duration-700 ease-out ${
                isFailed
                  ? 'bg-red-500'
                  : isCompleted
                    ? 'bg-emerald-500'
                    : 'bg-gradient-to-r from-blue-500 to-cyan-400'
              }`}
              style={{ width: isCompleted ? '100%' : `${progress}%` }}
            />
          </div>

          <div className="p-5">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <span className="font-mono font-semibold text-zinc-200">
                  EP {tracking.episode_number}
                </span>
                {isRunning && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-blue-400">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75 animate-ping" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
                    </span>
                    Pipeline 執行中
                  </span>
                )}
                {isCompleted && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    完成
                  </span>
                )}
                {isFailed && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-red-400">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    失敗
                  </span>
                )}
              </div>
              {isRunning && (
                <span className="text-[11px] text-zinc-400 tabular-nums">
                  {currentIdx + 1} / {STAGES.length}
                </span>
              )}
            </div>

            {/* Horizontal stepper */}
            <div className="flex gap-1">
              {STAGES.map((stage, i) => {
                const isDone = isCompleted || i < currentIdx;
                const isActive = i === currentIdx && isRunning;
                const isError = i === currentIdx && isFailed;

                return (
                  <div key={stage.key} className="flex-1 group relative">
                    <div
                      className={`h-2 rounded-sm transition-all duration-300 ${
                        isDone
                          ? 'bg-emerald-500/70'
                          : isActive
                            ? 'bg-blue-500 animate-pulse'
                            : isError
                              ? 'bg-red-500'
                              : 'bg-zinc-800'
                      }`}
                    />
                    {/* Tooltip on hover */}
                    <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                      <span className={
                        isDone ? 'text-emerald-500/80' :
                        isActive ? 'text-blue-400' :
                        isError ? 'text-red-400' :
                        'text-zinc-500'
                      }>
                        {stage.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Current stage info */}
            {isRunning && (
              <p className="mt-6 text-xs text-zinc-400">
                正在執行：<span className="text-zinc-300">{STAGES[currentIdx]?.label || '準備中'}</span>
              </p>
            )}

            {/* Error */}
            {isFailed && tracking.error_log && (
              <div className="mt-5 rounded-lg bg-red-950/20 border border-red-900/30 p-3">
                <p className="text-[11px] font-medium text-red-400 mb-1">錯誤訊息</p>
                <p className="text-[11px] text-red-300/80 font-mono leading-relaxed break-all">
                  {tracking.error_log}
                </p>
              </div>
            )}

            {/* Actions */}
            {(isCompleted || isFailed) && (
              <div className="mt-5 flex items-center gap-3">
                {isCompleted && (
                  <Link
                    href={`/episodes/${tracking.episode_number}/review`}
                    className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm cursor-pointer"
                  >
                    前往審核
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                    </svg>
                  </Link>
                )}
                <button
                  onClick={handleReset}
                  className="text-zinc-400 hover:text-zinc-300 px-3 py-2 text-sm transition-colors cursor-pointer"
                >
                  關閉
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Create form
  return (
    <div className="w-full mt-6">
      <form onSubmit={handleSubmit} className="rounded-xl bg-zinc-900 border border-zinc-800 p-5">
        <h3 className="text-sm font-semibold text-zinc-300 mb-4">建立新集數</h3>

        {/* Segment selector */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {SEGMENTS.map((seg) => {
            const isSelected = segmentType === seg.value;
            return (
              <button
                key={seg.value}
                type="button"
                onClick={() => setSegmentType(seg.value)}
                className={`text-left px-3 py-2.5 rounded-lg border transition-all duration-200 cursor-pointer ${
                  isSelected
                    ? seg.color
                    : 'border-zinc-800 bg-zinc-800/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300'
                }`}
              >
                <p className={`text-sm font-medium ${isSelected ? '' : 'text-zinc-300'}`}>{seg.label}</p>
                <p className="text-[11px] mt-0.5 opacity-70">{seg.desc}</p>
              </button>
            );
          })}
        </div>

        {/* Input row */}
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={episodeNumber}
            onChange={(e) => setEpisodeNumber(e.target.value)}
            placeholder="集數"
            min="1"
            required
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 w-28 focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/30 tabular-nums transition-colors"
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm cursor-pointer disabled:cursor-not-allowed"
          >
            {loading ? '啟動中...' : '開始生成'}
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); setMessage(''); }}
            className="text-zinc-400 hover:text-zinc-300 px-3 py-2 text-sm transition-colors cursor-pointer"
          >
            取消
          </button>
        </div>
      </form>

      {message && (
        <p className="mt-2 text-sm text-red-400">{message}</p>
      )}
    </div>
  );
}
