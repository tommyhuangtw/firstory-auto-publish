'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  episodeId: number;
  coverPath: string;
}

export default function RegenerateCoverButton({ episodeId, coverPath }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleRegenerate() {
    if (!confirm('重新生成封面圖？這會呼叫 kie.ai 產生新圖片。')) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/episodes/${episodeId}/regenerate-cover`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to regenerate cover');
      }
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="shrink-0 flex flex-col items-center gap-2">
      <img
        src={`/api/audio${coverPath}`}
        alt="Episode cover"
        className="rounded-xl border border-brand/30 w-40 h-40 object-cover"
      />
      <button
        onClick={handleRegenerate}
        disabled={loading}
        className="text-xs px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors disabled:opacity-50 cursor-pointer"
      >
        {loading ? '生成中...' : '重新生成封面'}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
