'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const SEGMENTS = [
  { value: 'daily', label: 'AI懶人報', desc: '每日 AI 工具與新聞精選' },
  { value: 'weekly', label: 'AI精選週報', desc: '一週 AI 重點整理' },
  { value: 'robot', label: '機器人週報', desc: '機器人與自動化新聞' },
] as const;

export default function NewEpisodeForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [episodeNumber, setEpisodeNumber] = useState('');
  const [segmentType, setSegmentType] = useState<string>('daily');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const num = parseInt(episodeNumber);
    if (isNaN(num) || num <= 0) {
      setMessage('請輸入有效的集數');
      return;
    }

    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/pipeline/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeNumber: num, segmentType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage(`Pipeline 已啟動！Run #${data.pipelineRunId}`);
      setOpen(false);
      setEpisodeNumber('');
      router.refresh();
    } catch (err) {
      setMessage(`錯誤: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="bg-blue-600 hover:bg-blue-500 text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm"
      >
        + 建立新集數
      </button>
    );
  }

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
