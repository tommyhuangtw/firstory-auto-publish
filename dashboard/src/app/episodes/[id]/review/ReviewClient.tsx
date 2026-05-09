'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  episodeId: number;
  episodeNumber: number | null;
  status: string;
  segmentType: string;
  candidateTitles: string[];
  titleHistory: { titles: string[]; prompt: string | null; ts: string }[];
  selectedTitle: string;
  description: string;
  tags: string[];
  soundonUrl: string | null;
  youtubeUrl: string | null;
  igCaption: string;
}

export default function ReviewClient({
  episodeId,
  status,
  candidateTitles: initialCandidates,
  titleHistory: initialTitleHistory,
  selectedTitle: initialTitle,
  description: initialDescription,
  tags,
  igCaption: initialIgCaption,
}: Props) {
  const router = useRouter();
  const [candidateTitles, setCandidateTitles] = useState(initialCandidates);
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regeneratingDesc, setRegeneratingDesc] = useState(false);
  const [message, setMessage] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [publishErrors, setPublishErrors] = useState<Array<{ platform: string; error: string }>>([]);
  const [titlePrompt, setTitlePrompt] = useState('');
  const [titleHistory, setTitleHistory] = useState(initialTitleHistory);
  const [showHistory, setShowHistory] = useState(false);

  // Track saved state for dirty detection
  const [savedTitle, setSavedTitle] = useState(initialTitle);
  const [savedDescription, setSavedDescription] = useState(initialDescription);

  // Track IG caption locally so title replacements accumulate correctly
  const [trackedIgCaption, setTrackedIgCaption] = useState(initialIgCaption);
  useEffect(() => {
    setTrackedIgCaption(initialIgCaption);
  }, [initialIgCaption]);

  const canReview = status === 'pending_review';
  const canEdit = status === 'pending_review' || status === 'published' || status === 'approved' || status === 'publishing';

  const isDirty = useMemo(() =>
    title !== savedTitle ||
    description !== savedDescription,
  [title, description, savedTitle, savedDescription]);

  function handleTitleChange(newTitle: string) {
    const oldTitle = title;
    setTitle(newTitle);
    // Update tracked IG caption so the next save writes the correct value
    if (oldTitle && newTitle && oldTitle !== newTitle) {
      setTrackedIgCaption(prev => prev.replace(oldTitle, newTitle));
    }
    window.dispatchEvent(new CustomEvent('title-changed', { detail: { oldTitle, newTitle } }));
  }

  async function handleSave() {
    setSaving(true);
    setMessage('');
    try {
      const titleChanged = title !== savedTitle;
      // Build a single save payload — include igCaption when title changed
      const payload: Record<string, string> = {
        selectedTitle: title,
        description,
      };
      if (titleChanged && trackedIgCaption) {
        payload.igCaption = trackedIgCaption;
      }
      const res = await fetch(`/api/episodes/${episodeId}/save-meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSavedTitle(title);
      setSavedDescription(description);
      setMessage('已儲存');
      router.refresh();
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove() {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(`/api/episodes/${episodeId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedTitle: title, description, youtubeDescription: description }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.publishErrors?.length) {
        setPublishErrors(data.publishErrors);
        setMessage('Published with partial failures — email notification sent');
      } else {
        setMessage('Approved! Published successfully.');
      }
      router.refresh();
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleReject() {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(`/api/episodes/${episodeId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage('Episode rejected.');
      router.refresh();
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleRegenerateTitles() {
    setRegenerating(true);
    setMessage('');
    try {
      const res = await fetch(`/api/episodes/${episodeId}/regenerate-titles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: titlePrompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // Push current batch to local history before replacing
      if (candidateTitles.length > 0) {
        setTitleHistory(prev => [{ titles: candidateTitles, prompt: titlePrompt || null, ts: new Date().toISOString() }, ...prev]);
      }
      setCandidateTitles(data.candidateTitles);
      setTitle(data.selectedTitle);
      setSavedTitle(data.selectedTitle);
      setMessage('標題已重新生成');
      router.refresh();
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setRegenerating(false);
    }
  }

  async function handleRegenerateDescription() {
    setRegeneratingDesc(true);
    setMessage('');
    try {
      const res = await fetch(`/api/episodes/${episodeId}/regenerate-description`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDescription(data.description);
      setSavedDescription(data.description);
      setMessage('描述已重新生成');
      router.refresh();
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setRegeneratingDesc(false);
    }
  }


  const regenerateButton = (onClick: () => void, loading: boolean, label: string, loadingLabel: string) => (
    <button
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-brand-cream hover:bg-brand/15 disabled:opacity-40 transition-colors cursor-pointer"
    >
      <svg className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.016 4.656v4.992" />
      </svg>
      {loading ? loadingLabel : label}
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Title Picker */}
      {candidateTitles.length > 0 && (
        <section className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider">Title</h2>
            {canEdit && regenerateButton(handleRegenerateTitles, regenerating, '重新生成標題', '生成中...')}
          </div>
          {canEdit && (
            <div className="mb-3">
              <textarea
                value={titlePrompt}
                onChange={(e) => setTitlePrompt(e.target.value)}
                placeholder="輸入你想聚焦的主題或方向（可選）..."
                rows={2}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 resize-none"
              />
            </div>
          )}
          <div className="space-y-2">
            {candidateTitles.map((t, i) => (
              <label
                key={i}
                className={`flex items-start gap-3 p-2 rounded cursor-pointer transition-colors ${
                  title === t ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
                }`}
              >
                <input
                  type="radio"
                  name="title"
                  value={t}
                  checked={title === t}
                  onChange={() => handleTitleChange(t)}
                  className="mt-1 accent-blue-500"
                />
                <span className="text-sm text-zinc-200">{t}</span>
              </label>
            ))}
          </div>
          {/* Custom title */}
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Or type a custom title..."
            className="mt-3 w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
          />
          {/* Title History */}
          {titleHistory.length > 0 && (
            <div className="mt-3 border-t border-zinc-800 pt-3">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
              >
                <svg className={`w-3 h-3 transition-transform ${showHistory ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
                歷史批次（{titleHistory.length}）
              </button>
              {showHistory && (
                <div className="mt-2 space-y-3">
                  {titleHistory.map((batch, bi) => (
                    <div key={bi} className="bg-zinc-800/50 rounded p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] text-zinc-500">
                          {new Date(batch.ts).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {batch.prompt && (
                          <span className="text-[10px] text-zinc-600 truncate max-w-[200px]" title={batch.prompt}>
                            prompt: {batch.prompt}
                          </span>
                        )}
                      </div>
                      <div className="space-y-1">
                        {batch.titles.map((t, ti) => (
                          <button
                            key={ti}
                            onClick={() => handleTitleChange(t)}
                            className={`block w-full text-left text-xs px-2 py-1 rounded transition-colors cursor-pointer ${
                              title === t ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50'
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
        </section>
      )}

      {/* Approve / Reject Actions — placed right after title for quick workflow */}
      {canReview && (
        <section className="space-y-3">
          <div className="flex gap-3">
            <button
              onClick={handleApprove}
              disabled={loading || !title}
              className="flex-1 bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium py-3 rounded-lg transition-colors cursor-pointer"
            >
              {loading ? 'Processing...' : 'Approve & Publish'}
            </button>
            <button
              onClick={() => setShowReject(!showReject)}
              disabled={loading}
              className="px-6 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium py-3 rounded-lg transition-colors cursor-pointer"
            >
              Reject
            </button>
          </div>

          {showReject && (
            <div className="bg-zinc-900 rounded-lg border border-red-900/50 p-4">
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason for rejection (optional)..."
                rows={3}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 resize-y mb-3"
              />
              <button
                onClick={handleReject}
                disabled={loading}
                className="bg-red-600 hover:bg-red-500 disabled:bg-zinc-700 text-white font-medium px-6 py-2 rounded-lg transition-colors cursor-pointer"
              >
                Confirm Reject
              </button>
            </div>
          )}
        </section>
      )}

      {/* Save Button — shown when any field has been edited */}
      {isDirty && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full text-sm py-2.5 rounded-lg bg-brand hover:bg-brand-light disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium transition-colors cursor-pointer"
        >
          {saving ? '儲存中...' : '儲存修改'}
        </button>
      )}

      {/* Status message */}
      {message && (
        <p className={`text-sm ${message.startsWith('Error') || message.includes('failures') ? 'text-amber-400' : 'text-green-400'}`}>
          {message}
        </p>
      )}

      {/* Publish errors per platform */}
      {publishErrors.length > 0 && (
        <div className="bg-red-950/30 border border-red-900/50 rounded-lg p-4 space-y-2">
          <p className="text-sm font-medium text-red-400">部分平台發布失敗</p>
          {publishErrors.map((e, i) => (
            <div key={i} className="text-xs text-red-300 font-mono">
              <span className="font-semibold text-red-400">{e.platform}:</span> {e.error}
            </div>
          ))}
          <p className="text-[11px] text-zinc-500 mt-2">可至 Republish 區塊重新發布失敗的平台</p>
        </div>
      )}

      {/* Content Details — collapsible preview */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="w-full flex items-center justify-between p-4 cursor-pointer"
        >
          <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider">內容詳情</h2>
          <svg
            className={`w-4 h-4 text-zinc-400 transition-transform ${showDetails ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        {/* Collapsed preview */}
        {!showDetails && (
          <div className="px-4 pb-4 -mt-1 space-y-2">
            {description && (
              <div>
                <p className="text-[11px] text-zinc-500 mb-0.5">Description</p>
                <p className="text-xs text-zinc-400 line-clamp-2">{description}</p>
              </div>
            )}

          </div>
        )}

        {/* Expanded full editor */}
        {showDetails && (
          <div className="px-4 pb-4 space-y-4">
            {/* Description */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] text-zinc-500 uppercase tracking-wider">Description</p>
                {canEdit && regenerateButton(handleRegenerateDescription, regeneratingDesc, '重新生成描述', '生成中...')}
              </div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={10}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 resize-y"
              />
              <p className="text-[11px] text-zinc-500 mt-1 tabular-nums">{description.length} 字</p>
            </div>

            {/* Tags */}
            {tags.length > 0 && (
              <div>
                <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-2">Tags</p>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag, i) => (
                    <span key={i} className="px-2 py-1 bg-zinc-800 rounded text-xs text-zinc-300">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}


          </div>
        )}
      </div>
    </div>
  );
}
