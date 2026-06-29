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

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString().split('T')[0] : '';
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
        <div className="space-y-3">
          {rows.map((r) => {
            const draft = draftFor(r);
            const gen = genState[r.id];
            return (
              <div
                key={r.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4"
              >
                <div className="flex justify-between items-start gap-2 min-w-0">
                  <h3 className="font-semibold text-zinc-100 break-words">{r.title}</h3>
                  <span className="shrink-0 text-[11px] md:text-[10px] font-medium px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                    {r.content_type}
                  </span>
                </div>

                {r.author && (
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <span className="text-xs text-zinc-400 break-words">@{r.author}</span>
                    <button
                      onClick={() => excludeAuthor(r.author!)}
                      className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-rose-400 hover:bg-zinc-700"
                    >
                      🚫 排除帳號
                    </button>
                  </div>
                )}

                <p className="text-xs text-zinc-500 mt-1.5 break-words">
                  {whyHot(r)}
                  {r.published_at && repoAge(r.published_at) && `　｜${repoAge(r.published_at)}`}
                  {r.ai_score != null && `　｜評分 ${r.ai_score}/100`}
                </p>

                <p className="text-xs text-zinc-400 mt-1 break-words">
                  {r.content_type === 'github'
                    ? `⭐ ${r.stars ?? 0} stars${r.published_at ? `　｜📅 發布 ${fmtDate(r.published_at)}` : ''}`
                    : `👍 ${r.likes ?? 0}　💬 ${r.comments ?? 0}　🔁 ${r.reposts ?? 0}${r.published_at ? `　｜📅 ${fmtDate(r.published_at)}` : ''}`}
                </p>

                {r.ai_summary && (
                  <p className="text-sm text-zinc-200 mt-2.5 break-words">📌 {r.ai_summary}</p>
                )}

                {r.description && (
                  <div className="text-xs text-zinc-400 mt-2 break-words whitespace-pre-wrap border-l-2 border-zinc-700 pl-3 leading-relaxed max-h-36 overflow-y-auto">
                    {r.description}
                  </div>
                )}

                {draft ? (
                  <>
                    <textarea
                      defaultValue={draft.draftText}
                      onChange={(e) => setEdited((m) => ({ ...m, [draft.draftId]: e.target.value }))}
                      onBlur={(e) => saveDraft(r.id, draft.draftId, e.target.value)}
                      rows={6}
                      className="w-full mt-3 p-2.5 text-sm rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-200 resize-y focus:outline-none focus:border-brand/50"
                    />
                    {saveError[draft.draftId] && (
                      <p className="text-xs text-rose-400 mt-1">儲存失敗</p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 mt-2">
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
                  <div className="mt-3">
                    <button
                      onClick={() => generateDraft(r.id)}
                      disabled={gen?.running}
                      className="text-xs px-3 py-2 md:py-1.5 rounded-lg bg-brand/15 text-brand hover:bg-brand/25 disabled:opacity-50"
                    >
                      {gen?.running ? `生成中…（已 ${gen.elapsed}s）` : '✍️ 改寫成我的貼文'}
                    </button>
                    {gen?.error && <span className="text-xs text-rose-400 ml-2">生成失敗</span>}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs px-3 py-2 md:py-1.5 rounded-lg bg-brand/15 text-brand hover:bg-brand/25"
                  >
                    🔗 來源
                  </a>
                  <button
                    onClick={() => dismiss(r.id)}
                    className="text-xs px-3 py-2 md:py-1.5 rounded-lg bg-zinc-800 text-rose-400 hover:bg-zinc-700 ml-auto"
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
