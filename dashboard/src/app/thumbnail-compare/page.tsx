'use client';

import { useState, useEffect, useCallback } from 'react';

interface StyleItem {
  id: number;
  name: string;
  bg: string;
  text: string;
  layout: string;
  isEnabled: boolean;
  source: 'seed' | 'generated';
  sampleImageUrl: string | null;
  sampleHookTitle: string | null;
  generatedAt: string | null;
  createdAt: string;
}

export default function ThumbnailComparePage() {
  // Style Manager state
  const [styles, setStyles] = useState<StyleItem[]>([]);
  const [stylesLoading, setStylesLoading] = useState(false);
  const [generatingStyles, setGeneratingStyles] = useState(false);
  const [styleGenCount, setStyleGenCount] = useState(20);
  const [auditioningIds, setAuditioningIds] = useState<Set<number>>(new Set());
  const [auditionProgress, setAuditionProgress] = useState<{ done: number; total: number } | null>(null);
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set());

  // Fetch styles on mount
  const fetchStyles = useCallback(async () => {
    setStylesLoading(true);
    try {
      const res = await fetch('/api/thumbnail-styles');
      const data = await res.json();
      if (data.styles) setStyles(data.styles);
    } catch { /* ignore */ } finally {
      setStylesLoading(false);
    }
  }, []);

  useEffect(() => { fetchStyles(); }, [fetchStyles]);

  const toggleStyle = async (id: number, enable: boolean) => {
    setTogglingIds(prev => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/thumbnail-styles/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled: enable }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error); return; }
      setStyles(prev => prev.map(s => s.id === id ? { ...s, isEnabled: enable } : s));
    } catch { /* ignore */ } finally {
      setTogglingIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  const deleteStyle = async (id: number) => {
    if (!confirm('確定要刪除這個風格？')) return;
    try {
      const res = await fetch(`/api/thumbnail-styles/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) { alert(data.error); return; }
      setStyles(prev => prev.filter(s => s.id !== id));
    } catch { /* ignore */ }
  };

  const generateNewStyles = async (count: number, autoAudition: boolean) => {
    setGeneratingStyles(true);
    try {
      const res = await fetch('/api/thumbnail-styles/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // Refresh full list to get proper DB IDs
      await fetchStyles();

      // Auto-audition all newly generated styles
      if (autoAudition && data.styles?.length > 0) {
        const newIds = data.styles.map((s: { id: number }) => s.id);
        setAuditionProgress({ done: 0, total: newIds.length });
        for (let i = 0; i < newIds.length; i++) {
          setAuditioningIds(prev => new Set(prev).add(newIds[i]));
          try {
            const audRes = await fetch(`/api/thumbnail-styles/${newIds[i]}/audition`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
            });
            const audData = await audRes.json();
            if (audRes.ok) {
              setStyles(prev => prev.map(s =>
                s.id === newIds[i] ? { ...s, sampleImageUrl: audData.sampleImageUrl, sampleHookTitle: audData.hookTitle } : s
              ));
            }
          } catch { /* continue to next */ }
          setAuditioningIds(prev => { const next = new Set(prev); next.delete(newIds[i]); return next; });
          setAuditionProgress({ done: i + 1, total: newIds.length });
        }
        setAuditionProgress(null);
      }
    } catch (err) {
      alert('生成失敗: ' + (err as Error).message);
    } finally {
      setGeneratingStyles(false);
    }
  };

  const auditionStyle = async (id: number) => {
    setAuditioningIds(prev => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/thumbnail-styles/${id}/audition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setStyles(prev => prev.map(s =>
        s.id === id ? { ...s, sampleImageUrl: data.sampleImageUrl, sampleHookTitle: data.hookTitle } : s
      ));
    } catch (err) {
      alert('生成樣本失敗: ' + (err as Error).message);
    } finally {
      setAuditioningIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  const auditionAllWithoutSamples = async () => {
    const noSample = styles.filter(s => !s.sampleImageUrl);
    for (const s of noSample) {
      await auditionStyle(s.id);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-brand-cream">縮圖風格管理</h1>
      <div className="space-y-6">
        {/* === Section 1: Style Pool (enabled styles) === */}
        <div className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-brand-cream">Style Pool</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              生成縮圖時從這裡隨機挑選 ·{' '}
              <span className="text-brand">
                {styles.filter(s => s.isEnabled).length} 個風格
              </span>
            </p>
          </div>

          {stylesLoading ? (
            <div className="text-center py-8 text-zinc-500">載入中...</div>
          ) : styles.filter(s => s.isEnabled).length === 0 ? (
            <div className="text-center py-8 text-zinc-600 text-sm border border-dashed border-zinc-800 rounded-xl">
              Pool 是空的，從下方生成新風格並加入
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {styles
                .filter(s => s.isEnabled)
                .sort((a, b) => a.id - b.id)
                .map(style => (
                  <StyleCard
                    key={style.id}
                    style={style}
                    isToggling={togglingIds.has(style.id)}
                    isAuditioning={auditioningIds.has(style.id)}
                    mode="pool"
                    onDrop={() => toggleStyle(style.id, false)}
                    onAudition={() => auditionStyle(style.id)}
                  />
                ))}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-zinc-800" />

        {/* === Section 2: Generate & Review === */}
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-semibold text-brand-cream">生成新風格</h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                AI 生成風格 + 樣本預覽，喜歡就加入 Pool
                {styles.filter(s => !s.isEnabled).length > 0 && (
                  <span className="text-zinc-400"> · {styles.filter(s => !s.isEnabled).length} 個待審核</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {styles.some(s => !s.sampleImageUrl && !s.isEnabled) && !generatingStyles && (
                <button
                  onClick={auditionAllWithoutSamples}
                  disabled={auditioningIds.size > 0}
                  className="px-3 py-1.5 text-sm bg-zinc-800 text-zinc-300 rounded-lg hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                >
                  {auditioningIds.size > 0 ? `生成樣本中 (${auditioningIds.size})...` : '補生成樣本'}
                </button>
              )}
              <select
                value={styleGenCount}
                onChange={(e) => setStyleGenCount(Number(e.target.value))}
                disabled={generatingStyles}
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-brand-cream focus:outline-none focus:border-brand"
              >
                {[5, 10, 15, 20, 25, 30].map(n => (
                  <option key={n} value={n}>{n} 個</option>
                ))}
              </select>
              <button
                onClick={() => generateNewStyles(styleGenCount, true)}
                disabled={generatingStyles || auditionProgress !== null}
                className="px-4 py-1.5 text-sm bg-brand text-zinc-900 font-semibold rounded-lg hover:bg-brand/90 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {generatingStyles && !auditionProgress ? 'AI 生成風格中...' : '生成 + 預覽'}
              </button>
            </div>
          </div>

          {/* Progress bar */}
          {auditionProgress && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-zinc-400">
                <span>生成樣本圖中...</span>
                <span>{auditionProgress.done}/{auditionProgress.total}</span>
              </div>
              <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand rounded-full transition-all duration-300"
                  style={{ width: `${(auditionProgress.done / auditionProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {styles.filter(s => !s.isEnabled).length === 0 && !generatingStyles ? (
            <div className="text-center py-8 text-zinc-600 text-sm border border-dashed border-zinc-800 rounded-xl">
              按上方「生成 + 預覽」來產生新風格
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {styles
                .filter(s => !s.isEnabled)
                .sort((a, b) => b.id - a.id)
                .map(style => (
                  <StyleCard
                    key={style.id}
                    style={style}
                    isToggling={togglingIds.has(style.id)}
                    isAuditioning={auditioningIds.has(style.id)}
                    mode="review"
                    onAdd={() => toggleStyle(style.id, true)}
                    onDrop={() => deleteStyle(style.id)}
                    onAudition={() => auditionStyle(style.id)}
                  />
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function StyleCard({
  style,
  isToggling,
  isAuditioning,
  mode,
  onAdd,
  onDrop,
  onAudition,
}: {
  style: StyleItem;
  isToggling: boolean;
  isAuditioning: boolean;
  mode: 'pool' | 'review';
  onAdd?: () => void;
  onDrop: () => void;
  onAudition: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`bg-zinc-900 rounded-xl border overflow-hidden transition-colors ${
      mode === 'pool' ? 'border-brand/40' : 'border-zinc-800'
    }`}>
      {/* Sample image or placeholder */}
      <div className="aspect-video bg-zinc-950 flex items-center justify-center relative group">
        {isAuditioning ? (
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-zinc-500">生成樣本中...</span>
          </div>
        ) : style.sampleImageUrl ? (
          <>
            <img
              src={style.sampleImageUrl + '&t=' + encodeURIComponent(style.createdAt)}
              alt={style.name}
              className="w-full h-full object-contain"
            />
            {/* Regenerate overlay on hover */}
            <button
              onClick={onAudition}
              className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
            >
              <span className="text-xs text-white bg-zinc-800/80 px-2 py-1 rounded">重新生成</span>
            </button>
          </>
        ) : (
          <button
            onClick={onAudition}
            disabled={isAuditioning}
            className="text-center px-4 hover:bg-zinc-900 transition-colors w-full h-full flex items-center justify-center"
          >
            <span className="text-zinc-600 text-xs">點擊生成樣本</span>
          </button>
        )}
        {/* Source badge */}
        <span className={`absolute top-2 left-2 px-1.5 py-0.5 text-[10px] rounded pointer-events-none ${
          style.source === 'seed' ? 'bg-zinc-700 text-zinc-400' : 'bg-purple-900/60 text-purple-300'
        }`}>
          {style.source === 'seed' ? '內建' : 'AI 生成'}
        </span>
      </div>

      {/* Info & controls */}
      <div className="p-2.5 space-y-1.5">
        <div className="flex items-start justify-between gap-1">
          <span className="text-xs font-medium text-brand-cream leading-tight">{style.name}</span>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors shrink-0"
            title={expanded ? '收起' : '展開描述'}
          >
            {expanded ? '▲' : '▼'}
          </button>
        </div>

        {expanded && (
          <div className="text-[10px] text-zinc-500 space-y-0.5">
            <p><span className="text-zinc-400">BG:</span> {style.bg}</p>
            <p><span className="text-zinc-400">Text:</span> {style.text}</p>
            <p><span className="text-zinc-400">Layout:</span> {style.layout}</p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-1.5 pt-0.5">
          {mode === 'review' && onAdd && (
            <button
              onClick={onAdd}
              disabled={isToggling}
              className="flex-1 px-2 py-1.5 text-xs font-medium bg-brand text-zinc-900 rounded-lg hover:bg-brand/90 disabled:opacity-50 transition-colors"
            >
              {isToggling ? '...' : '加入 Pool'}
            </button>
          )}
          <button
            onClick={onDrop}
            disabled={isToggling}
            className={`px-2 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-50 ${
              mode === 'pool'
                ? 'flex-1 bg-zinc-800 text-zinc-400 hover:bg-red-950 hover:text-red-400'
                : 'bg-zinc-800 text-zinc-500 hover:bg-red-950 hover:text-red-400'
            }`}
          >
            {isToggling ? '...' : mode === 'pool' ? 'Drop' : 'Drop'}
          </button>
        </div>
      </div>
    </div>
  );
}
