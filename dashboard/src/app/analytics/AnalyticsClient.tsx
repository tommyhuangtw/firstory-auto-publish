'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

// ---------- Types ----------

interface DailyDownload {
  date: string;
  downloads: number;
  unique_downloads: number;
}

interface EpisodeRow {
  episode_number: number | null;
  title: string;
  publish_type: string;
  total_downloads: number;
  downloads_7d: number;
  downloads_30d: number;
  duration_sec: number;
  published_at: string;
}

interface WeeklyAverage {
  week: string;
  avg_downloads: number;
  avg_unique: number;
}

interface Summary {
  totalDownloads: number;
  totalUniqueDownloads: number;
  avgDailyUniqueDownloads: number;
  maxDay: { date: string; unique_downloads: number } | null;
  wowGrowth: number | null;
  totalEpisodes: number;
  cumulativeEpisodeDownloads: number;
  avgDownloadsPerEpisode: number;
}

interface AnalyticsData {
  dailyDownloads: DailyDownload[];
  episodes: EpisodeRow[];
  weeklyAverages: WeeklyAverage[];
  summary: Summary;
}

type Tab = 'trend' | 'ranking' | 'analysis';
type Range = '7d' | '30d' | '90d' | '360d' | 'all';
type SortKey = 'episode_number' | 'total_downloads' | 'downloads_7d' | 'downloads_30d' | 'duration_sec' | 'published_at';
type SortDir = 'asc' | 'desc';

// ---------- Component ----------

export default function AnalyticsClient() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('trend');
  const [range, setRange] = useState<Range>('30d');
  const [sort, setSort] = useState('total_downloads');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const [tableSort, setTableSort] = useState<SortKey | null>(null);
  const [tableSortDir, setTableSortDir] = useState<SortDir>('desc');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/analytics?range=${range}&sort=${sort}&order=desc`);
      const json = await res.json();
      setData(json);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [range, sort]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const sortedEpisodes = useMemo(() => {
    if (!data?.episodes) return [];
    if (!tableSort) return data.episodes;
    return [...data.episodes].sort((a, b) => {
      const key = tableSort;
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return tableSortDir === 'asc' ? cmp : -cmp;
    });
  }, [data?.episodes, tableSort, tableSortDir]);

  const handleTableSort = (key: SortKey) => {
    if (tableSort === key) {
      setTableSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setTableSort(key);
      setTableSortDir('desc');
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadResult(null);
    const results: string[] = [];

    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append('file', file);
      try {
        const res = await fetch('/api/analytics/upload', { method: 'POST', body: form });
        const json = await res.json();
        if (json.success) {
          results.push(`${file.name}: ${json.imported} 筆 (${json.format})`);
        } else {
          results.push(`${file.name}: 錯誤 - ${json.error}`);
        }
      } catch {
        results.push(`${file.name}: 上傳失敗`);
      }
    }

    setUploadResult(results.join('\n'));
    setUploading(false);
    fetchData();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const hasData = data && (data.dailyDownloads.length > 0 || data.episodes.length > 0);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'trend', label: '下載趨勢' },
    { key: 'ranking', label: '集數排行' },
    { key: 'analysis', label: '趨勢分析' },
  ];

  const ranges: { key: Range; label: string }[] = [
    { key: '7d', label: '7天' },
    { key: '30d', label: '30天' },
    { key: '90d', label: '90天' },
    { key: '360d', label: '360天' },
    { key: 'all', label: '全部' },
  ];

  const formatDate = (d: string) => {
    const parts = d.split('-');
    return `${parts[1]}/${parts[2]}`;
  };

  return (
    <div className="space-y-6">
      {/* Header + Upload */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span className="w-1 h-6 rounded-full bg-brand" />
            節目分析
          </h1>
          <p className="text-brand-taupe text-sm mt-1">SoundOn 下載數據分析</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            multiple
            onChange={(e) => handleUpload(e.target.files)}
            className="hidden"
            id="csv-upload"
          />
          <label
            htmlFor="csv-upload"
            className={`px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
              uploading
                ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed'
                : 'bg-brand/20 text-brand hover:bg-brand/30 border border-brand/30'
            }`}
          >
            {uploading ? '上傳中...' : '上傳 CSV'}
          </label>
        </div>
      </div>

      {uploadResult && (
        <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 text-sm text-zinc-300 whitespace-pre-line">
          {uploadResult}
        </div>
      )}

      {!hasData && !loading && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-12 text-center">
          <p className="text-zinc-400 text-lg mb-2">尚無分析數據</p>
          <p className="text-zinc-500 text-sm">上傳 SoundOn CSV 檔案以開始分析</p>
        </div>
      )}

      {hasData && data && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <SummaryCard
              label="累積不重複下載數"
              value={data.summary.cumulativeEpisodeDownloads.toLocaleString()}
            />
            <SummaryCard
              label="平均單集不重複下載數"
              value={data.summary.avgDownloadsPerEpisode.toLocaleString()}
            />
            <SummaryCard
              label="已發佈集數"
              value={data.summary.totalEpisodes.toLocaleString()}
            />
            <SummaryCard
              label="單日最高不重複下載"
              value={data.summary.maxDay ? data.summary.maxDay.unique_downloads.toLocaleString() : '—'}
              sub={data.summary.maxDay ? data.summary.maxDay.date : undefined}
            />
            <SummaryCard
              label="週環比成長"
              value={data.summary.wowGrowth !== null ? `${data.summary.wowGrowth > 0 ? '+' : ''}${data.summary.wowGrowth}%` : '—'}
              highlight={data.summary.wowGrowth !== null ? (data.summary.wowGrowth >= 0 ? 'green' : 'red') : undefined}
            />
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-zinc-800">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  tab === t.key
                    ? 'text-brand border-brand'
                    : 'text-zinc-400 border-transparent hover:text-zinc-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          {tab === 'trend' && (
            <div className="space-y-4">
              {/* Range selector */}
              <div className="flex gap-1 border-b border-zinc-800/50 pb-2">
                {ranges.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setRange(r.key)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-[9px] ${
                      range === r.key
                        ? 'text-brand border-brand'
                        : 'text-zinc-500 border-transparent hover:text-zinc-300'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>

              <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                <h3 className="text-sm font-medium text-zinc-300 uppercase tracking-wider mb-4">每日下載量</h3>
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart data={data.dailyDownloads}>
                    <defs>
                      <linearGradient id="gradDown" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradUnique" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatDate}
                      tick={{ fill: '#a1a1aa', fontSize: 11 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis tick={{ fill: '#a1a1aa', fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: 8 }}
                      labelStyle={{ color: '#e4e4e7' }}
                    />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="downloads"
                      name="下載數"
                      stroke="#3b82f6"
                      fill="url(#gradDown)"
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="unique_downloads"
                      name="不重複下載數"
                      stroke="#22c55e"
                      fill="url(#gradUnique)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {tab === 'ranking' && (
            <div className="space-y-4">
              {/* Sort selector */}
              <div className="flex gap-1 border-b border-zinc-800/50 pb-2">
                {[
                  { key: 'total_downloads', label: '總下載' },
                  { key: 'downloads_7d', label: '7天下載' },
                  { key: 'downloads_30d', label: '30天下載' },
                  { key: 'published_at', label: '最新發佈' },
                ].map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setSort(s.key)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-[9px] ${
                      sort === s.key
                        ? 'text-brand border-brand'
                        : 'text-zinc-500 border-transparent hover:text-zinc-300'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* Top 20 bar chart */}
              {(() => {
                const chartMeta: Record<string, { title: string; dataKey: string; label: string; color: string }> = {
                  total_downloads: { title: 'TOP 20 — 總下載數', dataKey: 'total_downloads', label: '總下載數', color: '#3b82f6' },
                  downloads_7d: { title: 'TOP 20 — 近 7 天下載數', dataKey: 'downloads_7d', label: '7 天下載數', color: '#22c55e' },
                  downloads_30d: { title: 'TOP 20 — 近 30 天下載數', dataKey: 'downloads_30d', label: '30 天下載數', color: '#a855f7' },
                  published_at: { title: '最近 20 集', dataKey: 'total_downloads', label: '總下載數', color: '#64748b' },
                };
                const cm = chartMeta[sort] || chartMeta.total_downloads;
                const chartData = data.episodes.slice(0, 20).map(ep => ({
                  ...ep,
                  shortTitle: `EP${ep.episode_number ?? '?'} - ${ep.title.length > 30 ? ep.title.slice(0, 30) + '…' : ep.title}`,
                }));
                return (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                    <h3 className="text-sm font-medium text-zinc-300 uppercase tracking-wider mb-4">{cm.title}</h3>
                    <ResponsiveContainer width="100%" height={520}>
                      <BarChart
                        data={chartData}
                        layout="vertical"
                        margin={{ left: 10, right: 20 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                        <XAxis type="number" tick={{ fill: '#a1a1aa', fontSize: 11 }} />
                        <YAxis
                          type="category"
                          dataKey="shortTitle"
                          width={260}
                          tick={{ fill: '#a1a1aa', fontSize: 11 }}
                        />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: 8 }}
                          labelStyle={{ color: '#e4e4e7', fontSize: 12 }}
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          formatter={(value: any) => [Number(value).toLocaleString(), cm.label]}
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          labelFormatter={(_: any, payload: any) =>
                            payload?.[0]?.payload?.title || ''
                          }
                        />
                        <Bar dataKey={cm.dataKey} name={cm.label} fill={cm.color} radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                );
              })()}

              {/* Episode table */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-400 text-left">
                        <SortTh label="#" sortKey="episode_number" active={tableSort} dir={tableSortDir} onClick={handleTableSort} />
                        <th className="px-4 py-3 font-medium">標題</th>
                        <SortTh label="總下載" sortKey="total_downloads" active={tableSort} dir={tableSortDir} onClick={handleTableSort} align="right" />
                        <SortTh label="7天" sortKey="downloads_7d" active={tableSort} dir={tableSortDir} onClick={handleTableSort} align="right" />
                        <SortTh label="30天" sortKey="downloads_30d" active={tableSort} dir={tableSortDir} onClick={handleTableSort} align="right" />
                        <SortTh label="時長" sortKey="duration_sec" active={tableSort} dir={tableSortDir} onClick={handleTableSort} align="right" />
                        <SortTh label="發佈日期" sortKey="published_at" active={tableSort} dir={tableSortDir} onClick={handleTableSort} />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedEpisodes.map((ep, i) => (
                        <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                          <td className="px-4 py-2.5 text-zinc-500">
                            {ep.episode_number ?? '—'}
                          </td>
                          <td className="px-4 py-2.5 text-zinc-200 max-w-xs truncate" title={ep.title}>
                            {ep.title}
                          </td>
                          <td className="px-4 py-2.5 text-right text-zinc-200 font-medium">
                            {ep.total_downloads.toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-right text-zinc-400">
                            {ep.downloads_7d.toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-right text-zinc-400">
                            {ep.downloads_30d.toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-right text-zinc-500">
                            {formatDuration(ep.duration_sec)}
                          </td>
                          <td className="px-4 py-2.5 text-zinc-500 whitespace-nowrap">
                            {ep.published_at ? ep.published_at.slice(0, 10) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {tab === 'analysis' && (
            <div className="space-y-4">
              {/* Weekly trend */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                <h3 className="text-sm font-medium text-zinc-300 uppercase tracking-wider mb-4">每週平均下載量</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={data.weeklyAverages}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis
                      dataKey="week"
                      tickFormatter={formatDate}
                      tick={{ fill: '#a1a1aa', fontSize: 11 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis tick={{ fill: '#a1a1aa', fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: 8 }}
                      labelStyle={{ color: '#e4e4e7' }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="avg_downloads"
                      name="平均下載數"
                      stroke="#f97316"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="avg_unique"
                      name="平均不重複下載數"
                      stroke="#a855f7"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Episode stats */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-zinc-300 uppercase tracking-wider mb-3">集數統計</h3>
                  <div className="space-y-2 text-sm">
                    <StatRow label="已發佈集數" value={data.summary.totalEpisodes.toString()} />
                    <StatRow label="平均單集下載數" value={data.summary.avgDownloadsPerEpisode.toLocaleString()} />
                    <StatRow
                      label="最高下載集數"
                      value={data.episodes.length > 0 ? `${data.episodes[0].total_downloads.toLocaleString()} 次` : '—'}
                    />
                    <StatRow
                      label="最高下載標題"
                      value={data.episodes.length > 0 ? data.episodes[0].title : '—'}
                      truncate
                    />
                  </div>
                </div>

                <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-zinc-300 uppercase tracking-wider mb-3">下載數據摘要</h3>
                  <div className="space-y-2 text-sm">
                    <StatRow label="不重複下載數" value={data.summary.totalUniqueDownloads.toLocaleString()} />
                    <StatRow label="總下載數" value={data.summary.totalDownloads.toLocaleString()} />
                    <StatRow
                      label="不重複比例"
                      value={data.summary.totalDownloads > 0
                        ? `${Math.round((data.summary.totalUniqueDownloads / data.summary.totalDownloads) * 100)}%`
                        : '—'
                      }
                    />
                    <StatRow
                      label="週環比成長"
                      value={data.summary.wowGrowth !== null ? `${data.summary.wowGrowth > 0 ? '+' : ''}${data.summary.wowGrowth}%` : '—'}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {loading && (
        <div className="text-center py-12 text-zinc-500">載入中...</div>
      )}
    </div>
  );
}

// ---------- Sub-components ----------

function SummaryCard({ label, value, sub, highlight }: {
  label: string;
  value: string;
  sub?: string;
  highlight?: 'green' | 'red';
}) {
  const valueColor = highlight === 'green' ? 'text-green-400' : highlight === 'red' ? 'text-red-400' : 'text-zinc-100';
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <p className="text-xs text-brand-taupe uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-xl font-bold ${valueColor}`}>{value}</p>
      {sub && <p className="text-xs text-zinc-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function StatRow({ label, value, truncate }: { label: string; value: string; truncate?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-zinc-500">{label}</span>
      <span className={`text-zinc-200 ${truncate ? 'max-w-[200px] truncate' : ''}`} title={truncate ? value : undefined}>
        {value}
      </span>
    </div>
  );
}

function SortTh({ label, sortKey, active, dir, onClick, align }: {
  label: string;
  sortKey: SortKey;
  active: SortKey | null;
  dir: SortDir;
  onClick: (key: SortKey) => void;
  align?: 'right';
}) {
  const isActive = active === sortKey;
  return (
    <th
      className={`px-4 py-3 font-medium cursor-pointer select-none hover:text-zinc-200 transition-colors ${align === 'right' ? 'text-right' : ''} ${isActive ? 'text-brand' : ''}`}
      onClick={() => onClick(sortKey)}
    >
      {label}
      {isActive && (
        <span className="ml-1 text-xs">{dir === 'desc' ? '▼' : '▲'}</span>
      )}
    </th>
  );
}

function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
