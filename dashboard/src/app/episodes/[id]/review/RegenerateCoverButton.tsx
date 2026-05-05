'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Candidate {
  path: string;
  url: string;
  createdAt: string;
  source: string;
}

interface Props {
  episodeId: number;
  coverPath?: string | null;
  candidates?: Candidate[];
}

export default function RegenerateCoverButton({ episodeId, coverPath, candidates = [] }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showGallery, setShowGallery] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const hasCover = !!coverPath;

  // Find which candidate index matches the current active cover
  const activeIndex = candidates.findIndex(c => c.path === coverPath);

  async function handleGenerate() {
    if (hasCover && !confirm('重新生成封面圖？這會呼叫 kie.ai 產生新圖片。')) return;
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

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('cover', file);
      const res = await fetch(`/api/episodes/${episodeId}/upload-cover`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Upload failed');
      }
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleSelect(index: number) {
    if (index === activeIndex) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/episodes/${episodeId}/select-cover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Selection failed');
      }
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // No cover state
  if (!hasCover) {
    return (
      <div className="shrink-0 flex flex-col items-center gap-2">
        <div className="w-40 h-40 rounded-xl border border-amber-500/30 bg-amber-950/20 flex flex-col items-center justify-center gap-2 px-3">
          <svg className="w-8 h-8 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-[11px] text-amber-400 text-center leading-tight">封面未生成</p>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="text-xs px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-500/20 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {loading ? '處理中...' : '生成封面'}
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={loading}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors disabled:opacity-50 cursor-pointer"
          >
            上傳
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" onChange={handleUpload} className="hidden" />
        {error && <p className="text-xs text-red-400 max-w-[160px] text-center">{error}</p>}
      </div>
    );
  }

  return (
    <div className="shrink-0 flex flex-col items-center gap-2">
      {/* Active cover */}
      <img
        src={`/api/audio${coverPath}`}
        alt="Episode cover"
        className="rounded-xl border border-brand/30 w-40 h-40 object-cover"
      />

      {/* Action buttons */}
      <div className="flex gap-1.5">
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {loading ? '處理中...' : '重新生成'}
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors disabled:opacity-50 cursor-pointer"
        >
          上傳
        </button>
        {candidates.length > 1 && (
          <button
            onClick={() => setShowGallery(!showGallery)}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors cursor-pointer"
          >
            {showGallery ? '收起' : `候選 (${candidates.length})`}
          </button>
        )}
      </div>

      <input ref={fileRef} type="file" accept="image/*" onChange={handleUpload} className="hidden" />
      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Candidate gallery */}
      {showGallery && candidates.length > 1 && (
        <div className="w-full mt-1">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {candidates.map((c, i) => {
              const isActive = i === activeIndex;
              return (
                <button
                  key={`${c.path}-${i}`}
                  onClick={() => handleSelect(i)}
                  disabled={loading || isActive}
                  className={`shrink-0 rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                    isActive
                      ? 'border-brand ring-1 ring-brand/40'
                      : 'border-zinc-700 hover:border-zinc-500'
                  } ${loading ? 'opacity-50' : ''}`}
                  title={`${c.source === 'upload' ? '手動上傳' : 'AI 生成'} — ${new Date(c.createdAt).toLocaleString('zh-TW')}`}
                >
                  <div className="relative">
                    <img
                      src={`/api/audio${c.path}`}
                      alt={`Candidate ${i + 1}`}
                      className="w-16 h-16 object-cover"
                    />
                    {isActive && (
                      <div className="absolute inset-0 bg-brand/20 flex items-center justify-center">
                        <svg className="w-5 h-5 text-brand" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
