'use client';

import { useCallback, useEffect, useState } from 'react';

interface Channel {
  id: number; handle: string | null; title: string | null; thumbnail_url: string | null;
  active: number; fetch_count: number; last_crawled_at: string | null; ingested_count: number; insight_count: number;
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/inspiration/channels');
    const data = await res.json();
    setChannels(data.channels || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!url.trim()) return;
    setBusy('add');
    const res = await fetch('/api/inspiration/channels', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim() }),
    });
    const data = await res.json();
    setBusy(null);
    if (data.error) alert(data.error); else { setUrl(''); load(); }
  };

  const crawl = async (id: number) => {
    setBusy(`c${id}`);
    await fetch(`/api/inspiration/channels/${id}/crawl`, { method: 'POST' });
    setBusy(null);
    alert('開始抓取（背景執行）。完成後重新整理看 insight 數變化。');
  };

  const crawlAll = async () => {
    setBusy('all');
    await fetch('/api/inspiration/channels/crawl-all', { method: 'POST' });
    setBusy(null);
    alert('開始抓取全部頻道（背景執行）。');
  };

  const toggle = async (c: Channel) => {
    await fetch(`/api/inspiration/channels/${c.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !c.active }),
    });
    load();
  };

  const remove = async (id: number) => {
    if (!confirm('移除這個頻道？（已抓的 insight 會保留）')) return;
    await fetch(`/api/inspiration/channels/${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-brand">頻道來源</h1>
        <div className="flex gap-2">
          <a href="/inspiration" className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700">← 靈感庫</a>
          <button onClick={crawlAll} disabled={busy === 'all'}
            className="px-3 py-1.5 text-sm rounded-lg bg-brand/15 text-brand hover:bg-brand/25 disabled:opacity-50">
            {busy === 'all' ? '抓取中…' : '全部抓取'}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 mb-6 flex gap-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="貼上 YouTube 頻道網址（如 https://www.youtube.com/@LennysPodcast）"
          className="flex-1 px-3 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-100" />
        <button onClick={add} disabled={busy === 'add' || !url.trim()}
          className="px-3 py-1.5 text-sm rounded-lg bg-brand/15 text-brand hover:bg-brand/25 disabled:opacity-50">
          {busy === 'add' ? '加入中…' : '+ 加入頻道'}
        </button>
      </div>

      {loading ? <p className="text-zinc-400">載入中…</p>
        : channels.length === 0 ? <p className="text-zinc-400">還沒有頻道。貼一個 YouTube 頻道網址開始。</p>
        : channels.map((c) => (
          <div key={c.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 mb-3 flex items-center gap-3">
            {c.thumbnail_url && <img src={c.thumbnail_url} alt="" className="w-10 h-10 rounded-full" />}
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-zinc-100 truncate">{c.title || c.handle}</p>
              <p className="text-xs text-zinc-500">{c.handle} · {c.ingested_count} 部影片 · <span className="text-brand">{c.insight_count} 條 insight</span> · 每次抓 {c.fetch_count} · {c.last_crawled_at ? `上次 ${c.last_crawled_at.slice(0, 16)}` : '尚未抓取'}</p>
            </div>
            <button onClick={() => crawl(c.id)} disabled={busy === `c${c.id}`}
              className="px-2 py-1 text-xs rounded-lg bg-brand/15 text-brand hover:bg-brand/25 disabled:opacity-50">{busy === `c${c.id}` ? '…' : '立即抓取'}</button>
            <button onClick={() => toggle(c)}
              className={`px-2 py-1 text-xs rounded-lg ${c.active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-400'} hover:opacity-80`}>{c.active ? '啟用中' : '已停用'}</button>
            <button onClick={() => remove(c.id)} className="px-2 py-1 text-xs rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700">移除</button>
          </div>
        ))}
    </div>
  );
}
