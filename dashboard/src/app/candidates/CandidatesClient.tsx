'use client';

import { useCallback, useEffect, useState } from 'react';
import PageHeader from '@/components/PageHeader';

interface Candidate {
  id: number;
  video_id: string;
  title: string;
  channel_name: string;
  thumbnail_url: string | null;
  published_at: string | null;
  view_count: number;
  duration_seconds: number;
  source: 'query' | 'channel';
  source_detail: string;
  status: string;
  tags: string | null;
}

const SEGMENTS: { value: string; label: string }[] = [
  { value: 'daily', label: '每日精選' },
  { value: 'weekly', label: '每週週報' },
  { value: 'robot', label: '機器人週報' },
  { value: 'sysdesign', label: '系統設計' },
  { value: 'quickchat', label: '懶懶碎碎念' },
];

const DATE_OPTS: { label: string; value: number }[] = [
  { label: '全部', value: 0 },
  { label: '1 天', value: 1 },
  { label: '2 天', value: 2 },
  { label: '3 天', value: 3 },
  { label: '1 週', value: 7 },
  { label: '2 週', value: 14 },
];

const VIEW_OPTS: { label: string; value: number }[] = [
  { label: '全部', value: 0 },
  { label: '5千+', value: 5_000 },
  { label: '1萬+', value: 10_000 },
  { label: '5萬+', value: 50_000 },
  { label: '10萬+', value: 100_000 },
  { label: '50萬+', value: 500_000 },
];

// Mirrors the fixed taxonomy in services/candidateTagger.ts (CANDIDATE_TAGS).
const TAG_OPTS = ['創業', 'AI 思維', 'AI 工具', '新發布', '技術教學', '產業趨勢', '機器人'];

function parseTags(csv: string | null): string[] {
  if (!csv) return [];
  return csv.split(',').map((t) => t.trim()).filter(Boolean);
}

function fmtViews(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  if (days < 30) return `${Math.floor(days / 7)} 週前`;
  return d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
}

function fmtDuration(s: number): string {
  if (!s) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

// ── Inline icons (Heroicons outline, 24×24) ──────────────────────────
const IconBookmark = ({ filled }: { filled?: boolean }) => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.7}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
  </svg>
);
const IconClose = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
  </svg>
);
const IconCheck = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
  </svg>
);

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 h-8 px-3 rounded-full text-[13px] font-medium cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${
        active ? 'bg-brand text-black' : 'bg-zinc-800/70 text-zinc-300 hover:bg-zinc-700 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

function Facet({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-9 shrink-0 text-[11px] font-medium tracking-wide text-zinc-500">{label}</span>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar py-0.5">{children}</div>
    </div>
  );
}

export default function CandidatesClient() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [crawling, setCrawling] = useState(false);
  const [source, setSource] = useState('');
  const [statusFilter, setStatusFilter] = useState('new,saved');
  const [sort, setSort] = useState('newest');
  const [days, setDays] = useState(0);
  const [minViews, setMinViews] = useState(0);
  const [channel, setChannel] = useState('');
  const [tag, setTag] = useState('');
  const [channelList, setChannelList] = useState<{ handle: string; name: string; count: number }[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [picker, setPicker] = useState(false);
  const [episodeLength, setEpisodeLength] = useState(15);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ status: statusFilter, sort });
    if (source) params.set('source', source);
    if (channel) params.set('channel', channel);
    if (tag) params.set('tag', tag);
    if (days) params.set('days', String(days));
    if (minViews) params.set('minViews', String(minViews));
    const r = await fetch(`/api/candidates?${params}`).then((r) => r.json()).catch(() => ({ candidates: [], channels: [] }));
    setCandidates(r.candidates || []);
    setChannelList(r.channels || []);
    setLoading(false);
  }, [source, statusFilter, sort, channel, tag, days, minViews]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    fetch('/api/candidates/unread', { method: 'POST' }).catch(() => {});
    window.dispatchEvent(new CustomEvent('nav:unread-seen', { detail: 'candidates' }));
  }, []);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const setStatus = async (ids: number[], status: string) => {
    await fetch('/api/candidates/status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, status }),
    });
    setSelected((prev) => { const n = new Set(prev); ids.forEach((i) => n.delete(i)); return n; });
    void load();
  };

  const crawl = async () => {
    setCrawling(true);
    const r = await fetch('/api/candidates/crawl', { method: 'POST' }).then((r) => r.json()).catch(() => null);
    setCrawling(false);
    setToast(r?.ok ? `爬到 ${r.queryAdded + r.channelAdded} 支新影片` : '爬取失敗');
    setTimeout(() => setToast(''), 4000);
    void load();
  };

  const makeEpisode = async (segmentType: string) => {
    const ids = [...selected];
    const urls = candidates.filter((c) => selected.has(c.id)).map((c) => `https://www.youtube.com/watch?v=${c.video_id}`);
    if (!urls.length) return;
    setPicker(false);
    const body: Record<string, unknown> = { segmentType, manualVideoUrls: urls };
    if (segmentType === 'quickchat') body.episodeLength = episodeLength;
    const r = await fetch('/api/pipeline/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then((r) => r.json()).catch(() => null);
    if (r?.episodeId) {
      await setStatus(ids, 'used');
      setToast(`已開始生成 EP #${r.episodeId}，可到「節目」查看`);
    } else {
      setToast(r?.error || '生成失敗');
    }
    setTimeout(() => setToast(''), 5000);
  };

  return (
    <div className="pb-28">
      <PageHeader
        title="選題板"
        subtitle="每天自動爬候選影片（你的 query + AI podcast 頻道），你來挑要做哪一集"
        actions={
          <button
            onClick={crawl}
            disabled={crawling}
            className="h-9 px-4 rounded-lg bg-brand text-black text-sm font-medium cursor-pointer transition-opacity disabled:opacity-50 hover:opacity-90"
          >
            {crawling ? '爬取中…' : '立即掃描'}
          </button>
        }
      />

      {/* Filters */}
      <div className="mb-4 space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
        <Facet label="來源">
          <Chip active={source === '' && !channel} onClick={() => { setSource(''); setChannel(''); }}>全部</Chip>
          <Chip active={source === 'channel' && !channel} onClick={() => setSource('channel')}>頻道</Chip>
          <Chip active={source === 'query'} onClick={() => { setSource('query'); setChannel(''); }}>搜尋</Chip>
        </Facet>
        <Facet label="狀態">
          <Chip active={statusFilter === 'new,saved'} onClick={() => setStatusFilter('new,saved')}>待看</Chip>
          <Chip active={statusFilter === 'saved'} onClick={() => setStatusFilter('saved')}>已存</Chip>
          <Chip active={statusFilter === 'used'} onClick={() => setStatusFilter('used')}>已用</Chip>
        </Facet>
        <Facet label="排序">
          <Chip active={sort === 'newest'} onClick={() => setSort('newest')}>最新發布</Chip>
          <Chip active={sort === 'views'} onClick={() => setSort('views')}>最多觀看</Chip>
          <Chip active={sort === 'crawled'} onClick={() => setSort('crawled')}>最新爬取</Chip>
        </Facet>
        <Facet label="發布">
          {DATE_OPTS.map((o) => <Chip key={o.value} active={days === o.value} onClick={() => setDays(o.value)}>{o.label}</Chip>)}
        </Facet>
        <Facet label="觀看">
          {VIEW_OPTS.map((o) => <Chip key={o.value} active={minViews === o.value} onClick={() => setMinViews(o.value)}>{o.label}</Chip>)}
        </Facet>
        <Facet label="標籤">
          <Chip active={tag === ''} onClick={() => setTag('')}>全部</Chip>
          {TAG_OPTS.map((t) => <Chip key={t} active={tag === t} onClick={() => setTag(t)}>{t}</Chip>)}
        </Facet>
        {channelList.length > 0 && (
          <Facet label="頻道">
            <Chip active={channel === ''} onClick={() => setChannel('')}>全部</Chip>
            {channelList.map((c) => (
              <Chip key={c.handle} active={channel === c.handle} onClick={() => { setChannel(c.handle); setSource(''); }}>
                <span className="inline-flex items-center max-w-[160px]">
                  <span className="truncate">{c.name}</span>
                  <span className="ml-1.5 opacity-50 shrink-0">{c.count}</span>
                </span>
              </Chip>
            ))}
          </Facet>
        )}
      </div>

      {/* List */}
      {loading ? (
        <p className="text-zinc-500 text-sm py-12 text-center">載入中…</p>
      ) : candidates.length === 0 ? (
        <p className="text-zinc-500 text-sm py-12 text-center">沒有符合的候選影片。試試放寬篩選，或按「立即掃描」。</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {candidates.map((c) => {
            const isSel = selected.has(c.id);
            const url = `https://www.youtube.com/watch?v=${c.video_id}`;
            const tags = parseTags(c.tags);
            return (
              <div
                key={c.id}
                className={`group flex flex-col rounded-xl border bg-zinc-900/60 overflow-hidden transition-colors ${
                  isSel ? 'border-brand ring-1 ring-brand' : 'border-zinc-800 hover:border-zinc-700'
                }`}
              >
                {/* Thumbnail */}
                <div className="relative aspect-video bg-zinc-800">
                  <a href={url} target="_blank" rel="noreferrer" className="block w-full h-full">
                    <img
                      src={`https://i.ytimg.com/vi/${c.video_id}/maxresdefault.jpg`}
                      alt=""
                      loading="lazy"
                      onError={(e) => {
                        // maxres 404s on some videos → fall back to the crawl thumbnail, then hqdefault.
                        const img = e.currentTarget;
                        if (img.dataset.fb) return;
                        img.dataset.fb = '1';
                        img.src = c.thumbnail_url || `https://i.ytimg.com/vi/${c.video_id}/hqdefault.jpg`;
                      }}
                      className="w-full h-full object-cover"
                    />
                  </a>
                  <button
                    onClick={() => toggle(c.id)}
                    aria-label={isSel ? '取消選取' : '選取'}
                    className={`absolute top-2 left-2 w-6 h-6 rounded-md border flex items-center justify-center cursor-pointer transition-colors ${
                      isSel ? 'bg-brand border-brand text-black' : 'bg-black/50 border-white/50 text-transparent hover:border-white'
                    }`}
                  >
                    <IconCheck />
                  </button>
                  <div className="absolute top-2 right-2 flex gap-1">
                    <button
                      onClick={() => setStatus([c.id], c.status === 'saved' ? 'new' : 'saved')}
                      aria-label={c.status === 'saved' ? '取消收藏' : '收藏'}
                      className={`w-8 h-8 rounded-md flex items-center justify-center backdrop-blur-sm cursor-pointer transition-colors ${
                        c.status === 'saved' ? 'bg-brand text-black' : 'bg-black/55 text-white hover:bg-black/75'
                      }`}
                    >
                      <IconBookmark filled={c.status === 'saved'} />
                    </button>
                    {c.status !== 'used' && (
                      <button
                        onClick={() => setStatus([c.id], 'dismissed')}
                        aria-label="略過"
                        className="w-8 h-8 rounded-md bg-black/55 text-white hover:bg-red-500/80 flex items-center justify-center backdrop-blur-sm cursor-pointer transition-colors"
                      >
                        <IconClose />
                      </button>
                    )}
                  </div>
                  <span className={`absolute bottom-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-medium ${c.source === 'channel' ? 'bg-brand text-black' : 'bg-black/70 text-white'}`}>
                    {c.source === 'channel' ? '頻道' : '搜尋'}
                  </span>
                  {c.duration_seconds > 0 && (
                    <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-white text-[11px] font-medium tabular-nums">
                      {fmtDuration(c.duration_seconds)}
                    </span>
                  )}
                </div>

                {/* Body */}
                <div className="flex flex-1 flex-col p-3">
                  <a href={url} target="_blank" rel="noreferrer" className="text-sm font-medium leading-snug line-clamp-2 hover:text-brand transition-colors">
                    {c.title || c.video_id}
                  </a>
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-zinc-500 min-w-0">
                    <span className="truncate">{c.channel_name || c.source_detail}</span>
                    <span className="text-zinc-600">·</span>
                    <span className="tabular-nums whitespace-nowrap">{fmtViews(c.view_count)} 次</span>
                    <span className="text-zinc-600">·</span>
                    <span className="whitespace-nowrap">{fmtDate(c.published_at)}</span>
                  </div>
                  {tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {tags.map((t) => (
                        <button
                          key={t}
                          onClick={() => setTag(t)}
                          className="px-1.5 py-0.5 rounded-md bg-brand/10 text-brand/90 border border-brand/20 text-[11px] cursor-pointer hover:bg-brand/20 transition-colors"
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Selection bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-16 md:bottom-4 inset-x-0 md:left-56 z-40 px-4">
          <div className="max-w-2xl mx-auto flex items-center justify-between gap-3 rounded-xl bg-zinc-800/95 backdrop-blur border border-zinc-700 shadow-xl px-4 py-2.5">
            <span className="text-sm">已選 <span className="text-brand font-semibold">{selected.size}</span> 支</span>
            <div className="flex gap-2">
              <button onClick={() => setSelected(new Set())} className="h-9 px-3 rounded-lg text-sm text-zinc-400 hover:text-white cursor-pointer transition-colors">清除</button>
              <button onClick={() => setPicker(true)} className="h-9 px-4 rounded-lg bg-brand text-black text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity">做成一集</button>
            </div>
          </div>
        </div>
      )}

      {/* Segment picker */}
      {picker && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setPicker(false)}>
          <div className="w-full max-w-md rounded-2xl bg-zinc-900 border border-zinc-700 p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-1">要做成哪個單元？</h3>
            <p className="text-xs text-zinc-500 mb-4">用選中的 {selected.size} 支影片手動生成一集</p>
            <div className="space-y-2">
              {SEGMENTS.map((s) => (
                <button key={s.value} onClick={() => makeEpisode(s.value)} className="w-full text-left px-4 py-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm font-medium cursor-pointer transition-colors">
                  {s.label}<span className="ml-2 text-zinc-500 font-normal">{s.value}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2 text-sm">
              <span className="text-zinc-500 shrink-0">碎碎念長度</span>
              {[12, 15, 18, 21, 25].map((n) => (
                <button key={n} onClick={() => setEpisodeLength(n)} className={`h-7 px-2.5 rounded-md text-xs cursor-pointer transition-colors ${episodeLength === n ? 'bg-brand text-black' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>{n} 分</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-24 md:bottom-20 inset-x-0 z-50 flex justify-center px-4 pointer-events-none">
          <div className="rounded-lg bg-zinc-100 text-black text-sm px-4 py-2 shadow-lg">{toast}</div>
        </div>
      )}
    </div>
  );
}
