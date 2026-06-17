'use client';

import { useState, useEffect, useCallback } from 'react';

interface Run {
  id: number;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  trigger?: string;
  topics?: string[];
  scraped: number;
  below_floor: number;
  stale: number;
  deduped: number;
  recorded: number;
  error?: string | null;
}
interface Dropped { a: string | null; t: string; e: number; r: string; p: string | null }
interface Recorded { id: number; author?: string; text: string; like_count: number; reply_count: number; relevant?: number; source?: string; permalink?: string }

const REASON: Record<string, { label: string; cls: string }> = {
  below_floor: { label: '互動 <80', cls: 'bg-amber-500/15 text-amber-400' },
  stale: { label: '太舊（>2天）', cls: 'bg-zinc-700/40 text-zinc-400' },
  duplicate: { label: '重複（已爬過）', cls: 'bg-sky-500/15 text-sky-400' },
};
const TRIGGER: Record<string, string> = { manual: '手動', scheduled: '排程', catchup: '補跑' };

export default function ScansPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ run: Run; dropped: Dropped[]; recorded: Recorded[] } | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/trends/scans?limit=40');
    const d = await res.json();
    setRuns(d.runs || []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggle = async (id: number) => {
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setOpenId(id); setDetail(null); setDetailBusy(true);
    const res = await fetch(`/api/trends/scans/${id}`);
    const d = await res.json();
    setDetailBusy(false);
    if (!d.error) setDetail({ run: d.run, dropped: d.run.dropped || [], recorded: d.recorded || [] });
  };

  const fmtTime = (s?: string) => s ? new Date(s).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const fmtDur = (ms?: number) => ms ? `${(ms / 1000).toFixed(0)}秒` : '—';

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h1 className="text-xl font-bold text-brand">掃描紀錄</h1>
        <div className="flex gap-2">
          <button onClick={load} className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700">重新整理</button>
          <a href="/trends" className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700">← 社群熱點</a>
        </div>
      </div>
      <p className="text-xs text-zinc-500 mb-4">每次爬蟲的完整紀錄：時間、搜尋的主題、爬到幾篇、哪些被過濾掉、為什麼。點一列看明細。</p>

      {loading ? (
        <p className="text-zinc-500 text-sm">載入中…</p>
      ) : runs.length === 0 ? (
        <p className="text-zinc-500 text-sm">還沒有掃描紀錄。到「社群熱點」按「立即掃描」跑一次。</p>
      ) : (
        <div className="space-y-2">
          {runs.map((r) => (
            <div key={r.id} className={`rounded-xl border ${r.error ? 'border-rose-500/40' : 'border-zinc-800'} bg-zinc-900/40`}>
              <button onClick={() => toggle(r.id)} className="w-full text-left p-3.5 hover:bg-zinc-900/70 rounded-xl">
                <div className="flex items-center gap-2 flex-wrap text-xs mb-1.5">
                  <span className="text-zinc-300 font-medium">{fmtTime(r.started_at)}</span>
                  <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300">{TRIGGER[r.trigger || ''] || r.trigger || '—'}</span>
                  <span className="text-zinc-500">{fmtDur(r.duration_ms)}</span>
                  {r.error && <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400">失敗</span>}
                  <span className="ml-auto text-zinc-500">{openId === r.id ? '▲' : '▼'}</span>
                </div>
                {r.error ? (
                  <p className="text-xs text-rose-400 truncate">{r.error}</p>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <span className="text-zinc-400">爬 <b className="text-zinc-200">{r.scraped}</b></span>
                    <span className="text-zinc-600">→</span>
                    <span className="text-emerald-400">記錄 <b>{r.recorded}</b></span>
                    <span className="text-zinc-600">｜丟棄:</span>
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">&lt;80 ×{r.below_floor}</span>
                    <span className="px-1.5 py-0.5 rounded bg-zinc-700/40 text-zinc-400">太舊 ×{r.stale}</span>
                    <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400">重複 ×{r.deduped}</span>
                  </div>
                )}
              </button>

              {openId === r.id && (
                <div className="border-t border-zinc-800 p-3.5 text-xs">
                  {detailBusy ? <p className="text-zinc-500">載入明細…</p> : detail && detail.run.id === r.id ? (
                    <>
                      {r.topics && r.topics.length > 0 && (
                        <div className="mb-3"><span className="text-zinc-500">搜尋主題：</span>
                          {r.topics.map((t) => <span key={t} className="inline-block ml-1 px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">{t}</span>)}
                        </div>
                      )}
                      <div className="mb-3">
                        <p className="text-zinc-400 mb-1.5">✅ 記錄下來（{detail.recorded.length}）</p>
                        <div className="space-y-1 max-h-56 overflow-y-auto">
                          {detail.recorded.map((p) => (
                            <div key={p.id} className="flex gap-2 items-baseline">
                              <span className="text-zinc-500 shrink-0 tabular-nums">❤{p.like_count + p.reply_count}</span>
                              {p.relevant ? <span className="text-emerald-400 shrink-0">AI</span> : null}
                              <span className="text-zinc-300 truncate">{p.text.slice(0, 60)}</span>
                              {p.source && <span className="text-zinc-600 shrink-0">[{p.source}]</span>}
                            </div>
                          ))}
                          {detail.recorded.length === 0 && <p className="text-zinc-600">（無）</p>}
                        </div>
                      </div>
                      <div>
                        <p className="text-zinc-400 mb-1.5">🗑 被過濾掉（{detail.dropped.length}）</p>
                        <div className="space-y-1 max-h-72 overflow-y-auto">
                          {detail.dropped.map((d, i) => (
                            <div key={i} className="flex gap-2 items-baseline">
                              <span className={`shrink-0 px-1.5 py-0.5 rounded ${REASON[d.r]?.cls || 'bg-zinc-800 text-zinc-400'}`}>{REASON[d.r]?.label || d.r}</span>
                              <span className="text-zinc-500 shrink-0 tabular-nums">❤{d.e}</span>
                              <span className="text-zinc-400 truncate">{d.t}</span>
                            </div>
                          ))}
                          {detail.dropped.length === 0 && <p className="text-zinc-600">（無）</p>}
                        </div>
                      </div>
                    </>
                  ) : <p className="text-zinc-500">載入失敗</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
