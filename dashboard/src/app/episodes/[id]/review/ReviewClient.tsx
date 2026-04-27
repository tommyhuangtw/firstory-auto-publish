'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  episodeId: number;
  episodeNumber: number | null;
  status: string;
  segmentType: string;
  candidateTitles: string[];
  selectedTitle: string;
  description: string;
  igCaption: string;
  tags: string[];
  soundonUrl: string | null;
  youtubeUrl: string | null;
}

export default function ReviewClient({
  episodeId,
  status,
  candidateTitles: initialCandidates,
  selectedTitle: initialTitle,
  description: initialDescription,
  igCaption: initialIgCaption,
  tags,
}: Props) {
  const router = useRouter();
  const [candidateTitles, setCandidateTitles] = useState(initialCandidates);
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [igCaption, setIgCaption] = useState(initialIgCaption);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regeneratingDesc, setRegeneratingDesc] = useState(false);
  const [regeneratingIg, setRegeneratingIg] = useState(false);
  const [message, setMessage] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);

  // Track saved state for dirty detection
  const [savedTitle, setSavedTitle] = useState(initialTitle);
  const [savedDescription, setSavedDescription] = useState(initialDescription);
  const [savedIgCaption, setSavedIgCaption] = useState(initialIgCaption);

  const canReview = status === 'pending_review';
  const canEdit = status === 'pending_review' || status === 'published' || status === 'approved';

  const isDirty = useMemo(() =>
    title !== savedTitle ||
    description !== savedDescription ||
    igCaption !== savedIgCaption,
  [title, description, igCaption, savedTitle, savedDescription, savedIgCaption]);

  async function handleSave() {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch(`/api/episodes/${episodeId}/save-meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedTitle: title,
          description,
          igCaption,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSavedTitle(title);
      setSavedDescription(description);
      setSavedIgCaption(igCaption);
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
      setMessage('Approved! Publishing...');
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
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
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

  async function handleRegenerateIg() {
    setRegeneratingIg(true);
    setMessage('');
    try {
      const res = await fetch(`/api/episodes/${episodeId}/regenerate-ig`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setIgCaption(data.igCaption);
      setSavedIgCaption(data.igCaption);
      setMessage('IG 貼文已重新生成');
      router.refresh();
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setRegeneratingIg(false);
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
    <div className="space-y-6">
      {/* Title Picker */}
      {candidateTitles.length > 0 && (
        <section className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider">Title</h2>
            {canEdit && regenerateButton(handleRegenerateTitles, regenerating, '重新生成標題', '生成中...')}
          </div>
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
                  onChange={() => setTitle(t)}
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
        </section>
      )}

      {/* Description */}
      <section className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider">Description</h2>
          {canEdit && regenerateButton(handleRegenerateDescription, regeneratingDesc, '重新生成描述', '生成中...')}
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={10}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 resize-y"
        />
        <p className="text-[11px] text-zinc-500 mt-1 tabular-nums">{description.length} 字</p>
      </section>

      {/* Tags */}
      {tags.length > 0 && (
        <section className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider mb-2">Tags</h2>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag, i) => (
              <span key={i} className="px-2 py-1 bg-zinc-800 rounded text-xs text-zinc-300">
                {tag}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* IG Caption */}
      <section className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider">IG Caption</h2>
          {canEdit && regenerateButton(handleRegenerateIg, regeneratingIg, '重新生成 IG 貼文', '生成中...')}
        </div>
        {igCaption ? (
          <div>
            <textarea
              value={igCaption}
              onChange={(e) => setIgCaption(e.target.value)}
              rows={12}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 resize-y"
            />
            <p className="text-[11px] text-zinc-500 mt-1 tabular-nums">{igCaption.length} 字</p>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">尚未生成 IG 貼文</p>
        )}
      </section>

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

      {/* Approve / Reject Actions */}
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

      {message && (
        <p className={`text-sm ${message.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
          {message}
        </p>
      )}
    </div>
  );
}
