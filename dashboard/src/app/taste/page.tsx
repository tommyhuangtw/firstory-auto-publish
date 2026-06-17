'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface QPost {
  id: number;
  author?: string;
  text: string;
  like_count: number;
  reply_count: number;
  posted_at?: string;
  permalink?: string;
  relevant?: number;
  interest_score?: number | null;
}

export default function LabelPage() {
  const [queue, setQueue] = useState<QPost[]>([]);
  const [idx, setIdx] = useState(0);
  const [likedCount, setLikedCount] = useState(0);
  const [dislikedCount, setDislikedCount] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [unembedded, setUnembedded] = useState(0);
  const [totalSeed, setTotalSeed] = useState<number | null>(null);
  const [mode, setMode] = useState<'engagement' | 'active'>('engagement');
  const [loading, setLoading] = useState(true);
  const [prep, setPrep] = useState<string | null>(null);
  const skipped = useRef<number[]>([]);

  const fetchBatch = useCallback(async () => {
    setLoading(true);
    const ex = skipped.current.slice(-200).join(',');
    const res = await fetch(`/api/trends/label-queue?limit=25${ex ? `&exclude=${ex}` : ''}`);
    const d = await res.json();
    setQueue(d.queue || []);
    setIdx(0);
    setLikedCount(d.likedCount ?? 0);
    setDislikedCount(d.dislikedCount ?? 0);
    setRemaining(d.remaining ?? 0);
    setUnembedded(d.unembedded ?? 0);
    setMode(d.mode || 'engagement');
    setLoading(false);
  }, []);

  // initial status probe (also tells us if the seed pool needs importing)
  const probe = useCallback(async () => {
    const res = await fetch('/api/trends/label-queue?limit=1');
    const d = await res.json();
    setTotalSeed((d.remaining ?? 0) + (d.likedCount ?? 0) + (d.dislikedCount ?? 0));
    setUnembedded(d.unembedded ?? 0);
    if ((d.remaining ?? 0) > 0 && (d.unembedded ?? 0) === 0) void fetchBatch();
    else { setLoading(false); }
  }, [fetchBatch]);
  useEffect(() => { void probe(); }, [probe]);

  const current = queue[idx];

  const mark = useCallback(async (value: 1 | -1) => {
    const p = queue[idx];
    if (!p) return;
    setIdx((i) => i + 1);
    if (value === 1) setLikedCount((c) => c + 1); else setDislikedCount((c) => c + 1);
    setRemaining((r) => Math.max(0, r - 1));
    await fetch(`/api/trends/posts/${p.id}/interested`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }),
    });
  }, [queue, idx]);

  const skip = useCallback(() => {
    const p = queue[idx];
    if (p) skipped.current.push(p.id);
    setIdx((i) => i + 1);
  }, [queue, idx]);

  // fetch the next batch when the local queue runs out
  useEffect(() => {
    if (!loading && totalSeed !== null && totalSeed > 0 && unembedded === 0 && idx >= queue.length && queue.length > 0) {
      void fetchBatch();
    }
  }, [idx, queue.length, loading, totalSeed, unembedded, fetchBatch]);

  // keyboard: ← 不要, → 想留, ↓/space 跳過
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!current) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); void mark(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); void mark(1); }
      else if (e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); skip(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, mark, skip]);

  const runPrep = async () => {
    try {
      if (totalSeed === 0) {
        setPrep('匯入 CSV 中…');
        const r = await fetch('/api/trends/seed-import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const d = await r.json();
        if (d.error) { setPrep(`匯入失敗：${d.error}`); return; }
        setTotalSeed(d.totalSeed); setUnembedded(d.unembedded);
      }
      // embed everything that still lacks a vector (loop until done)
      for (let guard = 0; guard < 100; guard++) {
        const r = await fetch('/api/trends/posts/embed-missing?all=1', { method: 'POST' });
        const d = await r.json();
        setUnembedded(d.remaining ?? 0);
        setPrep(`建立向量中…剩 ${d.remaining}`);
        if (!d.remaining) break;
      }
      setPrep(null);
      await fetchBatch();
    } catch (e) {
      setPrep(`失敗：${(e as Error).message}`);
    }
  };

  const labeledTotal = likedCount + dislikedCount;

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pb-24">
      <h1 className="text-xl font-bold text-brand mb-2">口味標註</h1>
      <p className="text-xs text-zinc-500 mb-4">
        從舊資料庫匯入的高互動貼文中，快速標「想留 / 不要」。不用標完 —— 隨時可停，進度會存，下次回來接著標。
        累積到 25 篇後會自動改成「挑模稜兩可的優先」，每一票最有效。鍵盤：<span className="text-zinc-300">← 不要</span>、<span className="text-zinc-300">→ 想留</span>、<span className="text-zinc-300">↓ 跳過</span>。
      </p>

      <div className="flex items-center gap-3 mb-5 text-xs flex-wrap">
        <span className="text-zinc-400">已標 <span className="text-emerald-400 font-semibold">👍{likedCount}</span> <span className="text-rose-400 font-semibold">👎{dislikedCount}</span></span>
        <span className="text-zinc-500">待標 {remaining}</span>
        <span className={`px-2 py-0.5 rounded ${mode === 'active' ? 'bg-purple-500/15 text-purple-300' : 'bg-zinc-800 text-zinc-400'}`}>
          {mode === 'active' ? '🎯 邊界優先' : `高互動優先（再 ${Math.max(0, 25 - labeledTotal)} 篇切換）`}
        </span>
      </div>

      {loading ? (
        <p className="text-zinc-500 text-sm">載入中…</p>
      ) : totalSeed === 0 || unembedded > 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 text-center">
          <p className="text-sm text-zinc-300 mb-3">
            {totalSeed === 0 ? '尚未匯入標註資料。' : `還有 ${unembedded} 篇待建立向量。`}
          </p>
          <button onClick={runPrep} disabled={!!prep}
            className="px-4 py-2 rounded-lg bg-brand/20 text-brand hover:bg-brand/30 disabled:opacity-50 text-sm">
            {prep || (totalSeed === 0 ? '① 匯入 CSV ＋ ② 建立向量' : '建立向量')}
          </button>
        </div>
      ) : !current ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 text-center">
          <p className="text-sm text-zinc-300 mb-3">這批標完了 🎉</p>
          <button onClick={fetchBatch} className="px-4 py-2 rounded-lg bg-brand/20 text-brand hover:bg-brand/30 text-sm">載入下一批</button>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 min-h-[14rem]">
            <div className="flex items-center gap-2 mb-3 text-xs">
              {current.author && <span className="font-semibold text-zinc-200">@{current.author}</span>}
              {current.relevant ? <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">AI/科技</span> : null}
              <span className="text-rose-400 font-semibold">❤ {current.like_count.toLocaleString()}</span>
              <span className="text-sky-400 font-semibold">💬 {current.reply_count.toLocaleString()}</span>
              {typeof current.interest_score === 'number' && (
                <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300">預測 {Math.max(0, Math.round(current.interest_score * 100))}%</span>
              )}
              {current.posted_at && <span className="ml-auto text-zinc-500">{current.posted_at.slice(0, 10)}</span>}
            </div>
            <p className="text-[15px] text-zinc-100 leading-relaxed whitespace-pre-wrap">{current.text}</p>
            {current.permalink && (
              <a href={current.permalink} target="_blank" rel="noopener noreferrer"
                className="inline-block mt-3 text-xs text-zinc-500 hover:text-zinc-300">↗ 原文</a>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 mt-4">
            <button onClick={() => mark(-1)}
              className="py-3 rounded-xl bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 font-medium">👎 不要 <span className="text-xs opacity-60">←</span></button>
            <button onClick={skip}
              className="py-3 rounded-xl bg-zinc-800 text-zinc-400 hover:bg-zinc-700 font-medium">跳過 <span className="text-xs opacity-60">↓</span></button>
            <button onClick={() => mark(1)}
              className="py-3 rounded-xl bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 font-medium">👍 想留 <span className="text-xs opacity-60">→</span></button>
          </div>
        </>
      )}
    </div>
  );
}
