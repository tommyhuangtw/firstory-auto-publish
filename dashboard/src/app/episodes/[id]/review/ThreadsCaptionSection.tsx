'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  episodeId: number;
  threadsCaption: string;
  threadsPostId: string | null;
  coverPath: string | null;
  canEdit: boolean;
}

const THREADS_LIMIT = 500;

export default function ThreadsCaptionSection({ episodeId, threadsCaption: initialCaption, threadsPostId: initialPostId, coverPath, canEdit }: Props) {
  const router = useRouter();
  const [threadsPostId, setThreadsPostId] = useState(initialPostId);
  const [caption, setCaption] = useState(initialCaption);
  const [savedCaption, setSavedCaption] = useState(initialCaption);
  const [expanded, setExpanded] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState('');

  const isDirty = caption !== savedCaption;
  const isOverLimit = caption.length > THREADS_LIMIT;

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setMessage('');
    try {
      const res = await fetch(`/api/episodes/${episodeId}/generate-threads-caption`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCaption(data.threadsCaption);
      setSavedCaption(data.threadsCaption);
      setMessage('Threads 貼文已生成');
      router.refresh();
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setGenerating(false);
    }
  }, [episodeId, router]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch(`/api/episodes/${episodeId}/save-meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadsCaption: caption }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSavedCaption(caption);
      setMessage('已儲存');
      router.refresh();
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [episodeId, caption, router]);

  const handlePublish = useCallback(async () => {
    if (isOverLimit) {
      setMessage(`Error: 貼文超過 ${THREADS_LIMIT} 字，請縮減後再發布`);
      return;
    }
    if (!confirm('確定要發布到 Threads？')) return;
    setPublishing(true);
    setMessage('');
    try {
      // Save first if dirty
      if (isDirty) {
        const saveRes = await fetch(`/api/episodes/${episodeId}/save-meta`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ threadsCaption: caption }),
        });
        if (!saveRes.ok) throw new Error('儲存失敗');
        setSavedCaption(caption);
      }
      const res = await fetch(`/api/episodes/${episodeId}/republish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'threads' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.threadsPostId) setThreadsPostId(data.threadsPostId);
      setMessage('Threads 發布成功！');
      router.refresh();
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setPublishing(false);
    }
  }, [episodeId, caption, isDirty, isOverLimit, router]);

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-zinc-800/50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2.5">
          <svg className="w-4 h-4 text-zinc-400" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.5 12.068c0-3.518.85-6.372 2.495-8.423C5.845 1.34 8.598.16 12.179.136h.007c2.907.02 5.408.862 7.258 2.46 1.85 1.599 2.93 3.83 3.056 6.404h-3.86c-.12-1.612-.79-2.888-1.98-3.784-1.19-.896-2.67-1.376-4.467-1.22-2.342.205-3.964 1.218-4.987 2.855C6.183 8.388 5.64 10.35 5.64 12.068c0 1.718.543 3.68 1.566 5.317 1.023 1.637 2.645 2.65 4.987 2.855 1.797.156 3.277-.324 4.467-1.22 1.19-.896 1.86-2.172 1.98-3.784h3.86c-.126 2.574-1.206 4.805-3.056 6.404-1.85 1.598-4.351 2.44-7.258 2.46z"/>
          </svg>
          <h3 className="text-sm font-medium text-zinc-300">Threads 貼文</h3>
          {threadsPostId && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-purple-500/15 text-purple-400">
              已發布
            </span>
          )}
        </div>
        <svg className={`w-4 h-4 text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-zinc-800">
          {/* Published status */}
          {threadsPostId && (
            <div className="pt-3 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
              <a
                href={`https://www.threads.net/post/${threadsPostId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-purple-400 hover:text-purple-300 transition-colors"
              >
                查看 Threads 貼文 ↗
              </a>
            </div>
          )}

          {/* Caption editor / Loading state */}
          {(generating || publishing) ? (
            <div className="pt-2 space-y-3">
              <div className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-4 min-h-[160px] flex flex-col items-center justify-center gap-3">
                <div className="flex gap-1.5">
                  <div className={`w-2 h-2 rounded-full animate-bounce [animation-delay:0ms] ${publishing ? 'bg-purple-500' : 'bg-purple-400'}`} />
                  <div className={`w-2 h-2 rounded-full animate-bounce [animation-delay:150ms] ${publishing ? 'bg-purple-500' : 'bg-purple-400'}`} />
                  <div className={`w-2 h-2 rounded-full animate-bounce [animation-delay:300ms] ${publishing ? 'bg-purple-500' : 'bg-purple-400'}`} />
                </div>
                <p className="text-sm text-zinc-400">
                  {publishing ? '正在發布到 Threads...' : 'AI 正在生成 Threads 貼文...'}
                </p>
              </div>
            </div>
          ) : caption ? (
            <div className="pt-2">
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={10}
                disabled={!canEdit}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-xs text-zinc-300 resize-y focus:outline-none focus:border-purple-500/50 disabled:opacity-60"
              />
              <div className="flex items-center justify-between mt-1">
                <p className={`text-[11px] tabular-nums ${isOverLimit ? 'text-red-400 font-medium' : 'text-zinc-500'}`}>
                  {caption.length}/{THREADS_LIMIT}
                </p>
                {isOverLimit && (
                  <p className="text-[11px] text-red-400">
                    超過 {THREADS_LIMIT} 字限制，請縮減內容或重新生成
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-500 pt-2">尚未生成 Threads 貼文，點擊下方按鈕生成</p>
          )}

          {/* Action buttons */}
          {canEdit && (
            <div className="flex gap-2">
              {caption && coverPath && (
                <button
                  onClick={handlePublish}
                  disabled={publishing || isOverLimit}
                  className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 disabled:opacity-50 text-white text-sm font-medium transition-all cursor-pointer"
                >
                  {publishing ? '發布中...' : 'Publish to Threads'}
                </button>
              )}
              {isDirty && (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2.5 rounded-lg bg-brand hover:bg-brand-light disabled:opacity-50 text-white text-sm font-medium transition-colors cursor-pointer"
                >
                  {saving ? '儲存中...' : '儲存'}
                </button>
              )}
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="px-4 py-2.5 rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-sm transition-colors cursor-pointer"
              >
                {generating ? 'AI 生成中...' : caption ? '重新生成' : 'AI 生成 Threads 貼文'}
              </button>
            </div>
          )}

          {/* Message */}
          {message && (
            <p className={`text-[11px] ${message.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
              {message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
