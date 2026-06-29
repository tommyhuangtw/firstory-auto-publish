'use client';

import { useEffect, useState, useCallback } from 'react';
import PageHeader from '@/components/PageHeader';

interface Row {
  id: number;
  guid: string;
  content_type: string;
  title: string;
  description: string;
  url: string;
  stars: number | null;
  star_velocity: number | null;
  published_at: string | null;
  freshness_reason: string;
  ai_score: number | null;
  ai_highlights: string | null;
  draft_id: number | null;
  draft_text: string | null;
  viral_score: number | null;
}

function whyHot(r: Row): string {
  if (r.freshness_reason === 'star_spike') return `⭐ ${(r.star_velocity ?? 0).toFixed(0)}/day`;
  if (r.freshness_reason === 'youth') return '🆕 新工具';
  return '🔥 社群熱議';
}

function repoAge(iso: string | null): string {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(d) || d < 0) return '';
  return d < 31 ? `${d} 天` : `${Math.floor(d / 30)} 個月`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function ResourcesClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [runs, setRuns] = useState<Array<Record<string, number | string>>>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState<number | null>(null);
  const [edited, setEdited] = useState<Record<number, string>>({});
  const [saveError, setSaveError] = useState<Record<number, boolean>>({});

  const currentText = (r: Row): string =>
    r.draft_id != null ? edited[r.draft_id] ?? r.draft_text ?? '' : r.draft_text ?? '';

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      fetch('/api/resources').then((r) => r.json()).catch(() => ({})),
      fetch('/api/resources/scans').then((r) => r.json()).catch(() => ({})),
    ]);
    setRows(a.resources ?? []);
    setRuns(b.runs ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    // Opening the page = seen → clears the sidebar red dot.
    window.dispatchEvent(new CustomEvent('nav:unread-seen', { detail: 'resources' }));
    void fetch('/api/resources/unread', { method: 'POST' }).catch(() => {});
  }, [load]);

  const runScan = async () => {
    const prevRunId = Number(runs[0]?.id ?? 0);
    setRunning(true);
    setElapsed(0);
    const startedAt = Date.now();
    try {
      await fetch('/api/resources/scan', { method: 'POST' }).catch(() => {});
      // A scan takes minutes (scrape + LLM scoring + best-of-N drafting).
      // Poll the scans endpoint until a newer run row has finished, capped at ~10 min.
      for (let attempt = 0; attempt < 120; attempt++) {
        await sleep(5000);
        setElapsed(Math.floor((Date.now() - startedAt) / 1000));
        let newest: Record<string, number | string> | undefined;
        try {
          const data = await fetch('/api/resources/scans').then((r) => r.json());
          newest = (data.runs ?? [])[0];
        } catch {
          continue;
        }
        if (!newest) continue;
        const done =
          Number(newest.id) > prevRunId && newest.finished_at != null;
        if (done || newest.error) break;
      }
    } finally {
      await load();
      setRunning(false);
    }
  };

  const saveDraft = async (id: number, text: string) => {
    try {
      const res = await fetch(`/api/resources/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftText: text }),
      });
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      setSaveError((m) => ({ ...m, [id]: false }));
    } catch (err) {
      console.error('saveDraft failed', err);
      setSaveError((m) => ({ ...m, [id]: true }));
    }
  };

  const dismiss = async (id: number) => {
    try {
      const res = await fetch(`/api/resources/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss' }),
      });
      if (!res.ok) throw new Error(`dismiss failed: ${res.status}`);
      setSaveError((m) => ({ ...m, [id]: false }));
    } catch (err) {
      console.error('dismiss failed', err);
      setSaveError((m) => ({ ...m, [id]: true }));
    }
    void load();
  };

  const copyText = async (id: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch (err) {
      console.error('clipboard write failed', err);
    }
  };

  const last = runs[0];

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-20">
      <PageHeader
        title="學習資源"
        actions={
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={runScan}
              disabled={running}
              className="px-3 py-2 md:py-1.5 text-sm rounded-lg bg-brand/15 text-brand hover:bg-brand/25 disabled:opacity-50"
            >
              {running ? `執行中…（已 ${elapsed}s）` : '▶️ 立即執行'}
            </button>
            {last && (
              <span className="text-xs text-zinc-500 break-words">
                上次：爬 {last.scraped}→閘門淘汰 {last.below_gate}→收錄 {last.recorded}
                {Number(last.cost_usd) > 0 &&
                  ` ｜💸 ~$${Number(last.cost_usd).toFixed(3)}/次（月估 ~$${(Number(last.cost_usd) * 30).toFixed(2)}）`}
              </span>
            )}
          </div>
        }
      />

      <p className="text-xs text-zinc-500 mb-4">
        從 GitHub / X / Reddit 挑出近期爆紅的 AI 工具與資源，經閘門 + AI 評分後留下精華，並用你的口吻寫成 Threads 草稿。草稿內文不含連結（語氣寫手會把連結拿掉），請用每張卡片下方的「🔗 來源」取得網址。
      </p>

      {loading ? (
        <p className="text-zinc-500 text-sm">載入中…</p>
      ) : rows.length === 0 ? (
        <p className="text-zinc-400 text-center py-10">尚無資源，按「立即執行」跑一輪。</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div
              key={`${r.guid}-${r.draft_id ?? 'none'}`}
              className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4"
            >
              <div className="flex justify-between items-start gap-2 min-w-0">
                <h3 className="font-semibold text-zinc-100 break-words">{r.title}</h3>
                <span className="shrink-0 text-[11px] md:text-[10px] font-medium px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                  {r.content_type}
                </span>
              </div>

              <p className="text-xs text-zinc-500 mt-1.5 break-words">
                {whyHot(r)}
                {r.stars != null && `　｜⭐ ${r.stars}`}
                {r.published_at && repoAge(r.published_at) && `　｜${repoAge(r.published_at)}`}
                {r.ai_score != null && `　｜評分 ${r.ai_score}/100`}
              </p>

              {r.draft_id && (
                <>
                  <textarea
                    defaultValue={r.draft_text ?? ''}
                    onChange={(e) =>
                      setEdited((m) => ({ ...m, [r.draft_id!]: e.target.value }))
                    }
                    onBlur={(e) => saveDraft(r.draft_id!, e.target.value)}
                    rows={6}
                    className="w-full mt-3 p-2.5 text-sm rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-200 resize-y focus:outline-none focus:border-brand/50"
                  />
                  {saveError[r.draft_id] && (
                    <p className="text-xs text-rose-400 mt-1">儲存失敗</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <button
                      onClick={() => copyText(r.draft_id!, currentText(r))}
                      className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                    >
                      {copied === r.draft_id ? '已複製 ✓' : '📋 複製'}
                    </button>
                    <a
                      href={`https://www.threads.net/intent/post?text=${encodeURIComponent(currentText(r))}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs px-3 py-1.5 rounded-lg bg-black text-white hover:bg-zinc-800"
                    >
                      🧵 去 Threads 發佈
                    </a>
                    <button
                      onClick={() => dismiss(r.draft_id!)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-rose-400 hover:bg-zinc-700 ml-auto"
                    >
                      ❌ 不要
                    </button>
                  </div>
                </>
              )}

              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="inline-block mt-3 text-xs px-3 py-1.5 rounded-lg bg-brand/15 text-brand hover:bg-brand/25"
              >
                🔗 來源
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
