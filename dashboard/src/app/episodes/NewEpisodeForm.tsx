'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const SEGMENTS = [
  { value: 'daily', label: 'AI懶人報', desc: '每日精選', color: 'border-blue-500/40 bg-blue-500/10 text-blue-400' },
  { value: 'weekly', label: 'AI精選週報', desc: '一週重點', color: 'border-violet-500/40 bg-violet-500/10 text-violet-400' },
  { value: 'robot', label: '機器人週報', desc: '自動化新聞', color: 'border-amber-500/40 bg-amber-500/10 text-amber-400' },
  { value: 'sysdesign', label: '系統設計懶懶學', desc: '系統設計深潛', color: 'border-teal-500/40 bg-teal-500/10 text-teal-400' },
  { value: 'quickchat', label: '懶懶碎碎念', desc: '觀點碎碎念', color: 'border-pink-500/40 bg-pink-500/10 text-pink-400' },
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

const segmentLabels: Record<string, string> = {
  daily: 'AI懶人報',
  weekly: 'AI精選週報',
  robot: '機器人週報',
  sysdesign: '系統設計懶懶學',
  quickchat: '懶懶碎碎念',
};

interface PipelineRun {
  id: number;
  episode_id: number;
  status: string;
  current_stage: string | null;
  error_log: string | null;
  completed_at: string | null;
}

interface TrackingState {
  runId: number;
  episodeId: number;
  segmentType: string;
  status: string;
  current_stage: string | null;
  error_log: string | null;
}

export default function NewEpisodeForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [segmentType, setSegmentType] = useState<string>('daily');
  const [manualUrls, setManualUrls] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [episodeLength, setEpisodeLength] = useState<12 | 15 | 18 | 21 | 25>(18);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const [tracking, setTracking] = useState<TrackingState | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  function startPolling(runId: number, episodeId: number, segType: string) {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/pipeline/status/${runId}`);
        if (!res.ok) return;
        const run: PipelineRun = await res.json();
        setTracking({
          runId,
          episodeId,
          segmentType: segType,
          status: run.status,
          current_stage: run.current_stage,
          error_log: run.error_log,
        });
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
    setLoading(true);
    setMessage('');
    setTracking(null);
    try {
      const body: Record<string, unknown> = { segmentType };
      if (segmentType === 'sysdesign' || segmentType === 'quickchat' || segmentType === 'daily') {
        const urls = manualUrls.split('\n').map(u => u.trim()).filter(Boolean);
        if ((segmentType === 'sysdesign' || segmentType === 'quickchat') && urls.length === 0) {
          setMessage('請至少貼入一個 YouTube URL');
          setLoading(false);
          return;
        }
        if (urls.length > 0) {
          body.manualVideoUrls = urls;
        }
        if (customInstructions.trim()) {
          body.customInstructions = customInstructions.trim();
        }
        if (segmentType === 'quickchat' || (segmentType === 'daily' && urls.length > 0)) {
          body.episodeLength = episodeLength;
        }
      }
      const res = await fetch('/api/pipeline/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTracking({
        runId: data.pipelineRunId,
        episodeId: data.episodeId,
        segmentType,
        status: 'running',
        current_stage: 'fetchYoutube',
        error_log: null,
      });
      startPolling(data.pipelineRunId, data.episodeId, segmentType);
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
    const segLabel = segmentLabels[tracking.segmentType] || tracking.segmentType;

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
                  {segLabel}
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
                    href={`/episodes/${tracking.episodeId}/review`}
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
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
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

        {/* Manual URL input for sysdesign / quickchat / daily */}
        {(segmentType === 'sysdesign' || segmentType === 'quickchat' || segmentType === 'daily') && (
          <div className="mb-4">
            <label className="block text-xs text-zinc-400 mb-1.5">
              YouTube URL（一行一個）{segmentType === 'daily' && <span className="text-zinc-500">（選填，留空則自動搜尋）</span>}
              {manualUrls.trim() && (
                <span className="ml-2 text-teal-400">
                  {manualUrls.split('\n').filter(u => u.trim()).length} 個影片
                </span>
              )}
            </label>
            <textarea
              value={manualUrls}
              onChange={(e) => setManualUrls(e.target.value)}
              placeholder={'https://www.youtube.com/watch?v=...\nhttps://youtu.be/...'}
              rows={4}
              className="w-full rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm px-3 py-2 placeholder:text-zinc-600 focus:outline-none focus:border-teal-500/50 resize-none"
            />
          </div>
        )}

        {/* Custom instructions (visible when daily has URLs) */}
        {segmentType === 'daily' && manualUrls.split('\n').some(u => u.trim()) && (
          <div className="mb-4">
            <label className="block text-xs text-zinc-400 mb-1.5">
              指定方向（選填）
            </label>
            <textarea
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              placeholder="例：請著重比較 Claude 和 GPT 的差異、請從開發者角度分析..."
              rows={3}
              className="w-full rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm px-3 py-2 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50 resize-none"
            />
          </div>
        )}

        {/* Episode length selector for quickchat or daily with manual URLs */}
        {(segmentType === 'quickchat' || (segmentType === 'daily' && manualUrls.split('\n').some(u => u.trim()))) && (
          <div className="mb-4">
            <label className="block text-xs text-zinc-400 mb-1.5">節目長度</label>
            <div className="flex gap-2">
              {([12, 15, 18, 21, 25] as const).map((len) => (
                <button
                  key={len}
                  type="button"
                  onClick={() => setEpisodeLength(len)}
                  className={`px-3 py-1.5 rounded-lg border text-sm transition-all cursor-pointer ${
                    episodeLength === len
                      ? (segmentType === 'daily' ? 'border-blue-500/40 bg-blue-500/10 text-blue-400' : 'border-pink-500/40 bg-pink-500/10 text-pink-400')
                      : 'border-zinc-800 bg-zinc-800/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300'
                  }`}
                >
                  {len} 分鐘
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Action row */}
        <div className="flex items-center gap-2">
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
