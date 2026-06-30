'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import PageHeader from '@/components/PageHeader';

interface Idea {
  id: number;
  content: string;
  source_type: string;
  source_url: string | null;
  status: 'new' | 'developing' | 'posted' | 'archived';
  posted_url: string | null;
  created_at: string;
  updated_at: string;
}

type FilterKey = 'active' | 'new' | 'developing' | 'posted' | 'archived';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'active', label: '進行中' },
  { key: 'new', label: '未處理' },
  { key: 'developing', label: '養草稿' },
  { key: 'posted', label: '已發布' },
  { key: 'archived', label: '封存' },
];

const STATUS_META: Record<Idea['status'], { label: string; cls: string }> = {
  new: { label: '未處理', cls: 'bg-brand/15 text-brand' },
  developing: { label: '養草稿', cls: 'bg-blue-500/15 text-blue-300' },
  posted: { label: '已發布', cls: 'bg-green-500/15 text-green-300' },
  archived: { label: '封存', cls: 'bg-zinc-700/50 text-zinc-400' },
};

// created_at is stored as UTC 'YYYY-MM-DD HH:MM:SS' (SQLite datetime('now')).
function relativeTime(utc: string): string {
  const then = new Date(utc.replace(' ', 'T') + 'Z').getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '剛剛';
  if (min < 60) return `${min} 分鐘前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小時前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return `${Math.floor(day / 30)} 個月前`;
}

export default function IdeasPage() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('active');
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [captureErr, setCaptureErr] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ideas');
      const data = await res.json();
      if (res.ok) setIdeas(data.ideas ?? []);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Capture — never drop the typed text: on failure keep it in the box and flag retry.
  async function capture() {
    const content = draft.trim();
    if (!content || saving) return;
    setSaving(true);
    setCaptureErr(false);
    try {
      const res = await fetch('/api/ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) { setCaptureErr(true); return; }
      const data = await res.json();
      setIdeas(prev => [data.idea, ...prev]);
      setDraft('');
      inputRef.current?.focus();
    } catch {
      setCaptureErr(true);
    } finally {
      setSaving(false);
    }
  }

  async function patch(id: number, body: Record<string, unknown>) {
    const res = await fetch(`/api/ideas/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      setIdeas(prev => prev.map(i => (i.id === id ? data.idea : i)));
      return true;
    }
    return false;
  }

  async function remove(id: number) {
    const res = await fetch(`/api/ideas/${id}`, { method: 'DELETE' });
    if (res.ok) setIdeas(prev => prev.filter(i => i.id !== id));
  }

  function startEdit(idea: Idea) {
    setEditingId(idea.id);
    setEditText(idea.content);
  }

  async function saveEdit(id: number) {
    const content = editText.trim();
    if (!content) return;
    // Editing an idea means you're working on it → move to developing (unless already past that).
    const idea = ideas.find(i => i.id === id);
    const body: Record<string, unknown> = { content };
    if (idea && idea.status === 'new') body.status = 'developing';
    const ok = await patch(id, body);
    if (ok) { setEditingId(null); setEditText(''); }
  }

  const visible = ideas.filter(i =>
    filter === 'active' ? i.status === 'new' || i.status === 'developing' : i.status === filter
  );

  const counts = {
    active: ideas.filter(i => i.status === 'new' || i.status === 'developing').length,
    new: ideas.filter(i => i.status === 'new').length,
    developing: ideas.filter(i => i.status === 'developing').length,
    posted: ideas.filter(i => i.status === 'posted').length,
    archived: ideas.filter(i => i.status === 'archived').length,
  };

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <PageHeader title="靈感速記" subtitle="想到什麼先丟這裡，回家再用「寫文章」好好打磨" />

      {/* Capture box — always at the top, autofocus, send keeps you here to jot the next one */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 mb-5">
        <textarea
          ref={inputRef}
          autoFocus
          value={draft}
          onChange={e => { setDraft(e.target.value); if (captureErr) setCaptureErr(false); }}
          onKeyDown={e => {
            // Cmd/Ctrl+Enter sends, so phone users can still add line breaks freely.
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); capture(); }
          }}
          rows={3}
          placeholder="想到什麼，先丟這裡…"
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-sm text-zinc-200 focus:border-brand outline-none resize-y"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-zinc-600">⌘/Ctrl + Enter 快速送出</span>
          <div className="flex items-center gap-2">
            {captureErr && <span className="text-xs text-red-400">未送出，請重試</span>}
            <button
              onClick={capture}
              disabled={saving || !draft.trim()}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-brand text-white disabled:opacity-40 transition-colors"
            >
              {saving ? '記下中…' : '記下'}
            </button>
          </div>
        </div>
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
              filter === f.key
                ? 'bg-brand/15 border-brand/50 text-brand'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700'
            }`}
          >
            {f.label}
            <span className="ml-1.5 text-[10px] opacity-60">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {/* List */}
      {!loaded ? (
        <p className="text-sm text-zinc-600 py-8 text-center">載入中…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-zinc-600 py-12 text-center">
          {filter === 'active' ? '還沒有點子，上面隨手記一個吧 ✏️' : '這個狀態目前沒有點子'}
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map(idea => {
            const meta = STATUS_META[idea.status];
            const editing = editingId === idea.id;
            return (
              <li key={idea.id} className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                {editing ? (
                  <div>
                    <textarea
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      rows={5}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-sm text-zinc-200 focus:border-brand outline-none resize-y"
                    />
                    <div className="mt-2 flex items-center justify-end gap-2">
                      <button onClick={() => { setEditingId(null); setEditText(''); }} className="px-3 py-1.5 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300">取消</button>
                      <button onClick={() => saveEdit(idea.id)} disabled={!editText.trim()} className="px-3 py-1.5 text-xs rounded-lg bg-brand text-white disabled:opacity-40">儲存</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-zinc-200 whitespace-pre-wrap break-words">{idea.content}</p>
                    <div className="mt-2.5 flex items-center gap-2 text-[11px] text-zinc-500">
                      <span className={`px-1.5 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
                      <span>{relativeTime(idea.created_at)}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Link
                        href={`/write?idea=${encodeURIComponent(idea.content)}`}
                        className="px-2.5 py-1.5 text-xs rounded-lg bg-brand/90 hover:bg-brand text-white"
                      >
                        ✨ 丟進寫文章
                      </Link>
                      <button onClick={() => startEdit(idea)} className="px-2.5 py-1.5 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300">✏️ 養草稿</button>
                      {idea.status !== 'posted' && (
                        <button onClick={() => patch(idea.id, { status: 'posted' })} className="px-2.5 py-1.5 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 text-green-300">✅ 已發布</button>
                      )}
                      {idea.status === 'archived' ? (
                        <button onClick={() => patch(idea.id, { status: 'new' })} className="px-2.5 py-1.5 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400">↩︎ 取回</button>
                      ) : (
                        <button onClick={() => patch(idea.id, { status: 'archived' })} className="px-2.5 py-1.5 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-500">封存</button>
                      )}
                      <button onClick={() => remove(idea.id)} className="ml-auto px-2.5 py-1.5 text-xs rounded-lg text-zinc-600 hover:text-red-400" title="刪除">🗑</button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
