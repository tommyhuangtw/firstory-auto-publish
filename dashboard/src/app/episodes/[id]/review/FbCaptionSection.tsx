'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

function getFbPostUrl(postId: string): string {
  const parts = postId.split('_');
  if (parts.length === 2) return `https://www.facebook.com/${parts[0]}/posts/${parts[1]}`;
  return `https://www.facebook.com/${postId}`;
}

interface Props {
  episodeId: number;
  fbCaption: string;
  fbPostId: string | null;
  coverPath: string | null;
  canEdit: boolean;
}

export default function FbCaptionSection({ episodeId, fbCaption: initialCaption, fbPostId: initialPostId, coverPath, canEdit }: Props) {
  const router = useRouter();
  const [fbPostId, setFbPostId] = useState(initialPostId);
  const [caption, setCaption] = useState(initialCaption);
  const [savedCaption, setSavedCaption] = useState(initialCaption);
  const [expanded, setExpanded] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState('');

  const isDirty = caption !== savedCaption;

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setMessage('');
    try {
      const res = await fetch(`/api/episodes/${episodeId}/generate-fb-caption`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCaption(data.fbCaption);
      setSavedCaption(data.fbCaption);
      setMessage('FB 貼文已生成');
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
        body: JSON.stringify({ fbCaption: caption }),
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
    if (!confirm('確定要發布到 Facebook？')) return;
    setPublishing(true);
    setMessage('');
    try {
      // Save first if dirty
      if (isDirty) {
        const saveRes = await fetch(`/api/episodes/${episodeId}/save-meta`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fbCaption: caption }),
        });
        if (!saveRes.ok) throw new Error('儲存失敗');
        setSavedCaption(caption);
      }
      const res = await fetch(`/api/episodes/${episodeId}/republish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'facebook' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.fbPostId) setFbPostId(data.fbPostId);
      setMessage('Facebook 發布成功！');
      router.refresh();
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setPublishing(false);
    }
  }, [episodeId, caption, isDirty, router]);

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-zinc-800/50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-base">📘</span>
          <h3 className="text-sm font-medium text-zinc-300">Facebook 貼文</h3>
          {fbPostId && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-blue-500/15 text-blue-400">
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
          {fbPostId && (
            <div className="pt-3 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              <a
                href={getFbPostUrl(fbPostId)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
              >
                查看 Facebook 貼文 ↗
              </a>
            </div>
          )}

          {/* Caption editor / Loading state */}
          {(generating || publishing) ? (
            <div className="pt-2 space-y-3">
              <div className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-4 min-h-[200px] flex flex-col items-center justify-center gap-3">
                <div className="flex gap-1.5">
                  <div className={`w-2 h-2 rounded-full animate-bounce [animation-delay:0ms] ${publishing ? 'bg-blue-500' : 'bg-blue-400'}`} />
                  <div className={`w-2 h-2 rounded-full animate-bounce [animation-delay:150ms] ${publishing ? 'bg-blue-500' : 'bg-blue-400'}`} />
                  <div className={`w-2 h-2 rounded-full animate-bounce [animation-delay:300ms] ${publishing ? 'bg-blue-500' : 'bg-blue-400'}`} />
                </div>
                <p className="text-sm text-zinc-400">
                  {publishing ? '正在發布到 Facebook...' : 'AI 正在生成 Facebook 貼文...'}
                </p>
              </div>
            </div>
          ) : caption ? (
            <div className="pt-2">
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={14}
                disabled={!canEdit}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-xs text-zinc-300 resize-y focus:outline-none focus:border-blue-500/50 disabled:opacity-60"
              />
              <p className="text-[11px] text-zinc-500 mt-1 tabular-nums">{caption.length} 字</p>
            </div>
          ) : (
            <p className="text-sm text-zinc-500 pt-2">尚未生成 FB 貼文，點擊下方按鈕生成</p>
          )}

          {/* Action buttons */}
          {canEdit && (
            <div className="flex gap-2">
              {caption && coverPath && (
                <button
                  onClick={handlePublish}
                  disabled={publishing}
                  className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 disabled:opacity-50 text-white text-sm font-medium transition-all cursor-pointer"
                >
                  {publishing ? '發布中...' : 'Publish to Facebook'}
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
                {generating ? 'AI 生成中...' : caption ? '重新生成' : 'AI 生成 FB 貼文'}
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
