'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const SEGMENTS = [
  { value: 'daily', label: 'AI懶人報', desc: '每日 AI 工具與新聞精選' },
  { value: 'weekly', label: 'AI精選週報', desc: '一週 AI 重點整理' },
  { value: 'robot', label: '機器人週報', desc: '機器人與自動化新聞' },
] as const;

const PIPELINE_STAGES = [
  { key: 'fetchYoutube', label: '抓取影片' },
  { key: 'classify', label: '分類' },
  { key: 'scriptEnglish', label: '英文講稿' },
  { key: 'extractTools', label: '擷取工具' },
  { key: 'translate', label: '翻譯' },
  { key: 'enrichMemory', label: '記憶注入' },
  { key: 'scoreQuality', label: '品質評分' },
  { key: 'generateMeta', label: '標題描述' },
  { key: 'synthesizeTts', label: '語音合成' },
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

  // Pipeline tracking state
  const [tracking, setTracking] = useState<PipelineRun | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup polling on unmount
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
        // Ignore polling errors
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

      // Start tracking
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
      setMessage(`錯誤: ${(err as Error).message}`);
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

  if (!open && !tracking) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="bg-blue-600 hover:bg-blue-500 text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm"
      >
        + 建立新集數
      </button>
    );
  }

  // Pipeline tracking view
  if (tracking) {
    const currentIdx = PIPELINE_STAGES.findIndex((s) => s.key === tracking.current_stage);
    const isRunning = tracking.status === 'running';
    const isCompleted = tracking.status === 'completed';
    const isFailed = tracking.status === 'failed';

    return (
      <div className="w-full mt-4">
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold">
              EP #{tracking.episode_number} — Pipeline {isRunning ? '執行中' : isCompleted ? '完成' : '失敗'}
            </h3>
            {isRunning && (
              <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            )}
          </div>

          {/* Stage progress */}
          <div className="space-y-1.5">
            {PIPELINE_STAGES.map((stage, i) => {
              let status: 'done' | 'running' | 'pending' | 'failed' = 'pending';
              if (isFailed && i === currentIdx) {
                status = 'failed';
              } else if (i < currentIdx || (isCompleted && i <= currentIdx)) {
                status = 'done';
              } else if (i === currentIdx && isRunning) {
                status = 'running';
              } else if (isCompleted) {
                status = 'done';
              }

              return (
                <div key={stage.key} className="flex items-center gap-3">
                  <div className="w-5 flex justify-center">
                    {status === 'done' && <span className="text-green-400 text-sm">&#10003;</span>}
                    {status === 'running' && <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />}
                    {status === 'failed' && <span className="text-red-400 text-sm">&#10007;</span>}
                    {status === 'pending' && <span className="w-2 h-2 rounded-full bg-zinc-700" />}
                  </div>
                  <span className={`text-sm ${
                    status === 'done' ? 'text-zinc-400' :
                    status === 'running' ? 'text-zinc-100 font-medium' :
                    status === 'failed' ? 'text-red-400' :
                    'text-zinc-600'
                  }`}>
                    {stage.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Error log */}
          {isFailed && tracking.error_log && (
            <div className="mt-4 bg-red-950/30 border border-red-900/50 rounded-lg p-3">
              <p className="text-xs font-medium text-red-400 mb-1">錯誤訊息</p>
              <p className="text-xs text-red-300 font-mono whitespace-pre-wrap break-all">
                {tracking.error_log}
              </p>
            </div>
          )}

          {/* Success actions */}
          {isCompleted && (
            <div className="mt-4 flex items-center gap-3">
              <Link
                href={`/episodes/${tracking.episode_number}/review`}
                className="bg-blue-600 hover:bg-blue-500 text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm"
              >
                前往審核
              </Link>
              <button
                onClick={handleReset}
                className="text-zinc-500 hover:text-zinc-300 px-3 py-2 text-sm transition-colors"
              >
                關閉
              </button>
            </div>
          )}

          {/* Failed actions */}
          {isFailed && (
            <div className="mt-4">
              <button
                onClick={handleReset}
                className="text-zinc-500 hover:text-zinc-300 px-3 py-2 text-sm transition-colors"
              >
                關閉
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Form view
  return (
    <div className="w-full mt-4">
      <form onSubmit={handleSubmit} className="bg-zinc-900 rounded-lg border border-zinc-800 p-5">
        <h3 className="text-base font-semibold mb-4">建立新集數</h3>

        {/* Segment type cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          {SEGMENTS.map((seg) => (
            <button
              key={seg.value}
              type="button"
              onClick={() => setSegmentType(seg.value)}
              className={`text-left p-3 rounded-lg border transition-colors ${
                segmentType === seg.value
                  ? 'border-blue-500 bg-blue-950/40'
                  : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
              }`}
            >
              <p className="font-medium text-sm text-zinc-200">{seg.label}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{seg.desc}</p>
            </button>
          ))}
        </div>

        {/* Episode number + actions */}
        <div className="flex items-center gap-3">
          <input
            type="number"
            value={episodeNumber}
            onChange={(e) => setEpisodeNumber(e.target.value)}
            placeholder="集數 (例: 301)"
            min="1"
            required
            className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 w-40 focus:outline-none focus:border-zinc-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm"
          >
            {loading ? '啟動中...' : '開始生成'}
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); setMessage(''); }}
            className="text-zinc-500 hover:text-zinc-300 px-3 py-2 text-sm transition-colors"
          >
            取消
          </button>
        </div>
      </form>

      {message && (
        <p className={`mt-2 text-sm ${message.startsWith('錯誤') ? 'text-red-400' : 'text-green-400'}`}>
          {message}
        </p>
      )}
    </div>
  );
}
