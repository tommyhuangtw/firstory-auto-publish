'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  pipelineRunId: number;
  failedStage: string | null;
}

const STAGES = [
  { key: 'fetchYoutube', label: '抓取 YouTube' },
  { key: 'classify', label: '影片分類' },
  { key: 'scriptEnglish', label: '英文講稿' },
  { key: 'extractTools', label: '工具擷取' },
  { key: 'translate', label: '中文翻譯' },
  { key: 'customContentInsert', label: '客製內容插入' },
  { key: 'enrichMemory', label: '記憶強化' },
  { key: 'scoreQuality', label: '品質評分' },
  { key: 'generateMeta', label: '標題描述' },
  { key: 'generateCover', label: '封面生成' },
  { key: 'synthesizeTts', label: '語音合成' },
  { key: 'uploadAssets', label: '上傳素材' },
  { key: 'notify', label: '通知發送' },
];

export default function RetryControls({ pipelineRunId, failedStage }: Props) {
  const router = useRouter();
  const [selectedStage, setSelectedStage] = useState(failedStage || 'synthesizeTts');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function handleRetry() {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/pipeline/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipelineRunId, fromStage: selectedStage }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      setMessage(`從「${STAGES.find((s) => s.key === selectedStage)?.label}」重新開始...`);
      router.refresh();
    } catch (err) {
      setMessage(`重試失敗: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
      <h3 className="text-sm font-medium text-zinc-300 mb-3">Stage Retry</h3>
      <div className="flex items-center gap-2">
        <select
          value={selectedStage}
          onChange={(e) => setSelectedStage(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500 cursor-pointer flex-1"
        >
          {STAGES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}{s.key === failedStage ? ' (失敗點)' : ''}
            </option>
          ))}
        </select>
        <button
          onClick={handleRetry}
          disabled={loading}
          className="inline-flex items-center gap-1.5 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 text-sm font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border border-amber-500/20"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
          </svg>
          {loading ? '重跑中...' : '從這裡重跑'}
        </button>
      </div>
      {message && (
        <p className={`mt-2 text-xs ${message.includes('失敗') ? 'text-red-400' : 'text-emerald-400'}`}>
          {message}
        </p>
      )}
    </div>
  );
}
