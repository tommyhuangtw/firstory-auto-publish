'use client';

import { useState, useEffect, useCallback } from 'react';

interface HotPost {
  id: number;
  source?: string;
  author?: string;
  text: string;
  like_count: number;
  reply_count: number;
  velocity?: number;
  posted_at?: string;
  permalink?: string;
  relevant?: number;
}

export default function TrendsPage() {
  const [posts, setPosts] = useState<HotPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState<Record<number, boolean>>({});
  const [opinion, setOpinion] = useState<Record<number, string>>({});
  const [genBusy, setGenBusy] = useState<number | null>(null);
  const [genResult, setGenResult] = useState<Record<number, { topic: string; text: string }>>({});
  const [copied, setCopied] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/trends/posts?days=2&limit=80');
    const data = await res.json();
    setPosts(data.posts || []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const scan = async () => {
    setBusy('scan');
    await fetch('/api/trends/scan', { method: 'POST' });
    setBusy(null);
    alert('社群熱點掃描已在背景啟動（約 3-5 分鐘）。爬完後按右上「重新整理」就看得到。');
  };

  const pushTelegram = async () => {
    setBusy('tg');
    const res = await fetch('/api/trends/digest', { method: 'POST' });
    const data = await res.json();
    setBusy(null);
    alert(data.error ? `失敗：${data.error}` : (data.sent ? '已推播熱點到 Telegram' : '目前沒有近期熱點可推'));
  };

  const openSession = async () => {
    setBusy('session');
    const res = await fetch('/api/trends/open-session', { method: 'POST' });
    const data = await res.json();
    setBusy(null);
    alert(data.error ? `失敗：${data.error}` : (data.message || '已開啟爬蟲 Chrome 視窗'));
  };

  const generateDraft = async (postId: number) => {
    setGenBusy(postId);
    const res = await fetch('/api/trends/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId, opinion: opinion[postId] || '' }),
    });
    const data = await res.json();
    setGenBusy(null);
    if (data.error) { alert(`生成失敗：${data.error}`); return; }
    setGenResult((p) => ({ ...p, [postId]: { topic: data.topic, text: data.draft_text } }));
  };

  const copyText = async (postId: number, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(postId);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h1 className="text-xl font-bold text-brand">社群熱點</h1>
        <div className="flex gap-2 flex-wrap">
          <button onClick={scan} disabled={busy === 'scan'}
            className="px-3 py-1.5 text-sm rounded-lg bg-brand/15 text-brand hover:bg-brand/25 disabled:opacity-50">
            {busy === 'scan' ? '掃描中…' : '立即掃描'}
          </button>
          <button onClick={() => load()} className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700">重新整理</button>
          <button onClick={pushTelegram} disabled={busy === 'tg'}
            className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-50">
            {busy === 'tg' ? '推播中…' : '推 Telegram'}
          </button>
          <button onClick={openSession} disabled={busy === 'session'} title="開啟爬蟲帳號的 Chrome，自己滑來訓練演算法"
            className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-50">
            {busy === 'session' ? '開啟中…' : '🌐 開爬蟲 Chrome'}
          </button>
        </div>
      </div>
      <p className="text-xs text-zinc-500 mb-5">
        爬 Threads「為你推薦」+ 你的同溫層話題的近期熱點（AI 優先）。每則可直接點去回覆衝流量；覺得有發揮空間的，按「✍️ 讓 AI 寫成貼文」（可選填你的看法）就用你的風格生成草稿、當場複製。
      </p>

      {loading ? (
        <p className="text-zinc-500 text-sm">載入中…</p>
      ) : posts.length === 0 ? (
        <p className="text-zinc-500 text-sm">還沒有貼文。按「立即掃描」抓一批近期高熱度貼文。</p>
      ) : (
        <div className="space-y-3">
          {posts.map((p) => (
            <div key={p.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="flex items-center gap-2 mb-2 min-w-0">
                {p.author && <span className="font-semibold text-zinc-100 truncate">@{p.author}</span>}
                {p.relevant ? <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">AI/科技</span> : null}
                {p.source && <span className="shrink-0 text-xs text-zinc-500">{p.source}</span>}
                {p.posted_at && <span className="shrink-0 ml-auto text-xs text-zinc-500">{new Date(p.posted_at).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
              </div>
              <p className="text-sm text-zinc-200 leading-relaxed line-clamp-3 hover:line-clamp-none transition-all" title="hover 看全文">{p.text}</p>
              <div className="flex items-center gap-4 mt-3">
                <span className="flex items-center gap-1.5 text-rose-400 text-sm font-semibold tabular-nums">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-10-9.3C.5 8.5 2 5 5.5 5 7.7 5 9 6.3 12 9c3-2.7 4.3-4 6.5-4C22 5 23.5 8.5 22 11.7 19.5 16.4 12 21 12 21z" /></svg>
                  {(p.like_count ?? 0).toLocaleString()}
                </span>
                <span className="flex items-center gap-1.5 text-sky-400 text-sm font-semibold tabular-nums">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" /></svg>
                  {(p.reply_count ?? 0).toLocaleString()}
                </span>
                <span className="flex items-center gap-1 text-orange-400/90 text-xs tabular-nums">🔥 {Math.round(p.velocity ?? 0)}/hr</span>
              </div>
              <div className="flex items-center gap-2 mt-3">
                {p.permalink && (
                  <a href={p.permalink} target="_blank" rel="noopener noreferrer"
                    className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700">↗ 去 Threads 回覆</a>
                )}
                <button onClick={() => setFormOpen((s) => ({ ...s, [p.id]: !s[p.id] }))}
                  className="text-xs px-3 py-1.5 rounded-lg bg-brand/15 text-brand hover:bg-brand/25">✍️ 讓 AI 寫成貼文</button>
              </div>

              {formOpen[p.id] && (
                <div className="mt-3 border-t border-zinc-800 pt-3">
                  <textarea value={opinion[p.id] || ''} onChange={(e) => setOpinion((s) => ({ ...s, [p.id]: e.target.value }))}
                    rows={2} placeholder="（選填）你對這則的看法 — AI 會以你的觀點、用你的風格寫。留空就讓 AI 自由發揮。"
                    className="w-full text-sm rounded-lg bg-zinc-950 border border-zinc-800 p-2.5 text-zinc-200 resize-y focus:outline-none focus:border-brand/50" />
                  <div className="flex items-center gap-3 mt-2">
                    <button onClick={() => generateDraft(p.id)} disabled={genBusy === p.id}
                      className="text-xs px-3 py-1.5 rounded-lg bg-brand/20 text-brand hover:bg-brand/30 disabled:opacity-50">
                      {genBusy === p.id ? '生成中…' : (genResult[p.id] ? '重新生成' : '生成草稿')}
                    </button>
                    {genResult[p.id] && (
                      <button onClick={() => copyText(p.id, genResult[p.id].text)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-brand/15 text-brand hover:bg-brand/25">
                        {copied === p.id ? '已複製 ✓' : '複製草稿'}
                      </button>
                    )}
                  </div>
                  {genResult[p.id] && (
                    <div className="mt-2 rounded-lg bg-zinc-950 border border-zinc-800 p-3">
                      <div className="text-xs text-zinc-500 mb-1">主題：{genResult[p.id].topic}　（{genResult[p.id].text.length} 字{genResult[p.id].text.length > 500 ? '，超過 Threads 500 上限' : ''}）</div>
                      <p className="text-sm text-zinc-200 whitespace-pre-wrap">{genResult[p.id].text}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
