'use client';

import { useCallback, useEffect, useState } from 'react';

interface Channel {
  id: number; handle: string | null; title: string | null; thumbnail_url: string | null;
  active: number; fetch_count: number; last_crawled_at: string | null; ingested_count: number; insight_count: number;
}

interface CrawlConfig { enabled: boolean; time: string | null; cron: string }

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [crawlCfg, setCrawlCfg] = useState<CrawlConfig | null>(null);
  const [timeInput, setTimeInput] = useState('07:00');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/inspiration/channels');
    const data = await res.json();
    setChannels(data.channels || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch('/api/inspiration/crawl-config').then((r) => r.json()).then((d: CrawlConfig) => {
      setCrawlCfg(d); if (d.time) setTimeInput(d.time);
    }).catch(() => {});
  }, []);

  const saveCrawlCfg = async (patch: { enabled?: boolean; time?: string }) => {
    setBusy('cfg');
    const res = await fetch('/api/inspiration/crawl-config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    });
    const data = await res.json();
    setBusy(null);
    if (data.error) { alert(data.error); return; }
    setCrawlCfg(data); if (data.time) setTimeInput(data.time);
  };

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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
        <h1 className="text-xl font-bold text-brand">頻道來源</h1>
        <div className="flex gap-2">
          <a href="/inspiration" className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700">← 靈感庫</a>
          <button onClick={crawlAll} disabled={busy === 'all'} title="抓取所有「啟用中」頻道的最新影片"
            className="px-3 py-1.5 text-sm rounded-lg bg-brand/15 text-brand hover:bg-brand/25 disabled:opacity-50">
            {busy === 'all' ? '抓取中…' : '全部抓取'}
          </button>
        </div>
      </div>

      {crawlCfg && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 mb-4 flex flex-wrap items-center gap-3">
          <button onClick={() => saveCrawlCfg({ enabled: !crawlCfg.enabled })} disabled={busy === 'cfg'}
            title="開啟後，系統每天自動抓取所有「啟用中」頻道的新片並擷取 insight"
            className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${crawlCfg.enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-400'} hover:opacity-80`}>
            {crawlCfg.enabled ? '🟢 自動每日抓取：開' : '⚪️ 自動每日抓取：關'}
          </button>
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <span>每天</span>
            <input type="time" value={timeInput} onChange={(e) => setTimeInput(e.target.value)}
              disabled={!crawlCfg.enabled}
              className="px-2 py-1.5 rounded-lg bg-zinc-800 text-zinc-100 disabled:opacity-50" />
            <button onClick={() => saveCrawlCfg({ time: timeInput })} disabled={busy === 'cfg' || !crawlCfg.enabled || timeInput === crawlCfg.time}
              className="px-2 py-1 text-xs rounded-lg bg-brand/15 text-brand hover:bg-brand/25 disabled:opacity-40">儲存時間</button>
          </div>
          <span className="text-xs text-zinc-600">只抓「啟用中」頻道的新片，去重後不重複擷取</span>
        </div>
      )}

      <p className="text-xs text-zinc-500 mb-4 leading-relaxed">
        <span className="text-zinc-300">立即抓取</span>：抓該頻道<b>最新</b> N 部影片，已抓過的自動跳過、只補新片（背景執行）。
        <span className="text-zinc-300">全部抓取</span>：一次抓所有「啟用中」頻道。
        <span className="text-zinc-300">啟用中／已停用</span>：是否納入「全部抓取」（停用不影響單獨的立即抓取，已抓資料都保留）。
      </p>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 mb-6 flex gap-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="貼上 YouTube 頻道網址（如 https://www.youtube.com/@LennysPodcast）"
          className="min-w-0 flex-1 px-3 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-100" />
        <button onClick={add} disabled={busy === 'add' || !url.trim()}
          className="px-3 py-1.5 text-sm rounded-lg bg-brand/15 text-brand hover:bg-brand/25 disabled:opacity-50">
          {busy === 'add' ? '加入中…' : '+ 加入頻道'}
        </button>
      </div>

      {loading ? <p className="text-zinc-400">載入中…</p>
        : channels.length === 0 ? <p className="text-zinc-400">還沒有頻道。貼一個 YouTube 頻道網址開始。</p>
        : channels.map((c) => (
          <div key={c.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 mb-3 flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {c.thumbnail_url && <img src={c.thumbnail_url} alt="" className="w-10 h-10 rounded-full shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-zinc-100 truncate">{c.title || c.handle}</p>
                <p className="text-xs text-zinc-500">{c.handle} · {c.ingested_count} 部影片 · <span className="text-brand">{c.insight_count} 條 insight</span> · 每次抓 {c.fetch_count} · {c.last_crawled_at ? `上次 ${c.last_crawled_at.slice(0, 16)}` : '尚未抓取'}</p>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => crawl(c.id)} disabled={busy === `c${c.id}`} title={`抓這個頻道最新 ${c.fetch_count} 部，去重後只補新片（背景執行）`}
                className="px-3 py-2 text-xs md:px-2 md:py-1 rounded-lg bg-brand/15 text-brand hover:bg-brand/25 disabled:opacity-50">{busy === `c${c.id}` ? '…' : '立即抓取'}</button>
              <button onClick={() => toggle(c)} title={c.active ? '啟用中：會被「全部抓取」掃到。點一下改為停用' : '已停用：「全部抓取」會跳過它。點一下改為啟用'}
                className={`px-3 py-2 text-xs md:px-2 md:py-1 rounded-lg ${c.active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-400'} hover:opacity-80`}>{c.active ? '啟用中' : '已停用'}</button>
              <button onClick={() => remove(c.id)} className="px-3 py-2 text-xs md:px-2 md:py-1 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700">移除</button>
            </div>
          </div>
        ))}
    </div>
  );
}
