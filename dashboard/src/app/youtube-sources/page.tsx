'use client';

import { useEffect, useState } from 'react';

interface YouTubeSource {
  id: number;
  video_id: string;
  title: string;
  channel_name: string;
  published_at: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  used_in_episode: number | null;
  fetched_at: string;
}

const TABS = [
  { key: 'daily', label: 'AI懶人報' },
  { key: 'robot', label: '機器人週報' },
  { key: 'weekly', label: '週報' },
] as const;

export default function YouTubeSourcesPage() {
  const [segment, setSegment] = useState<string>('daily');
  const [rows, setRows] = useState<YouTubeSource[]>([]);
  const [loading, setLoading] = useState(true);

  // Keywords state
  const [allKeywords, setAllKeywords] = useState<Record<string, string[]>>({});
  const [editingKeywords, setEditingKeywords] = useState<string>('');
  const [keywordsOpen, setKeywordsOpen] = useState(false);
  const [keywordsSaving, setKeywordsSaving] = useState(false);
  const [keywordsMsg, setKeywordsMsg] = useState('');

  const fetchData = async (seg: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/youtube-sources?segment=${seg}`);
      const data = await res.json();
      setRows(data);
    } catch {
      setRows([]);
    }
    setLoading(false);
  };

  const fetchKeywords = async () => {
    try {
      const res = await fetch('/api/search-keywords');
      const data = await res.json();
      setAllKeywords(data);
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchData(segment); }, [segment]);
  useEffect(() => { fetchKeywords(); }, []);

  // Sync editingKeywords when segment or allKeywords changes
  useEffect(() => {
    const kws = allKeywords[segment] || [];
    setEditingKeywords(kws.join('\n'));
  }, [segment, allKeywords]);

  const handleReset = async (id: number) => {
    await fetch(`/api/youtube-sources/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segment }),
    });
    fetchData(segment);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('確定要刪除這筆記錄？')) return;
    await fetch(`/api/youtube-sources/${id}?segment=${segment}`, { method: 'DELETE' });
    fetchData(segment);
  };

  const handleSaveKeywords = async () => {
    setKeywordsSaving(true);
    setKeywordsMsg('');
    const updated = {
      ...allKeywords,
      [segment]: editingKeywords.split('\n').map(s => s.trim()).filter(Boolean),
    };
    try {
      const res = await fetch('/api/search-keywords', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (res.ok) {
        setAllKeywords(updated);
        setKeywordsMsg('已儲存');
        setTimeout(() => setKeywordsMsg(''), 2000);
      }
    } catch {
      setKeywordsMsg('儲存失敗');
    }
    setKeywordsSaving(false);
  };

  const currentKeywords = allKeywords[segment] || [];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-4 text-brand-cream">YouTube Sources</h1>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSegment(tab.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              segment === tab.key
                ? 'bg-brand text-black'
                : 'bg-zinc-800 text-zinc-400 hover:text-brand-cream'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Keywords Panel */}
      <div className="mb-6 border border-zinc-800 rounded-lg overflow-hidden">
        <button
          onClick={() => setKeywordsOpen(!keywordsOpen)}
          className="w-full flex items-center justify-between px-4 py-3 bg-zinc-900 hover:bg-zinc-800/80 transition-colors"
        >
          <span className="text-sm font-medium text-brand-cream">
            搜尋關鍵字 ({currentKeywords.length})
          </span>
          <svg
            className={`w-4 h-4 text-zinc-400 transition-transform ${keywordsOpen ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        {keywordsOpen && (
          <div className="px-4 py-3 bg-zinc-900/50 border-t border-zinc-800">
            <p className="text-xs text-zinc-500 mb-2">每行一個關鍵字，pipeline 會用這些關鍵字搜尋 YouTube</p>
            <textarea
              value={editingKeywords}
              onChange={(e) => setEditingKeywords(e.target.value)}
              rows={Math.min(20, Math.max(6, currentKeywords.length + 2))}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-brand-cream font-mono focus:outline-none focus:border-brand/50 resize-y"
            />
            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={handleSaveKeywords}
                disabled={keywordsSaving}
                className="px-4 py-1.5 rounded-lg text-sm font-medium bg-brand text-black hover:bg-brand/80 disabled:opacity-50"
              >
                {keywordsSaving ? '儲存中...' : '儲存'}
              </button>
              {keywordsMsg && (
                <span className="text-xs text-green-400">{keywordsMsg}</span>
              )}
              <span className="text-xs text-zinc-500 ml-auto">
                {editingKeywords.split('\n').filter(s => s.trim()).length} 個關鍵字
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="flex gap-4 mb-4 text-sm text-zinc-400">
        <span>共 {rows.length} 筆</span>
        <span>已使用: {rows.filter(r => r.used_in_episode).length}</span>
        <span>未使用: {rows.filter(r => !r.used_in_episode).length}</span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-zinc-500 py-8 text-center">載入中...</div>
      ) : rows.length === 0 ? (
        <div className="text-zinc-500 py-8 text-center">沒有資料</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-700 text-left text-zinc-400">
                <th className="py-2 pr-3">Title</th>
                <th className="py-2 pr-3">Channel</th>
                <th className="py-2 pr-3">Published</th>
                <th className="py-2 pr-3 text-right">Views</th>
                <th className="py-2 pr-3">Used In</th>
                <th className="py-2 pr-3">Fetched</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-zinc-800 hover:bg-zinc-800/50">
                  <td className="py-2 pr-3 max-w-[300px] truncate">
                    <a
                      href={`https://www.youtube.com/watch?v=${row.video_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-cream hover:text-brand"
                    >
                      {row.title || row.video_id}
                    </a>
                  </td>
                  <td className="py-2 pr-3 text-zinc-400 max-w-[150px] truncate">{row.channel_name}</td>
                  <td className="py-2 pr-3 text-zinc-500 whitespace-nowrap">
                    {row.published_at ? new Date(row.published_at).toLocaleDateString('zh-TW') : '-'}
                  </td>
                  <td className="py-2 pr-3 text-right text-zinc-400">
                    {row.view_count?.toLocaleString() || '-'}
                  </td>
                  <td className="py-2 pr-3">
                    {row.used_in_episode ? (
                      <span className="px-2 py-0.5 rounded text-xs bg-green-900/50 text-green-400">
                        EP {row.used_in_episode}
                      </span>
                    ) : (
                      <span className="text-zinc-600 text-xs">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-zinc-500 whitespace-nowrap">
                    {row.fetched_at ? new Date(row.fetched_at).toLocaleDateString('zh-TW') : '-'}
                  </td>
                  <td className="py-2 whitespace-nowrap">
                    {row.used_in_episode && (
                      <button
                        onClick={() => handleReset(row.id)}
                        className="text-xs px-2 py-1 rounded bg-yellow-900/40 text-yellow-400 hover:bg-yellow-900/60 mr-1"
                      >
                        重設
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(row.id)}
                      className="text-xs px-2 py-1 rounded bg-red-900/40 text-red-400 hover:bg-red-900/60"
                    >
                      刪除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
