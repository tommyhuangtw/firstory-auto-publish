'use client';

import { useCallback, useEffect, useState } from 'react';

interface Insight {
  id: number; hook: string; idea: string; why_share: string | null; category: string | null;
  resonance: number | null; status: string; origin: string;
  source_title: string | null; source_url: string | null; source_type: string;
}

export default function InspirationPage() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'visible' | 'saved' | 'new'>('visible');
  const [sort, setSort] = useState<'resonance' | 'newest'>('resonance');
  const [q, setQ] = useState('');
  const [ingestUrl, setIngestUrl] = useState('');
  const [ingestPoints, setIngestPoints] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState<Record<number, boolean>>({});
  const [draftNote, setDraftNote] = useState<Record<number, string>>({});
  const [draftText, setDraftText] = useState<Record<number, string>>({});
  const [genBusy, setGenBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ status: statusFilter, sort });
    if (q.trim()) params.set('q', q.trim());
    const res = await fetch(`/api/inspiration/insights?${params}`);
    const data = await res.json();
    setInsights(data.insights || []);
    setLoading(false);
  }, [statusFilter, sort, q]);

  useEffect(() => { load(); }, [load]);

  const ingest = async () => {
    if (!ingestUrl.trim()) return;
    setBusy('ingest');
    await fetch('/api/inspiration/ingest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: ingestUrl.trim(), userPoints: ingestPoints.trim() || undefined }),
    });
    setBusy(null); setIngestUrl(''); setIngestPoints('');
    alert('開始處理中，YouTube 幾秒、Podcast 需數分鐘。完成後重新整理即可看到。');
  };

  const setStatus = async (id: number, status: string) => {
    setBusy(`s${id}`);
    await fetch(`/api/inspiration/insights/${id}/status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    });
    setBusy(null); load();
  };

  const generate = async (id: number) => {
    setGenBusy(id);
    const res = await fetch(`/api/inspiration/insights/${id}/draft`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userNote: draftNote[id] || '' }),
    });
    const data = await res.json();
    setDraftText((p) => ({ ...p, [id]: data.draft_text || data.error || '產生失敗' }));
    setGenBusy(null);
  };

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-brand">靈感庫</h1>
        <a href="/inspiration/channels" className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700">頻道來源 →</a>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 mb-6">
        <input value={ingestUrl} onChange={(e) => setIngestUrl(e.target.value)}
          placeholder="貼上 YouTube 或 Apple Podcast 連結"
          className="w-full px-3 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-100 mb-2" />
        <textarea value={ingestPoints} onChange={(e) => setIngestPoints(e.target.value)}
          placeholder="（選填）我自己標的重點 — 填了就用我的角度，留空就讓 AI 挖"
          className="w-full px-3 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-100 mb-2" rows={2} />
        <button onClick={ingest} disabled={busy === 'ingest' || !ingestUrl.trim()}
          className="px-3 py-1.5 text-sm rounded-lg bg-brand/15 text-brand hover:bg-brand/25 disabled:opacity-50">
          {busy === 'ingest' ? '處理中…' : '+ 攝取靈感'}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 語意搜尋"
          className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-100" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'visible' | 'saved' | 'new')}
          className="px-2 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-100">
          <option value="visible">全部</option><option value="saved">已存</option><option value="new">新挖到</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as 'resonance' | 'newest')}
          className="px-2 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-100">
          <option value="resonance">共鳴排序</option><option value="newest">最新</option>
        </select>
      </div>

      {loading ? <p className="text-zinc-400">載入中…</p>
        : insights.length === 0 ? <p className="text-zinc-400">還沒有靈感，貼個連結開始吧。</p>
        : insights.map((it) => (
          <div key={it.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 mb-3 transition-colors">
            <div className="flex items-center gap-2 mb-2">
              {it.resonance != null && <span className="shrink-0 text-[11px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">🔥 共鳴 {it.resonance}</span>}
              {it.category && <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/50 text-zinc-300">{it.category}</span>}
            </div>
            <p className="text-base font-semibold text-zinc-100 mb-1">{it.hook}</p>
            <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap mb-1">{it.idea}</p>
            {it.why_share && <p className="text-xs text-zinc-500 mb-2">💬 {it.why_share}</p>}
            {it.source_url && <a href={it.source_url} target="_blank" className="text-xs text-brand hover:underline">📺 {it.source_title || it.source_type} ↗</a>}

            <div className="flex gap-2 mt-3">
              <button onClick={() => setStatus(it.id, it.status === 'saved' ? 'new' : 'saved')} disabled={busy === `s${it.id}`}
                className="px-2 py-1 text-xs rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-50">{it.status === 'saved' ? '已存' : '💡 存'}</button>
              <button onClick={() => setStatus(it.id, 'hidden')} disabled={busy === `s${it.id}`}
                className="px-2 py-1 text-xs rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-50">🗑 藏</button>
              <button onClick={() => setDraftOpen((p) => ({ ...p, [it.id]: !p[it.id] }))}
                className="px-2 py-1 text-xs rounded-lg bg-brand/15 text-brand hover:bg-brand/25">✍️ 改寫</button>
            </div>

            {draftOpen[it.id] && (
              <div className="mt-3 border-t border-zinc-800 pt-3">
                <textarea value={draftNote[it.id] || ''} onChange={(e) => setDraftNote((p) => ({ ...p, [it.id]: e.target.value }))}
                  placeholder="加入你的經驗/角度（貼文的靈魂）" rows={2}
                  className="w-full px-3 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-100 mb-2" />
                <button onClick={() => generate(it.id)} disabled={genBusy === it.id}
                  className="px-3 py-1.5 text-sm rounded-lg bg-brand/15 text-brand hover:bg-brand/25 disabled:opacity-50">
                  {genBusy === it.id ? '產生中…' : 'AI 改寫一篇 Threads 貼文 →'}
                </button>
                {draftText[it.id] && (
                  <div className="mt-2">
                    <p className="text-sm text-zinc-200 whitespace-pre-wrap bg-zinc-800/50 rounded-lg p-3">{draftText[it.id]}</p>
                    <button onClick={() => navigator.clipboard.writeText(draftText[it.id])}
                      className="mt-2 px-2 py-1 text-xs rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700">複製</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
    </div>
  );
}
