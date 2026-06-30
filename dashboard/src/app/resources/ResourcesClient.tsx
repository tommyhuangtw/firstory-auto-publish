'use client';

import { useEffect, useState, useCallback } from 'react';
import PageHeader from '@/components/PageHeader';

interface Row {
  id: number;
  guid: string;
  content_type: string;
  title: string;
  description: string | null;
  url: string;
  author: string | null;
  stars: number | null;
  likes: number | null;
  comments: number | null;
  reposts: number | null;
  star_velocity: number | null;
  published_at: string | null;
  freshness_reason: string;
  ai_score: number | null;
  ai_summary: string | null;
  ai_highlights: string | null;
  draft_id: number | null;
  draft_text: string | null;
  viral_score: number | null;
}

const SETTING_KEYS = [
  'resource_x_queries',
  'resource_x_exclude_accounts',
  'resource_x_min_faves',
  'resource_recency_days',
  'resource_max_post_age_days',
  'resource_top_n',
] as const;
type SettingKey = (typeof SETTING_KEYS)[number];

const LIST_KEYS: SettingKey[] = ['resource_x_queries', 'resource_x_exclude_accounts'];
const NUM_KEYS: SettingKey[] = [
  'resource_x_min_faves',
  'resource_recency_days',
  'resource_max_post_age_days',
  'resource_top_n',
];

const NUM_LABELS: Record<string, string> = {
  resource_x_min_faves: 'min_faves（X 來源讚數門檻）',
  resource_recency_days: '幾天內（社群近期）',
  resource_max_post_age_days: '貼文最舊幾天',
  resource_top_n: '每次收幾篇',
};

function whyHot(r: Row): string {
  const burstWin: Record<string, string> = { burst_3d: '3天', burst_1w: '1週', burst_2w: '2週', burst_1m: '1個月', burst_2m: '2個月' };
  const win = burstWin[r.freshness_reason];
  if (win) return `🚀 ${win}衝 ${(r.stars ?? 0).toLocaleString()}★`;
  if (r.freshness_reason === 'star_spike') return `⭐ ${(r.star_velocity ?? 0).toFixed(0)}/day`;
  if (r.freshness_reason === 'youth') return '🆕 新工具';
  return '🔥 社群熱議';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString().split('T')[0] : '';
}

function scoreCls(s: number): string {
  if (s >= 90) return 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/20';
  if (s >= 80) return 'bg-brand/15 text-brand ring-1 ring-brand/20';
  return 'bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700';
}

function typeLabel(t: string): string {
  return t === 'github' ? 'GitHub' : t === 'x' ? '𝕏' : t === 'reddit' ? 'Reddit' : '連結';
}

function nf(n: number | null): string {
  const v = n ?? 0;
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
}

/** 排除名單比對的是 @handle 不是顯示名稱：X 從推文 URL 抓 handle，github 用 owner login。 */
function excludeHandle(r: Row): string {
  if (r.content_type === 'github') return (r.author ?? '').split('/')[0] || (r.author ?? '');
  const m = (r.url ?? '').match(/(?:twitter|x)\.com\/([^/?#]+)/i);
  return m && m[1] && m[1].toLowerCase() !== 'i' ? m[1] : (r.author ?? '');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const splitList = (v: string): string[] => v.split(',').map((s) => s.trim()).filter(Boolean);

export default function ResourcesClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [runs, setRuns] = useState<Array<Record<string, number | string>>>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState<number | null>(null);
  const [edited, setEdited] = useState<Record<number, string>>({});
  const [saveError, setSaveError] = useState<Record<number, boolean>>({});

  // Per-resource on-demand draft state.
  const [drafts, setDrafts] = useState<Record<number, { draftId: number; draftText: string }>>({});
  const [genState, setGenState] = useState<Record<number, { running: boolean; elapsed: number; error: boolean }>>({});

  // Settings panel state.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Record<SettingKey, string> | null>(null);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [chipInput, setChipInput] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  // Resolve a resource's draft from on-demand state first, then the loaded row.
  const draftFor = (r: Row): { draftId: number; draftText: string } | null => {
    if (drafts[r.id]) return drafts[r.id];
    if (r.draft_id != null) return { draftId: r.draft_id, draftText: r.draft_text ?? '' };
    return null;
  };
  const currentText = (draftId: number, fallback: string): string => edited[draftId] ?? fallback;

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
      // A scan takes minutes (scrape + LLM scoring). Poll scans until a newer run finished, capped ~10 min.
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
        const done = Number(newest.id) > prevRunId && newest.finished_at != null;
        if (done || newest.error) break;
      }
    } finally {
      await load();
      setRunning(false);
    }
  };

  // On-demand draft generation (best-of-N voice writer, ~20-40s).
  const generateDraft = async (resourceId: number) => {
    setGenState((m) => ({ ...m, [resourceId]: { running: true, elapsed: 0, error: false } }));
    const startedAt = Date.now();
    const tick = setInterval(() => {
      setGenState((m) => ({
        ...m,
        [resourceId]: { ...(m[resourceId] ?? { running: true, error: false }), running: true, error: false, elapsed: Math.floor((Date.now() - startedAt) / 1000) },
      }));
    }, 1000);
    try {
      const res = await fetch(`/api/resources/${resourceId}/draft`, { method: 'POST' });
      if (!res.ok) throw new Error(`draft failed: ${res.status}`);
      const d = await res.json() as { draftId: number; draftText: string };
      setDrafts((m) => ({ ...m, [resourceId]: { draftId: d.draftId, draftText: d.draftText } }));
      setGenState((m) => ({ ...m, [resourceId]: { running: false, elapsed: 0, error: false } }));
    } catch (err) {
      console.error('generateDraft failed', err);
      setGenState((m) => ({ ...m, [resourceId]: { running: false, elapsed: 0, error: true } }));
    } finally {
      clearInterval(tick);
    }
  };

  const saveDraft = async (resourceId: number, draftId: number, text: string) => {
    try {
      const res = await fetch(`/api/resources/${resourceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftText: text, draftId }),
      });
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      setSaveError((m) => ({ ...m, [draftId]: false }));
    } catch (err) {
      console.error('saveDraft failed', err);
      setSaveError((m) => ({ ...m, [draftId]: true }));
    }
  };

  const dismiss = async (resourceId: number) => {
    try {
      const res = await fetch(`/api/resources/${resourceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss' }),
      });
      if (!res.ok) throw new Error(`dismiss failed: ${res.status}`);
    } catch (err) {
      console.error('dismiss failed', err);
    }
    void load();
  };

  const copyText = async (draftId: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(draftId);
      setTimeout(() => setCopied(null), 1500);
    } catch (err) {
      console.error('clipboard write failed', err);
    }
  };

  // ---- Settings panel ----
  const openSettings = async () => {
    setSettingsOpen((o) => !o);
    if (!settings) {
      try {
        const data = await fetch('/api/resources/settings').then((r) => r.json());
        setSettings(data.settings ?? null);
      } catch (err) {
        console.error('load settings failed', err);
      }
    }
  };

  const setSettingValue = (key: SettingKey, value: string) =>
    setSettings((s) => (s ? { ...s, [key]: value } : s));

  const addChip = (key: SettingKey) => {
    if (!settings) return;
    const val = (chipInput[key] ?? '').trim();
    if (!val) return;
    const list = splitList(settings[key]);
    if (!list.includes(val)) list.push(val);
    setSettingValue(key, list.join(','));
    setChipInput((m) => ({ ...m, [key]: '' }));
  };

  const removeChip = (key: SettingKey, chip: string) => {
    if (!settings) return;
    const list = splitList(settings[key]).filter((c) => c !== chip);
    setSettingValue(key, list.join(','));
  };

  const saveSettings = async () => {
    if (!settings) return;
    try {
      await fetch('/api/resources/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2000);
      setSettingsOpen(false);
    } catch (err) {
      console.error('save settings failed', err);
    }
  };

  // Append an author to the exclude-accounts list and persist.
  // NOTE: the displayed author name may differ from the X @handle used by the crawler's
  // exclude filter — this is best-effort; we store the author string as-is.
  const excludeAuthor = async (author: string) => {
    let current = settings;
    if (!current) {
      try {
        const data = await fetch('/api/resources/settings').then((r) => r.json());
        current = data.settings ?? null;
        setSettings(current);
      } catch {
        return;
      }
    }
    if (!current) return;
    const list = splitList(current.resource_x_exclude_accounts);
    if (!list.includes(author)) list.push(author);
    const next = { ...current, resource_x_exclude_accounts: list.join(',') };
    setSettings(next);
    try {
      await fetch('/api/resources/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { resource_x_exclude_accounts: next.resource_x_exclude_accounts } }),
      });
      setToast(`已排除 @${author}`);
      setTimeout(() => setToast(null), 2000);
    } catch (err) {
      console.error('exclude author failed', err);
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

      <p className="text-xs text-zinc-500 mb-3">
        從 GitHub / X / Reddit 挑出近期爆紅的 AI 工具與資源，經閘門 + AI 評分後留下精華。每張卡片有
        📌 中文重點，想發文時按「✍️ 改寫成我的貼文」用你的口吻生草稿（草稿內文不含連結，請用「🔗 來源」取得網址）。
      </p>

      {/* 爬取設定 collapsible panel */}
      <button
        onClick={openSettings}
        className="text-xs px-3 py-2 md:py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 mb-3"
      >
        ⚙️ 爬取設定 {settingsOpen ? '▲' : '▼'}
        {settingsSaved && <span className="ml-2 text-emerald-400">已儲存 ✓</span>}
      </button>

      {settingsOpen && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 mb-4 space-y-4">
          {!settings ? (
            <p className="text-zinc-500 text-sm">載入設定中…</p>
          ) : (
            <>
              {LIST_KEYS.map((key) => (
                <div key={key}>
                  <label className="block text-xs text-zinc-400 mb-1.5">
                    {key === 'resource_x_queries' ? '搜尋關鍵字' : '排除帳號'}
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {splitList(settings[key]).map((chip) => (
                      <span
                        key={chip}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-zinc-800 text-zinc-200 break-words"
                      >
                        {chip}
                        <button
                          onClick={() => removeChip(key, chip)}
                          className="text-zinc-500 hover:text-rose-400"
                          aria-label="移除"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={chipInput[key] ?? ''}
                      onChange={(e) => setChipInput((m) => ({ ...m, [key]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChip(key); } }}
                      placeholder={key === 'resource_x_queries' ? '新增關鍵字…' : '新增帳號…'}
                      className="flex-1 min-w-0 px-2.5 py-2 md:py-1.5 text-sm rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-200 focus:outline-none focus:border-brand/50"
                    />
                    <button
                      onClick={() => addChip(key)}
                      className="text-xs px-3 py-2 md:py-1.5 rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700 shrink-0"
                    >
                      新增
                    </button>
                  </div>
                </div>
              ))}

              <div className="grid grid-cols-2 gap-3">
                {NUM_KEYS.map((key) => (
                  <div key={key}>
                    <label className="block text-xs text-zinc-400 mb-1">{NUM_LABELS[key]}</label>
                    <input
                      type="number"
                      value={settings[key]}
                      onChange={(e) => setSettingValue(key, e.target.value)}
                      className="w-full px-2.5 py-2 md:py-1.5 text-sm rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-200 focus:outline-none focus:border-brand/50"
                    />
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={saveSettings}
                  className="text-sm px-4 py-2 md:py-1.5 rounded-lg bg-brand/15 text-brand hover:bg-brand/25"
                >
                  儲存
                </button>
                <span className="text-xs text-zinc-500">設定下一輪執行生效。</span>
              </div>
            </>
          )}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 text-sm px-4 py-2 rounded-lg bg-zinc-800 text-zinc-100 shadow-lg">
          {toast}
        </div>
      )}

      {loading ? (
        <p className="text-zinc-500 text-sm">載入中…</p>
      ) : rows.length === 0 ? (
        <p className="text-zinc-400 text-center py-10">尚無資源，按「立即執行」跑一輪。</p>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => {
            const draft = draftFor(r);
            const gen = genState[r.id];
            return (
              <div
                key={r.id}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 transition-colors hover:border-zinc-700"
              >
                {/* header: type + why-hot chips, title, score badge */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-2">
                      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                        {typeLabel(r.content_type)}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-800/70 text-zinc-400">
                        {whyHot(r)}
                      </span>
                      {r.published_at && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-800/70 text-zinc-500">
                          📅 {fmtDate(r.published_at)}
                        </span>
                      )}
                    </div>
                    <h3 className="font-semibold text-[15px] leading-snug text-zinc-100 break-words">{r.title}</h3>
                  </div>
                  {r.ai_score != null && (
                    <span className={`shrink-0 text-sm font-bold tabular-nums px-2.5 py-1 rounded-lg ${scoreCls(r.ai_score)}`}>
                      {r.ai_score}
                    </span>
                  )}
                </div>

                {/* meta: author + engagement stats + exclude */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-2.5 text-xs text-zinc-400">
                  {r.author && <span className="text-zinc-300 break-words">@{r.author}</span>}
                  {r.content_type === 'github' ? (
                    <span className="tabular-nums">⭐ <b className="text-zinc-200">{nf(r.stars)}</b></span>
                  ) : (
                    <span className="flex items-center gap-3 tabular-nums">
                      <span>👍 <b className="text-zinc-200">{nf(r.likes)}</b></span>
                      <span>💬 <b className="text-zinc-200">{nf(r.comments)}</b></span>
                      <span>🔁 <b className="text-zinc-200">{nf(r.reposts)}</b></span>
                    </span>
                  )}
                  {r.author && (
                    <button
                      onClick={() => excludeAuthor(excludeHandle(r))}
                      className="text-[11px] text-zinc-500 hover:text-rose-400"
                    >
                      🚫 排除帳號
                    </button>
                  )}
                </div>

                {/* 中文重點 — the scannable insight, visually anchored */}
                {r.ai_summary && (
                  <div className="mt-3.5 rounded-xl bg-brand/[0.06] border border-brand/15 px-4 py-3">
                    <p className="text-[15px] leading-relaxed text-zinc-100 break-words">{r.ai_summary}</p>
                  </div>
                )}

                {/* 原文 — labeled, scrollable, clearly secondary */}
                {r.description && (
                  <div className="mt-3">
                    <p className="text-[11px] uppercase tracking-wide text-zinc-600 mb-1">原文</p>
                    <div className="text-xs text-zinc-400 break-words whitespace-pre-wrap border-l-2 border-zinc-700 pl-3 leading-relaxed max-h-40 overflow-y-auto">
                      {r.description}
                    </div>
                  </div>
                )}

                {draft ? (
                  <>
                    <textarea
                      defaultValue={draft.draftText}
                      onChange={(e) => setEdited((m) => ({ ...m, [draft.draftId]: e.target.value }))}
                      onBlur={(e) => saveDraft(r.id, draft.draftId, e.target.value)}
                      rows={6}
                      className="w-full mt-4 p-3 text-sm rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-200 resize-y leading-relaxed focus:outline-none focus:border-brand/50"
                    />
                    {saveError[draft.draftId] && (
                      <p className="text-xs text-rose-400 mt-1">儲存失敗</p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 mt-2.5">
                      <button
                        onClick={() => copyText(draft.draftId, currentText(draft.draftId, draft.draftText))}
                        className="text-xs px-3 py-2 md:py-1.5 rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                      >
                        {copied === draft.draftId ? '已複製 ✓' : '📋 複製'}
                      </button>
                      <a
                        href={`https://www.threads.net/intent/post?text=${encodeURIComponent(currentText(draft.draftId, draft.draftText))}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs px-3 py-2 md:py-1.5 rounded-lg bg-black text-white hover:bg-zinc-800"
                      >
                        🧵 去 Threads 發佈
                      </a>
                    </div>
                  </>
                ) : (
                  <div className="mt-4">
                    <button
                      onClick={() => generateDraft(r.id)}
                      disabled={gen?.running}
                      className="text-sm font-medium px-4 py-2.5 md:py-2 rounded-xl bg-brand text-white hover:bg-brand/90 disabled:opacity-50 shadow-sm"
                    >
                      {gen?.running ? `生成中…（已 ${gen.elapsed}s）` : '✍️ 改寫成我的貼文'}
                    </button>
                    {gen?.error && <span className="text-xs text-rose-400 ml-2">生成失敗</span>}
                  </div>
                )}

                {/* actions footer */}
                <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-zinc-800/70">
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs px-3 py-2 md:py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  >
                    🔗 來源
                  </a>
                  <button
                    onClick={() => dismiss(r.id)}
                    className="text-xs px-3 py-2 md:py-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 ml-auto"
                  >
                    ❌ 不要
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
