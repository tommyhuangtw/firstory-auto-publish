'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

type SegmentType = 'daily' | 'weekly' | 'robot' | 'sysdesign';

const SEGMENT_OPTIONS: { value: SegmentType; label: string }[] = [
  { value: 'daily', label: '日報' },
  { value: 'weekly', label: '週報' },
  { value: 'robot', label: '機器人' },
  { value: 'sysdesign', label: '系統設計' },
];

const SEGMENT_LABELS: Record<string, string> = {
  daily: '日報', weekly: '週報', robot: '機器人', sysdesign: '系統設計',
};

interface Episode {
  id: number;
  episode_number: number | null;
  selected_title: string | null;
  segment_type: string;
  script_summary: string | null;
  status: string;
  created_at: string;
}

interface ThumbnailResult {
  url: string;
  method: string;
  style?: string;
  loading: boolean;
  error?: string;
}

interface HistoryEntry {
  id: string;
  hookText: string;
  segmentType: string;
  episodeLabel?: string;
  createdAt: string;
  results: {
    method: string;
    label: string;
    url: string;
  }[];
}

const STORAGE_KEY = 'thumbnail-compare-history';

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]) {
  // Keep max 20 entries
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, 20)));
}

const EMPTY_RESULT = (method: string): ThumbnailResult => ({
  url: '', method, loading: false,
});

export default function ThumbnailComparePage() {
  const [hookText, setHookText] = useState('免費寫 Code');
  const [segmentType, setSegmentType] = useState<SegmentType>('daily');
  const [episodeSummary, setEpisodeSummary] = useState('');
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string>('');
  const [episodeLabel, setEpisodeLabel] = useState('');

  const [shortenLoading, setShortenLoading] = useState(false);
  const [hookCandidates, setHookCandidates] = useState<string[]>([]);

  const [remotion, setRemotion] = useState<ThumbnailResult>(EMPTY_RESULT('remotion'));
  const [gptT2I, setGptT2I] = useState<ThumbnailResult>(EMPTY_RESULT('gpt-t2i'));
  const [gptI2I, setGptI2I] = useState<ThumbnailResult>(EMPTY_RESULT('gpt-i2i'));

  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // Load history on mount
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  // Fetch episodes on mount
  useEffect(() => {
    fetch('/api/episodes?limit=100')
      .then((r) => r.json())
      .then((data) => {
        const eps = (data.episodes || []) as Episode[];
        eps.sort((a, b) => (b.episode_number ?? 0) - (a.episode_number ?? 0));
        setEpisodes(eps);
      })
      .catch(() => {});
  }, []);

  const handleEpisodeSelect = (epId: string) => {
    setSelectedEpisodeId(epId);
    if (!epId) { setEpisodeLabel(''); return; }
    const ep = episodes.find((e) => e.id === parseInt(epId));
    if (!ep) return;
    if (['daily', 'weekly', 'robot', 'sysdesign'].includes(ep.segment_type)) {
      setSegmentType(ep.segment_type as SegmentType);
    }
    if (ep.selected_title) setHookText(ep.selected_title);
    if (ep.script_summary) setEpisodeSummary(ep.script_summary);
    setEpisodeLabel(`EP${ep.episode_number ?? '?'}`);
  };

  const shortenTitle = async () => {
    if (!hookText.trim() || shortenLoading) return;
    setShortenLoading(true);
    setHookCandidates([]);
    try {
      const res = await fetch('/api/thumbnail-compare/shorten-title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: hookText, segmentType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.candidates?.length) setHookCandidates(data.candidates);
    } catch {
      // silently fail
    } finally {
      setShortenLoading(false);
    }
  };

  // Track completed count for saving to history
  const pendingResultsRef = useRef<{
    hookText: string; segmentType: string; episodeLabel: string;
    results: Map<string, { url: string }>;
    expected: number;
  } | null>(null);

  const checkAndSaveHistory = useCallback(() => {
    const pending = pendingResultsRef.current;
    if (!pending || pending.results.size < pending.expected) return;

    const entry: HistoryEntry = {
      id: Date.now().toString(),
      hookText: pending.hookText,
      segmentType: pending.segmentType,
      episodeLabel: pending.episodeLabel || undefined,
      createdAt: new Date().toISOString(),
      results: [
        { method: 'remotion', label: 'Remotion', ...(pending.results.get('remotion') || { url: '' }) },
        { method: 'gpt-t2i', label: 'GPT T2I', ...(pending.results.get('gpt-t2i') || { url: '' }) },
        { method: 'gpt-i2i', label: 'GPT I2I', ...(pending.results.get('gpt-i2i') || { url: '' }) },
      ].filter((r) => r.url),
    };

    if (entry.results.length > 0) {
      setHistory((prev) => {
        const next = [entry, ...prev];
        saveHistory(next);
        return next.slice(0, 20);
      });
    }
    pendingResultsRef.current = null;
  }, []);

  const recordResult = useCallback((method: string, url: string) => {
    if (!pendingResultsRef.current) return;
    pendingResultsRef.current.results.set(method, { url });
    checkAndSaveHistory();
  }, [checkAndSaveHistory]);

  const generateRemotion = async (saveToHistory = true) => {
    setRemotion((prev) => ({ ...prev, loading: true, error: undefined }));
    try {
      const res = await fetch('/api/thumbnail-compare/remotion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hookText, segmentType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const url = data.url + '&t=' + Date.now();
      setRemotion({ url, method: 'remotion', loading: false });
      if (saveToHistory) recordResult('remotion', url);
    } catch (err) {
      setRemotion((prev) => ({ ...prev, loading: false, error: (err as Error).message }));
      if (saveToHistory) recordResult('remotion', ''); // mark as done even on error
    }
  };

  const generateGptImage = async (
    mode: 'text-to-image' | 'image-to-image',
    setter: React.Dispatch<React.SetStateAction<ThumbnailResult>>,
    methodLabel: string,
    saveToHistory = true,
  ) => {
    setter((prev) => ({ ...prev, loading: true, error: undefined }));
    try {
      const res = await fetch('/api/thumbnail-compare/gpt-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hookText, segmentType,
          episodeSummary: episodeSummary || undefined,
          mode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const url = data.url + '&t=' + Date.now();
      setter({ url, method: methodLabel, style: data.style, loading: false });
      if (saveToHistory) recordResult(methodLabel, url);
    } catch (err) {
      setter((prev) => ({ ...prev, loading: false, error: (err as Error).message }));
      if (saveToHistory) recordResult(methodLabel, '');
    }
  };

  const generateAll = () => {
    // Set up pending tracking
    pendingResultsRef.current = {
      hookText, segmentType, episodeLabel,
      results: new Map(),
      expected: 3,
    };
    generateRemotion();
    generateGptImage('text-to-image', setGptT2I, 'gpt-t2i');
    generateGptImage('image-to-image', setGptI2I, 'gpt-i2i');
  };

  const deleteHistoryEntry = (id: string) => {
    setHistory((prev) => {
      const next = prev.filter((e) => e.id !== id);
      saveHistory(next);
      return next;
    });
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const isLoading = remotion.loading || gptT2I.loading || gptI2I.loading;

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-brand-cream">縮圖方式比較</h1>

      {/* Input form */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 space-y-4">
        <div>
          <label className="block text-sm text-zinc-400 mb-1">
            選擇 Episode（自動帶入標題、摘要、segment type）
          </label>
          <select
            value={selectedEpisodeId}
            onChange={(e) => handleEpisodeSelect(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-brand-cream focus:outline-none focus:border-brand"
          >
            <option value="">-- 手動輸入 --</option>
            {episodes.map((ep) => (
              <option key={ep.id} value={ep.id}>
                EP{ep.episode_number ?? '?'} — {ep.selected_title || '(無標題)'} [{ep.segment_type}]
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-zinc-400 mb-1">Hook 文字</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={hookText}
                onChange={(e) => setHookText(e.target.value)}
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-brand-cream focus:outline-none focus:border-brand"
                placeholder="4-8 字的吸睛標題"
              />
              <button
                onClick={shortenTitle}
                disabled={shortenLoading || !hookText.trim()}
                className="px-3 py-2 text-sm bg-zinc-700 text-zinc-300 rounded-lg hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                title="用 Gemini Flash Lite 縮短標題"
              >
                {shortenLoading ? '...' : 'AI 縮短'}
              </button>
            </div>
            {hookText.length > 8 && hookCandidates.length === 0 && (
              <p className="text-xs text-amber-500 mt-1">
                建議 4-8 字，目前 {hookText.length} 字 — 點「AI 縮短」產生候選
              </p>
            )}
            {hookCandidates.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {hookCandidates.map((c, i) => (
                  <button
                    key={i}
                    onClick={() => { setHookText(c); setHookCandidates([]); }}
                    className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                      c === hookText
                        ? 'border-brand bg-brand/20 text-brand'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-brand hover:text-brand-cream'
                    }`}
                  >
                    {c}
                    <span className="text-zinc-500 ml-1 text-xs">{c.length}字</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm text-zinc-400 mb-1">Segment Type</label>
            <select
              value={segmentType}
              onChange={(e) => setSegmentType(e.target.value as SegmentType)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-brand-cream focus:outline-none focus:border-brand"
            >
              {SEGMENT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm text-zinc-400 mb-1">
            Episode 摘要（可選，GPT Image 會用來生成更相關的背景）
          </label>
          <textarea
            value={episodeSummary}
            onChange={(e) => setEpisodeSummary(e.target.value)}
            rows={2}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-brand-cream focus:outline-none focus:border-brand resize-none"
            placeholder="貼上 episode 的摘要或關鍵內容..."
          />
        </div>

        <button
          onClick={generateAll}
          disabled={isLoading || !hookText.trim()}
          className="px-6 py-2.5 bg-brand text-zinc-900 font-semibold rounded-lg hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? '生成中...' : '生成比較（3 種）'}
        </button>
      </div>

      {/* Results — 3 columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <ThumbnailCard
          title="Remotion"
          subtitle="React 模板渲染，免費、可預測"
          result={remotion}
          onRegenerate={() => generateRemotion(false)}
        />
        <ThumbnailCard
          title="GPT Image — Text-to-Image"
          subtitle="AI 生成完整縮圖（含文字），無樹懶角色"
          result={gptT2I}
          onRegenerate={() => generateGptImage('text-to-image', setGptT2I, 'gpt-t2i', false)}
        />
        <ThumbnailCard
          title="GPT Image — Image-to-Image"
          subtitle="AI 生成完整縮圖（含文字 + 湯懶懶角色）"
          result={gptI2I}
          onRegenerate={() => generateGptImage('image-to-image', setGptI2I, 'gpt-i2i', false)}
        />
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-brand-cream">歷史紀錄</h2>
            <button
              onClick={clearHistory}
              className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
            >
              清除全部
            </button>
          </div>

          {history.map((entry) => (
            <div
              key={entry.id}
              className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-brand-cream font-medium">
                    {entry.episodeLabel && (
                      <span className="text-brand mr-2">{entry.episodeLabel}</span>
                    )}
                    「{entry.hookText}」
                    <span className="text-zinc-500 ml-2">
                      {SEGMENT_LABELS[entry.segmentType] || entry.segmentType}
                    </span>
                  </p>
                  <p className="text-xs text-zinc-600 mt-0.5">
                    {new Date(entry.createdAt).toLocaleString('zh-TW')}
                  </p>
                </div>
                <button
                  onClick={() => deleteHistoryEntry(entry.id)}
                  className="text-zinc-600 hover:text-red-400 transition-colors shrink-0"
                  title="刪除"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {entry.results.map((r) => (
                  <div key={r.method}>
                    <p className="text-xs text-zinc-500 mb-1">{r.label}</p>
                    {r.url ? (
                      <img
                        src={r.url}
                        alt={r.label}
                        className="w-full rounded-lg aspect-video object-contain bg-zinc-950"
                      />
                    ) : (
                      <div className="w-full rounded-lg aspect-video bg-zinc-950 flex items-center justify-center">
                        <span className="text-xs text-zinc-600">失敗</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ThumbnailCard({
  title,
  subtitle,
  result,
  onRegenerate,
}: {
  title: string;
  subtitle: string;
  result: ThumbnailResult;
  onRegenerate: () => void;
}) {
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      <div className="p-4 border-b border-zinc-800">
        <h2 className="text-base font-semibold text-brand-cream">{title}</h2>
        <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>
        {result.style && (
          <span className="inline-block mt-1 px-2 py-0.5 text-[10px] bg-zinc-800 text-zinc-400 rounded-full">
            style: {result.style}
          </span>
        )}
      </div>

      <div className="aspect-video bg-zinc-950 flex items-center justify-center">
        {result.loading ? (
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-zinc-500">生成中...</span>
          </div>
        ) : result.error ? (
          <div className="text-center px-4">
            <p className="text-red-400 text-sm">{result.error}</p>
          </div>
        ) : result.url ? (
          <img src={result.url} alt={title} className="w-full h-full object-contain" />
        ) : (
          <span className="text-zinc-600 text-sm">尚未生成</span>
        )}
      </div>

      <div className="p-3 border-t border-zinc-800">
        <button
          onClick={onRegenerate}
          disabled={result.loading}
          className="px-4 py-1.5 text-sm bg-zinc-800 text-zinc-300 rounded-lg hover:bg-zinc-700 disabled:opacity-50 transition-colors"
        >
          重新生成
        </button>
      </div>
    </div>
  );
}
