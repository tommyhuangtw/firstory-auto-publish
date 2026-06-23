'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Candidate {
  path: string;
  url: string;
  createdAt: string;
  source: string;
}

interface CoverTask {
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error?: string;
}

interface Props {
  episodeId: number;
  coverPath?: string | null;
  candidates?: Candidate[];
}

export default function RegenerateCoverButton({ episodeId, coverPath, candidates: initialCandidates = [] }: Props) {
  const router = useRouter();
  const [candidates, setCandidates] = useState<Candidate[]>(initialCandidates);
  const [activeCoverPath, setActiveCoverPath] = useState(coverPath);
  const [tasks, setTasks] = useState<CoverTask[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [showGallery, setShowGallery] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Context (news/topic) that augments the scenario; persists until changed/cleared.
  const [contextOpen, setContextOpen] = useState(false);
  const [contextText, setContextText] = useState('');
  const [contextImageUrl, setContextImageUrl] = useState('');
  const [ctxLoading, setCtxLoading] = useState(false);
  const ctxFileRef = useRef<HTMLInputElement>(null);
  const hasContext = !!(contextText.trim() || contextImageUrl);

  const hasCover = !!activeCoverPath;
  const activeIndex = candidates.findIndex(c => c.path === activeCoverPath);

  // Count active (pending + running) tasks
  const activeTasks = tasks.filter(t => t.status === 'pending' || t.status === 'running');
  const isGenerating = activeTasks.length > 0;

  // Poll for task status while any tasks are active
  useEffect(() => {
    if (!isGenerating) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/episodes/${episodeId}/regenerate-cover`);
        if (!res.ok) return;
        const data = await res.json();
        setTasks(data.tasks || []);
        if (data.candidates) setCandidates(data.candidates);
        if (data.activeCoverPath) setActiveCoverPath(data.activeCoverPath);
      } catch { /* ignore poll errors */ }
    };

    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [isGenerating, episodeId]);

  // When all tasks finish, sync server components
  const prevGeneratingRef = useRef(isGenerating);
  useEffect(() => {
    if (prevGeneratingRef.current && !isGenerating && tasks.length > 0) {
      router.refresh();
    }
    prevGeneratingRef.current = isGenerating;
  }, [isGenerating, tasks.length, router]);

  const handleGenerate = useCallback(async () => {
    // No confirm — fires instantly so you can click repeatedly to queue many.
    setError('');
    try {
      const useCtx = !!(contextText.trim() || contextImageUrl);
      const res = await fetch(`/api/episodes/${episodeId}/regenerate-cover`, {
        method: 'POST',
        ...(useCtx
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contextText: contextText.trim() || undefined,
                contextImageUrl: contextImageUrl || undefined,
              }),
            }
          : {}),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to enqueue generation');
      }
      const data = await res.json();
      // Add the new task to local state immediately (optimistic)
      setTasks(prev => [...prev, { taskId: data.taskId, status: data.status }]);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [episodeId, contextText, contextImageUrl]);

  async function handleContextImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCtxLoading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('image', file);
      const res = await fetch(`/api/episodes/${episodeId}/context-image`, { method: 'POST', body: formData });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Context image upload failed');
      }
      const data = await res.json();
      setContextImageUrl(data.url);
      setContextOpen(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCtxLoading(false);
      if (ctxFileRef.current) ctxFileRef.current.value = '';
    }
  }

  function clearContext() {
    setContextText('');
    setContextImageUrl('');
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setActionLoading(true);
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
      setActionLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleSelect(index: number) {
    if (index === activeIndex) return;
    setActionLoading(true);
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
      // Update local state immediately so the preview reflects the selection
      setActiveCoverPath(candidates[index].path);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  }

  // Generate button text
  const generateText = isGenerating
    ? `再加一張 (${activeTasks.length})`
    : hasCover ? '重新生成' : '生成封面';

  // Context panel — paste news/topic text and/or attach a screenshot. Persists
  // across re-generate clicks until cleared. Rendered in both layout branches.
  const contextPanel = (
    <div className="w-full sm:w-40">
      <button
        onClick={() => setContextOpen(o => !o)}
        className={`w-full text-[11px] px-2 py-1 rounded-lg border transition-colors cursor-pointer ${
          hasContext
            ? 'bg-brand/15 text-brand border-brand/30'
            : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700'
        }`}
      >
        {hasContext ? `✓ 已附情境${contextImageUrl ? ' 🖼' : ''}` : '＋ 加情境/新聞'}
      </button>
      {contextOpen && (
        <div className="mt-1.5 flex flex-col gap-1.5 p-2 rounded-lg bg-zinc-900/60 border border-zinc-700">
          <textarea
            value={contextText}
            onChange={e => setContextText(e.target.value)}
            placeholder="貼上新聞 / 時事 / 想要的梗…"
            rows={3}
            className="w-full text-[11px] rounded-md bg-zinc-950 border border-zinc-700 px-2 py-1 text-zinc-200 placeholder:text-zinc-500 resize-y"
          />
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => ctxFileRef.current?.click()}
              disabled={ctxLoading}
              className="text-[11px] px-2 py-1 rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {ctxLoading ? '上傳中…' : '附截圖'}
            </button>
            {contextImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={contextImageUrl} alt="context" className="w-7 h-7 rounded object-cover border border-zinc-600" />
            )}
            {hasContext && (
              <button
                onClick={clearContext}
                className="text-[11px] px-2 py-1 rounded-md text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer ml-auto"
              >
                清除
              </button>
            )}
          </div>
          <input ref={ctxFileRef} type="file" accept="image/*" onChange={handleContextImage} className="hidden" />
        </div>
      )}
    </div>
  );

  // No cover state
  if (!hasCover) {
    return (
      <div className="shrink-0 flex flex-col items-center gap-2">
        <div className="w-full sm:w-40 aspect-square rounded-xl border border-amber-500/30 bg-amber-950/20 flex flex-col items-center justify-center gap-2 px-3">
          <svg className="w-8 h-8 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-[11px] text-amber-400 text-center leading-tight">封面未生成</p>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={handleGenerate}
            disabled={actionLoading}
            className="text-xs px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-500/20 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {generateText}
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={actionLoading}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors disabled:opacity-50 cursor-pointer"
          >
            上傳
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" onChange={handleUpload} className="hidden" />
        {contextPanel}
        {isGenerating && (
          <div className="flex items-center gap-1.5 text-xs text-amber-400">
            <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" strokeOpacity={0.25} />
              <path d="M12 2a10 10 0 0 1 10 10" />
            </svg>
            <span>生成中 ({activeTasks.length} 個排隊)</span>
          </div>
        )}
        {error && <p className="text-xs text-red-400 max-w-[160px] text-center">{error}</p>}
      </div>
    );
  }

  return (
    <div className="shrink-0 flex flex-col items-center gap-2">
      {/* Active cover */}
      <img
        src={`/api/audio${activeCoverPath}`}
        alt="Episode cover"
        className="rounded-xl border border-brand/30 w-full sm:w-40 aspect-square object-cover"
      />

      {/* Action buttons */}
      <div className="flex gap-1.5">
        <button
          onClick={handleGenerate}
          className="text-xs px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors cursor-pointer"
        >
          {generateText}
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={actionLoading}
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

      {contextPanel}

      {/* Queue status */}
      {isGenerating && (
        <div className="flex items-center gap-1.5 text-xs text-amber-400">
          <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" strokeOpacity={0.25} />
            <path d="M12 2a10 10 0 0 1 10 10" />
          </svg>
          <span>生成中 ({activeTasks.length} 個排隊)</span>
        </div>
      )}

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
                  disabled={actionLoading || isActive}
                  className={`shrink-0 rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                    isActive
                      ? 'border-brand ring-1 ring-brand/40'
                      : 'border-zinc-700 hover:border-zinc-500'
                  } ${actionLoading ? 'opacity-50' : ''}`}
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
