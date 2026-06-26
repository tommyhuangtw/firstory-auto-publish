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
  interested?: number;
  interest_score?: number | null;
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
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [likedCount, setLikedCount] = useState(0);
  const [dislikedCount, setDislikedCount] = useState(0);
  const [profileSize, setProfileSize] = useState(0);
  const [filtered, setFiltered] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showDisliked, setShowDisliked] = useState(false);
  const [sortMode, setSortMode] = useState<'interest' | 'newest' | 'heat'>('interest');
  const [tab, setTab] = useState<'hot' | 'reply'>('hot');

  const load = useCallback(async () => {
    setLoading(true);
    // Default = hard filter (only posts matching your taste). showAll lifts it. Always ≤2 days.
    const params = new URLSearchParams({ days: '2', limit: '80', sort: sortMode });
    if (showAll) params.set('all', '1');
    if (showDisliked) params.set('includeDisliked', '1');
    const res = await fetch(`/api/trends/posts?${params}`);
    const data = await res.json();
    setPosts(data.posts || []);
    setLikedCount(data.likedCount ?? 0);
    setDislikedCount(data.dislikedCount ?? 0);
    setProfileSize(data.profileSize ?? 0);
    setFiltered(!!data.filtered);
    setLoading(false);
  }, [showAll, showDisliked, sortMode]);
  useEffect(() => { void load(); }, [load]);

  // Sensible default sort per mode: taste view → 符合度, 看全部 → 最新 (still overridable).
  const toggleShowAll = () => {
    setShowAll((v) => { const next = !v; setSortMode(next ? 'newest' : 'interest'); return next; });
  };

  // target: 1 = 👍 想留, -1 = 👎 不要. Clicking the active one clears it (0).
  const toggleInterest = async (postId: number, target: 1 | -1) => {
    const current = posts.find((p) => p.id === postId)?.interested ?? 0;
    const next = current === target ? 0 : target;
    // optimistic: update the mark; hide a freshly 👎'd post unless we're showing excluded ones
    setPosts((ps) => {
      const updated = ps.map((p) => (p.id === postId ? { ...p, interested: next } : p));
      return next === -1 && !showDisliked ? updated.filter((p) => p.id !== postId) : updated;
    });
    const res = await fetch(`/api/trends/posts/${postId}/interested`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: next }),
    });
    const data = await res.json();
    if (typeof data.likedCount === 'number') setLikedCount(data.likedCount);
    if (typeof data.dislikedCount === 'number') setDislikedCount(data.dislikedCount);
  };

  const backfillEmbeddings = async () => {
    setBusy('embed');
    const res = await fetch('/api/trends/posts/embed-missing', { method: 'POST' });
    const data = await res.json();
    setBusy(null);
    alert(data.error ? `失敗：${data.error}` : `已補 embedding ${data.embedded} 篇（剩 ${data.remaining}）`);
    void load();
  };

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
          <a href="/trends/scans" className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700">📋 掃描紀錄</a>
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

      {/* Tabs: 熱點(寫新貼文) vs 回覆專區(回別人的 niche 貼文) */}
      <div className="flex gap-1 mb-4 border-b border-zinc-800">
        <button onClick={() => setTab('hot')} className={`px-3 py-2 text-sm -mb-px border-b-2 transition-colors ${tab === 'hot' ? 'border-brand text-brand' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}>🔥 熱點</button>
        <button onClick={() => setTab('reply')} className={`px-3 py-2 text-sm -mb-px border-b-2 transition-colors ${tab === 'reply' ? 'border-brand text-brand' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}>💬 回覆專區</button>
      </div>

      {tab === 'reply' ? <ReplyZone /> : (<>
      <p className="text-xs text-zinc-500 mb-3">
        爬 Threads「為你推薦」+ 你的同溫層話題的近期熱點。按 👍 標「想留」、👎 標「不要」，系統會學你的口味、把語意類似的貼文排前面、把你不要的壓下去（累積到 15 篇 👍 後自動切換）。每則可直接點去回覆，或按「✍️ 讓 AI 寫成貼文」生成草稿。
      </p>

      <div className="flex items-center gap-3 mb-5 text-xs flex-wrap">
        <span className="text-zinc-400">口味檔案 <span className="text-emerald-400 font-semibold">👍{likedCount}</span> <span className="text-rose-400 font-semibold">👎{dislikedCount}</span>{filtered ? ' ·已依口味過濾' : profileSize === 0 ? ' ·尚無，先去標註' : ''}</span>
        {profileSize > 0 && (
          <button onClick={toggleShowAll}
            className={`px-2.5 py-1 rounded-lg ${showAll ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>
            {showAll ? '✓ 看全部（含不符合）' : '看全部'}
          </button>
        )}
        <span className="inline-flex items-center rounded-lg bg-zinc-800/60 p-0.5">
          <span className="text-zinc-500 px-1.5">排序</span>
          {([['interest', '符合度'], ['newest', '最新'], ['heat', '熱度']] as const).map(([m, label]) => (
            <button key={m} onClick={() => setSortMode(m)}
              disabled={m === 'interest' && profileSize === 0}
              className={`px-2 py-1 rounded-md ${sortMode === m ? 'bg-brand/20 text-brand' : 'text-zinc-400 hover:text-zinc-200'} disabled:opacity-30`}>
              {label}
            </button>
          ))}
        </span>
        {dislikedCount > 0 && (
          <button onClick={() => setShowDisliked((v) => !v)}
            className={`px-2.5 py-1 rounded-lg ${showDisliked ? 'bg-rose-500/20 text-rose-400' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>
            {showDisliked ? '✓ 顯示不要的' : `顯示不要的 (${dislikedCount})`}
          </button>
        )}
        <button onClick={backfillEmbeddings} disabled={busy === 'embed'}
          className="px-2.5 py-1 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 disabled:opacity-50" title="把舊貼文補上向量，才能算口味相似度">
          {busy === 'embed' ? '補向量中…' : '補 embedding'}
        </button>
      </div>

      {loading ? (
        <p className="text-zinc-500 text-sm">載入中…</p>
      ) : posts.length === 0 ? (
        <p className="text-zinc-500 text-sm">{filtered ? '近期沒有符合你口味的貼文。按「看全部」看未過濾的，或「立即掃描」抓新的一批。' : '還沒有貼文。按「立即掃描」抓一批近期高熱度貼文。'}</p>
      ) : (
        <div className="space-y-3">
          {posts.map((p) => (
            <div key={p.id}
              onMouseEnter={() => setHoverId(p.id)} onMouseLeave={() => setHoverId(null)}
              className={`rounded-xl border bg-zinc-900/40 p-4 transition-colors ${hoverId === p.id ? 'border-orange-500/40 bg-zinc-900/70' : 'border-zinc-800'}`}>
              <div className="flex items-center gap-2 mb-2 min-w-0">
                {p.author && <span className="font-semibold text-zinc-100 truncate">@{p.author}</span>}
                {p.relevant ? <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">AI/科技</span> : null}
                {typeof p.interest_score === 'number' && <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300" title="跟你 👍 的貼文相似、扣掉跟 👎 的相似後的口味分數">符合 {Math.max(0, Math.round(p.interest_score * 100))}%</span>}
                {p.source && <span className="shrink-0 text-xs text-zinc-500">{p.source}</span>}
                {p.posted_at && <span className="shrink-0 ml-auto text-xs text-zinc-500">{new Date(p.posted_at).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
              </div>
              <p className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap"
                style={hoverId === p.id ? undefined : { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {p.text}
              </p>
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
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={() => toggleInterest(p.id, -1)} title="不想看到這類，往後壓低"
                    className={`text-xs px-3 py-1.5 rounded-lg ${p.interested === -1 ? 'bg-rose-500/20 text-rose-400' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>
                    {p.interested === -1 ? '👎 已排除' : '👎 不要'}
                  </button>
                  <button onClick={() => toggleInterest(p.id, 1)} title="想多看這類，往前排"
                    className={`text-xs px-3 py-1.5 rounded-lg ${p.interested === 1 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}>
                    {p.interested === 1 ? '👍 已留' : '👍 想留'}
                  </button>
                </div>
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
      </>)}
    </div>
  );
}

interface NichePost {
  id: number;
  author?: string;
  text: string;
  like_count: number;
  reply_count: number;
  permalink?: string;
  posted_at?: string;
  topic?: string;
  reply_draft?: string | null;
}

/** 💬 回覆專區 — niche posts (讚≥30, 近2天) to reply to, with AI-generated reply drafts. */
function ReplyZone() {
  const [posts, setPosts] = useState<NichePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [genBusy, setGenBusy] = useState<number | null>(null);
  const [replies, setReplies] = useState<Record<number, string>>({});
  const [copied, setCopied] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetch('/api/trends/niche').then(r => r.json()).catch(() => ({ posts: [] }));
    const list: NichePost[] = d.posts || [];
    setPosts(list);
    const seed: Record<number, string> = {};
    for (const p of list) if (p.reply_draft) seed[p.id] = p.reply_draft;
    setReplies(seed);
    setLoading(false);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const genReply = async (id: number) => {
    setGenBusy(id);
    try {
      const res = await fetch('/api/trends/reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok || !data.reply_draft) { alert(data.error || '生成失敗'); return; }
      setReplies((p) => ({ ...p, [id]: data.reply_draft }));
    } finally {
      setGenBusy(null);
    }
  };

  if (loading) return <p className="text-sm text-zinc-500">Loading…</p>;
  if (posts.length === 0) {
    return <p className="text-sm text-zinc-500">尚無 niche 貼文。按右上「立即掃描」爬一輪(會搜 AI 工具/接案/創業/AI 學習等關鍵詞,留讚≥30、近 2 天的)。</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500 mb-1">你的 niche(AI 工具/接案/創業/AI 學習)近 2 天、讚 ≥ 30 的貼文。生成一則你的口吻回覆 → 複製 → 點原文去貼。主動回覆是被陌生人看到、建立信任的關鍵。</p>
      {posts.map((p) => (
        <div key={p.id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500 mb-1">
            {p.author && <span className="text-zinc-300">@{p.author}</span>}
            <span>❤️ {p.like_count}</span><span>💬 {p.reply_count}</span>
            {p.topic && <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{p.topic}</span>}
            <span>{(p.posted_at || '').slice(0, 10)}</span>
          </div>
          <p className="text-sm text-zinc-200 whitespace-pre-wrap line-clamp-5">{p.text}</p>
          <div className="flex items-center gap-2 mt-2">
            <button onClick={() => genReply(p.id)} disabled={genBusy === p.id}
              className="px-2.5 py-1 text-xs rounded-lg bg-brand/15 text-brand hover:bg-brand/25 disabled:opacity-50">
              {genBusy === p.id ? '生成中…' : (replies[p.id] ? '↻ 重新生成回覆' : '✍️ 生成回覆')}
            </button>
            {p.permalink && (
              <a href={p.permalink} target="_blank" rel="noreferrer" className="px-2.5 py-1 text-xs rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700">去看原文 →</a>
            )}
          </div>
          {replies[p.id] && (
            <div className="mt-2 rounded-lg bg-zinc-950 border border-zinc-800 p-3">
              <p className="text-sm text-zinc-200 whitespace-pre-wrap">{replies[p.id]}</p>
              <button onClick={() => { navigator.clipboard.writeText(replies[p.id]); setCopied(p.id); setTimeout(() => setCopied(null), 1500); }}
                className="mt-2 px-2 py-1 text-xs rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700">
                {copied === p.id ? '已複製 ✓' : '複製回覆'}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
