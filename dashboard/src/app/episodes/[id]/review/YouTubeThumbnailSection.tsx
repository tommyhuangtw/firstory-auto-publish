'use client';

import { useState, useEffect } from 'react';

interface ThumbnailOption {
  path: string;
  url: string;
  style: string;
}

interface Props {
  episodeId: number;
  selectedTitle: string;
  savedHookTitle: string | null;
  savedThumbnailPath: string | null;
  hookTitleHistory: { titles: string[]; ts: string }[];
  canEdit: boolean;
}

export default function YouTubeThumbnailSection({
  episodeId,
  selectedTitle,
  savedHookTitle,
  savedThumbnailPath,
  hookTitleHistory: initialHookTitleHistory,
  canEdit,
}: Props) {
  const [hookTitle, setHookTitle] = useState(savedHookTitle || '');
  const [candidates, setCandidates] = useState<string[]>([]);
  const [hookTitleHistory, setHookTitleHistory] = useState(initialHookTitleHistory);
  const [showHookHistory, setShowHookHistory] = useState(false);
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  const [thumbnails, setThumbnails] = useState<ThumbnailOption[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const loadingThumbnails = pendingCount > 0;
  const [selectedPath, setSelectedPath] = useState<string | null>(savedThumbnailPath || null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(!!savedThumbnailPath);
  const [expanded, setExpanded] = useState(true);
  const [customPromptFor, setCustomPromptFor] = useState<string | null>(null); // style name
  const [customPrompt, setCustomPrompt] = useState('');

  // Load existing thumbnails from filesystem on mount
  useEffect(() => {
    fetch(`/api/episodes/${episodeId}/yt-thumbnail/generate`)
      .then((res) => res.json())
      .then((data) => {
        if (data.thumbnails?.length) {
          setThumbnails(data.thumbnails);
        }
      })
      .catch(() => {});
  }, [episodeId]);

  const generateHookTitles = async () => {
    setLoadingCandidates(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/yt-thumbnail/hook-titles`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const newCandidates = data.candidates || [];
      // Push current batch to local history before replacing
      if (candidates.length > 0) {
        setHookTitleHistory(prev => [{ titles: candidates, ts: new Date().toISOString() }, ...prev]);
      }
      setCandidates(newCandidates);
    } catch {
      // silently fail
    } finally {
      setLoadingCandidates(false);
    }
  };

  const generateThumbnails = async (title?: string, styleName?: string, extraPrompt?: string, referenceImagePath?: string) => {
    const hook = title || hookTitle;
    if (!hook.trim()) return;
    setPendingCount((c) => c + 1);
    setExpanded(true);
    try {
      const body: Record<string, string> = { hookTitle: hook };
      if (styleName) body.styleName = styleName;
      if (extraPrompt?.trim()) body.extraPrompt = extraPrompt.trim();
      if (referenceImagePath) body.referenceImagePath = referenceImagePath;
      const res = await fetch(`/api/episodes/${episodeId}/yt-thumbnail/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const newThumbnails = data.thumbnails || [];
      setThumbnails((prev) => [...newThumbnails, ...prev]);
    } catch {
      // silently fail
    } finally {
      setPendingCount((c) => c - 1);
    }
  };

  const [selectError, setSelectError] = useState<string | null>(null);

  const selectThumbnail = async (thumb: ThumbnailOption) => {
    const prevPath = selectedPath;
    setSelectedPath(thumb.path);
    setSaving(true);
    setSelectError(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/yt-thumbnail/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thumbnailPath: thumb.path,
          hookTitle: hookTitle,
        }),
      });
      if (res.ok) {
        setSaved(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setSelectedPath(prevPath);
        setSelectError(data.error || '儲存失敗');
      }
    } catch {
      setSelectedPath(prevPath);
      setSelectError('網路錯誤，請重試');
    } finally {
      setSaving(false);
    }
  };

  const selectHookTitle = (title: string) => {
    setHookTitle(title);
  };

  // Build the saved thumbnail as a ThumbnailOption if not already in the list
  const savedInList = savedThumbnailPath && thumbnails.some((t) => t.path === savedThumbnailPath);
  const allThumbnails: ThumbnailOption[] = savedThumbnailPath && !savedInList
    ? [
        ...thumbnails,
        {
          path: savedThumbnailPath,
          url: `/api/thumbnail-compare/serve?file=${encodeURIComponent(savedThumbnailPath.split('/').pop() || '')}`,
          style: '已儲存',
        },
      ]
    : thumbnails;

  const hasAny = allThumbnails.length > 0;

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-brand-cream">YouTube 縮圖</h3>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="text-xs text-green-400 bg-green-400/10 px-2 py-1 rounded">
              已選擇
            </span>
          )}
          {hasAny && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {expanded ? '收合' : `展開 (${allThumbnails.length})`}
            </button>
          )}
        </div>
      </div>

      {/* Hook title */}
      <div className="space-y-2">
        <label className="block text-sm text-zinc-400">縮圖短標題</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={hookTitle}
            onChange={(e) => setHookTitle(e.target.value)}
            disabled={!canEdit}
            placeholder="4-8 字吸睛標題"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-brand-cream focus:outline-none focus:border-brand disabled:opacity-50"
          />
          <button
            onClick={generateHookTitles}
            disabled={!canEdit || loadingCandidates}
            className="px-3 py-2 text-sm bg-zinc-700 text-zinc-300 rounded-lg hover:bg-zinc-600 disabled:opacity-50 transition-colors whitespace-nowrap flex items-center gap-1.5"
          >
            {loadingCandidates && (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {loadingCandidates ? '生成中...' : 'AI 標題'}
          </button>
          {hookTitle.trim() && (
            <button
              onClick={() => generateThumbnails()}
              disabled={!canEdit}
              className="px-3 py-2 text-sm bg-brand text-zinc-900 font-medium rounded-lg hover:bg-brand/90 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {loadingThumbnails ? `生成中 (${pendingCount})...` : '生成縮圖'}
            </button>
          )}
        </div>

        {/* Candidates */}
        {candidates.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {candidates.map((c, i) => (
              <button
                key={i}
                onClick={() => selectHookTitle(c)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                  c === hookTitle
                    ? 'border-brand bg-brand/10 text-brand-cream'
                    : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-brand hover:text-brand-cream'
                }`}
              >
                {c}
                <span className="text-zinc-500 ml-1 text-xs">{c.length}字</span>
              </button>
            ))}
          </div>
        )}

        {/* Hook title history */}
        {hookTitleHistory.length > 0 && (
          <div className="border-t border-zinc-800 pt-2">
            <button
              onClick={() => setShowHookHistory(!showHookHistory)}
              className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
            >
              <svg className={`w-3 h-3 transition-transform ${showHookHistory ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
              歷史批次（{hookTitleHistory.length}）
            </button>
            {showHookHistory && (
              <div className="mt-2 space-y-2">
                {hookTitleHistory.map((batch, bi) => (
                  <div key={bi} className="bg-zinc-800/50 rounded p-2">
                    <span className="text-[10px] text-zinc-500 block mb-1.5">
                      {new Date(batch.ts).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {batch.titles.map((t, ti) => (
                        <button
                          key={ti}
                          onClick={() => selectHookTitle(t)}
                          className={`px-2 py-1 text-xs rounded border transition-colors cursor-pointer ${
                            t === hookTitle
                              ? 'border-brand bg-brand/10 text-brand-cream'
                              : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-brand hover:text-brand-cream'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Selection error */}
      {selectError && (
        <div className="text-xs text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">
          {selectError}
        </div>
      )}

      {/* Loading */}
      {loadingThumbnails && (
        <div className="flex items-center gap-3 py-8 justify-center">
          <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-zinc-500">{pendingCount} 組縮圖生成中...</span>
        </div>
      )}

      {/* Selected thumbnail preview (collapsed view) */}
      {!expanded && selectedPath && (
        <div className="space-y-2">
          <div className="text-xs text-zinc-500">目前選用的縮圖</div>
          <div className="max-w-sm">
            <div className="relative rounded-xl overflow-hidden border-2 border-green-400 ring-2 ring-green-400/30">
              <img
                src={`/api/thumbnail-compare/serve?file=${encodeURIComponent(selectedPath.split('/').pop() || '')}`}
                alt="已選縮圖"
                className="w-full aspect-video object-contain bg-zinc-950"
              />
            </div>
          </div>
        </div>
      )}

      {/* All thumbnails (expanded view) */}
      {expanded && allThumbnails.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs text-zinc-500">
            共 {allThumbnails.length} 張 — 點選任一張即可儲存
          </div>
          <div className="grid grid-cols-2 gap-4">
            {allThumbnails.map((t) => (
              <div key={t.path} className="space-y-1">
                <button
                  onClick={() => canEdit && selectThumbnail(t)}
                  disabled={!canEdit || saving}
                  className={`relative w-full rounded-xl overflow-hidden border-2 transition-all ${
                    selectedPath === t.path
                      ? 'border-green-400 ring-2 ring-green-400/30'
                      : 'border-zinc-700 hover:border-zinc-500'
                  }`}
                >
                  <img
                    src={t.url + (t.url.includes('?') ? '&' : '?') + 't=' + Date.now()}
                    alt={t.style}
                    className="w-full aspect-video object-contain bg-zinc-950"
                  />
                  <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-black/60 flex items-center justify-between">
                    <span className="text-[10px] text-zinc-400">{t.style}</span>
                    {selectedPath === t.path && (
                      <span className="text-[10px] text-green-400 font-medium">已選</span>
                    )}
                  </div>
                </button>
                {canEdit && t.style !== '已儲存' && (
                  <div className="space-y-1">
                    {customPromptFor === t.path ? (
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={customPrompt}
                          onChange={(e) => setCustomPrompt(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              generateThumbnails(undefined, t.style, customPrompt, t.path);
                              setCustomPromptFor(null);
                              setCustomPrompt('');
                            }
                          }}
                          placeholder="額外指示（可留空）"
                          className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-brand-cream focus:outline-none focus:border-brand"
                          autoFocus
                        />
                        <button
                          onClick={() => {
                            generateThumbnails(undefined, t.style, customPrompt);
                            setCustomPromptFor(null);
                            setCustomPrompt('');
                          }}
                          className="text-[11px] text-brand hover:text-brand-cream transition-colors whitespace-nowrap"
                        >
                          生成
                        </button>
                        <button
                          onClick={() => { setCustomPromptFor(null); setCustomPrompt(''); }}
                          className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setCustomPromptFor(t.path); setCustomPrompt(''); }}
                        className="text-[11px] text-zinc-500 hover:text-brand-cream transition-colors"
                      >
                        再生成此風格
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
