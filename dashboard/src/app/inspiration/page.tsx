'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Insight {
  id: number; source_id: number; hook: string; idea: string; why_share: string | null; category: string | null;
  resonance: number | null; status: string; origin: string; source_ts: string | null;
  source_title: string | null; source_url: string | null; source_type: string; published_at: string | null;
  channel_title: string | null; channel_handle: string | null;
}

/** Format a source publish date as `YYYY/MM/DD` plus a relative hint (e.g. 「3 天前」). */
function formatPublished(iso: string | null): { date: string; rel: string } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const date = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  const rel = days <= 0 ? '今天' : days === 1 ? '昨天' : days < 30 ? `${days} 天前`
    : days < 365 ? `${Math.floor(days / 30)} 個月前` : `${Math.floor(days / 365)} 年前`;
  return { date, rel };
}

export default function InspirationPage() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'visible' | 'saved'>('visible');
  const [sort, setSort] = useState<'resonance' | 'newest' | 'published' | 'random'>('resonance');
  const [q, setQ] = useState('');
  const [channel, setChannel] = useState('');
  const [channels, setChannels] = useState<{ id: number; title: string | null; handle: string | null }[]>([]);
  const [theme, setTheme] = useState('');
  const [themes, setThemes] = useState<{ id: number; name: string; insight_count: number }[]>([]);
  const [ingestUrl, setIngestUrl] = useState('');
  const [ingestPoints, setIngestPoints] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState<Record<number, boolean>>({});
  const [draftNote, setDraftNote] = useState<Record<number, string>>({});
  const [draftText, setDraftText] = useState<Record<number, string>>({});
  const [draftStories, setDraftStories] = useState<Record<number, boolean>>({});
  const [draftViral, setDraftViral] = useState<Record<number, boolean>>({});
  const [genBusy, setGenBusy] = useState<number | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const buildParams = useCallback((cur: string | null) => {
    const params = new URLSearchParams({ status: statusFilter, sort });
    if (q.trim()) params.set('q', q.trim());
    if (channel) params.set('channel', channel);
    if (theme) params.set('theme', theme);
    if (cur) params.set('cursor', cur);
    return params;
  }, [statusFilter, sort, q, channel, theme]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/inspiration/insights?${buildParams(null)}`);
    const data = await res.json();
    setInsights(data.insights || []);
    setCursor(data.nextCursor || null);
    setHasMore(!!data.nextCursor);
    setLoading(false);
  }, [buildParams]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || !cursor) return;
    setLoadingMore(true);
    const res = await fetch(`/api/inspiration/insights?${buildParams(cursor)}`);
    const data = await res.json();
    setInsights((prev) => [...prev, ...(data.insights || [])]);
    setCursor(data.nextCursor || null);
    setHasMore(!!data.nextCursor);
    setLoadingMore(false);
  }, [hasMore, loadingMore, cursor, buildParams]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch('/api/inspiration/channels').then((r) => r.json()).then((d) => setChannels(d.channels || [])).catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/inspiration/themes').then((r) => r.json()).then((d) => setThemes(d.themes || [])).catch(() => {});
  }, []);

  // Shuffle: switch to random (triggers a reload), or re-fetch a fresh random set if already random.
  const shuffle = () => { if (sort !== 'random') setSort('random'); else load(); };

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
      body: JSON.stringify({ userNote: draftNote[id] || '', useStories: !!draftStories[id], viral: !!draftViral[id] }),
    });
    const data = await res.json();
    if (!res.ok || !data.draft_text) {
      // Don't render an error as if it were a draft (it would get copy + post buttons).
      alert(data.error || '產生失敗');
      setGenBusy(null);
      return;
    }
    setDraftText((p) => ({ ...p, [id]: data.draft_text }));
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
        <select value={theme} onChange={(e) => setTheme(e.target.value)}
          className="px-2 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-100">
          <option value="">全部主題</option>
          {themes.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.insight_count})</option>)}
        </select>
        <select value={channel} onChange={(e) => setChannel(e.target.value)}
          className="px-2 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-100">
          <option value="">全部頻道</option>
          {channels.map((c) => <option key={c.id} value={c.id}>{c.title || c.handle}</option>)}
        </select>
        <button onClick={() => setStatusFilter(statusFilter === 'saved' ? 'visible' : 'saved')}
          className={`px-3 py-1.5 text-sm rounded-lg ${statusFilter === 'saved' ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'}`}>
          {statusFilter === 'saved' ? '⭐ 收藏中' : '☆ 只看收藏'}
        </button>
        <select value={sort} onChange={(e) => setSort(e.target.value as 'resonance' | 'newest' | 'published' | 'random')}
          className="px-2 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-100">
          <option value="resonance">共鳴排序</option><option value="published">最新發布</option><option value="newest">最近攝取</option><option value="random">隨機</option>
        </select>
        <button onClick={shuffle}
          className="px-3 py-1.5 text-sm rounded-lg bg-brand/15 text-brand hover:bg-brand/25">🎲 給我靈感</button>
      </div>

      {loading ? <p className="text-zinc-400">載入中…</p>
        : insights.length === 0 ? <p className="text-zinc-400">還沒有靈感，貼個連結開始吧。</p>
        : insights.map((it) => (
          <div key={it.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 mb-3 transition-colors">
            <div className="flex items-center gap-2 mb-2">
              {it.resonance != null && <span className="shrink-0 text-[11px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">🔥 共鳴 {it.resonance}</span>}
              {it.category && <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/50 text-zinc-300">{it.category}</span>}
              {it.channel_title && <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-brand/10 text-brand truncate max-w-[40%]">{it.channel_title}</span>}
              {formatPublished(it.published_at) && (
                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/40 text-zinc-400" title={`發布於 ${formatPublished(it.published_at)!.date}`}>
                  📅 {formatPublished(it.published_at)!.date} · {formatPublished(it.published_at)!.rel}
                </span>
              )}
            </div>
            <p className="text-base font-semibold text-zinc-100 mb-1">{it.hook}</p>
            <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap mb-1">{it.idea}</p>
            {it.why_share && <p className="text-xs text-zinc-500 mb-2">💬 {it.why_share}</p>}
            <div className="flex gap-3">
              {it.source_url && <a href={it.source_url} target="_blank" className="text-xs text-brand hover:underline">📺 {it.source_title || it.source_type} ↗</a>}
              <a href={`/inspiration/source/${it.source_id}`} className="text-xs text-brand hover:underline">📄 講稿</a>
            </div>

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
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2">
                  <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
                    <input type="checkbox" checked={!!draftStories[it.id]} onChange={(e) => setDraftStories((p) => ({ ...p, [it.id]: e.target.checked }))} className="accent-[var(--brand,#e0a96d)]" />
                    帶入個人故事
                  </label>
                  <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                    <input type="checkbox" checked={!!draftViral[it.id]} onChange={(e) => setDraftViral((p) => ({ ...p, [it.id]: e.target.checked }))} className="accent-[var(--brand,#e0a96d)]" />
                    <span className={draftViral[it.id] ? 'text-brand' : 'text-zinc-400'}>🔥 爆文模式</span>
                  </label>
                </div>
                <button onClick={() => generate(it.id)} disabled={genBusy === it.id}
                  className="px-3 py-1.5 text-sm rounded-lg bg-brand/15 text-brand hover:bg-brand/25 disabled:opacity-50">
                  {genBusy === it.id ? '產生中…' : '✍️ 用我的口吻寫一篇 →'}
                </button>
                {draftText[it.id] && (
                  <div className="mt-2">
                    <p className="text-sm text-zinc-200 whitespace-pre-wrap bg-zinc-800/50 rounded-lg p-3">{draftText[it.id]}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <button onClick={() => navigator.clipboard.writeText(draftText[it.id])}
                        className="px-2 py-1 text-xs rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700">複製</button>
                      <a href={`https://www.threads.net/intent/post?text=${encodeURIComponent(draftText[it.id])}`}
                        target="_blank" rel="noreferrer"
                        className="px-2 py-1 text-xs rounded-lg bg-brand/90 hover:bg-brand text-white">去 Threads 發文 →</a>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {!loading && hasMore && sort !== 'random' && !q.trim() && (
          <IntersectionLoader onVisible={loadMore} busy={loadingMore} />
        )}
        {!loading && !hasMore && insights.length > 0 && <p className="text-center text-xs text-zinc-600 py-4">沒有更多了</p>}
    </div>
  );
}

function IntersectionLoader({ onVisible, busy }: { onVisible: () => void; busy: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => { if (entries[0].isIntersecting) onVisible(); }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [onVisible]);
  return <div ref={ref} className="py-4 text-center text-xs text-zinc-600">{busy ? '載入中…' : ''}</div>;
}
