'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  episodeId: number;
  igCaption: string;
  igPostId: string | null;
  coverPath: string | null;
  canEdit: boolean;
}

export default function IgCaptionSection({ episodeId, igCaption: initialCaption, igPostId, coverPath, canEdit }: Props) {
  const router = useRouter();
  const [caption, setCaption] = useState(initialCaption);
  const [savedCaption, setSavedCaption] = useState(initialCaption);
  const [expanded, setExpanded] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState('');

  const isDirty = caption !== savedCaption;

  const handleRegenerate = useCallback(async () => {
    setRegenerating(true);
    setMessage('');
    try {
      const res = await fetch(`/api/episodes/${episodeId}/regenerate-ig`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCaption(data.igCaption);
      setSavedCaption(data.igCaption);
      setMessage('IG 貼文已重新生成');
      router.refresh();
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setRegenerating(false);
    }
  }, [episodeId, router]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch(`/api/episodes/${episodeId}/save-meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ igCaption: caption }),
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
    if (!confirm('確定要發布 IG 貼文？')) return;
    setPublishing(true);
    setMessage('');
    try {
      // Save first if dirty
      if (isDirty) {
        const saveRes = await fetch(`/api/episodes/${episodeId}/save-meta`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ igCaption: caption }),
        });
        if (!saveRes.ok) throw new Error('儲存失敗');
        setSavedCaption(caption);
      }
      const res = await fetch(`/api/episodes/${episodeId}/republish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'instagram' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage('Instagram 發布成功');
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
          <span className="text-base">📸</span>
          <h3 className="text-sm font-medium text-zinc-300">Podcast IG 貼文</h3>
          {igPostId && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-emerald-500/15 text-emerald-400">
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
          {igPostId && (
            <div className="pt-3 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-[11px] text-zinc-500">Post ID: {igPostId}</span>
            </div>
          )}

          {/* Caption editor */}
          {caption ? (
            <div className="pt-2">
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={10}
                disabled={!canEdit}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-xs text-zinc-300 resize-y focus:outline-none focus:border-violet-500/50 disabled:opacity-60"
              />
              <p className="text-[11px] text-zinc-500 mt-1 tabular-nums">{caption.length} 字</p>
            </div>
          ) : (
            <p className="text-sm text-zinc-500 pt-2">尚未生成 IG 貼文</p>
          )}

          {/* Action buttons */}
          {canEdit && (
            <div className="flex gap-2">
              {caption && coverPath && (
                <button
                  onClick={handlePublish}
                  disabled={publishing}
                  className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 text-white text-sm font-medium transition-all cursor-pointer"
                >
                  {publishing ? '發布中...' : 'Publish to Instagram'}
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
                onClick={handleRegenerate}
                disabled={regenerating}
                className="px-4 py-2.5 rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-sm transition-colors cursor-pointer"
              >
                {regenerating ? '生成中...' : '重新生成'}
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
