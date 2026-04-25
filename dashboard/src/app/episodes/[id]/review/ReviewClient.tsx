'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  episodeNumber: number;
  status: string;
  candidateTitles: string[];
  selectedTitle: string;
  description: string;
  tags: string[];
  soundonUrl: string | null;
  youtubeUrl: string | null;
}

export default function ReviewClient({
  episodeNumber,
  status,
  candidateTitles,
  selectedTitle: initialTitle,
  description: initialDescription,
  tags,
}: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);

  const canReview = status === 'pending_review';

  async function handleApprove() {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(`/api/episodes/${episodeNumber}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedTitle: title, description }),
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
      const res = await fetch(`/api/episodes/${episodeNumber}/reject`, {
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

  return (
    <div className="space-y-6">
      {/* Title Picker */}
      {candidateTitles.length > 0 && (
        <section className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider mb-3">Title</h2>
          <div className="space-y-2">
            {candidateTitles.map((t, i) => (
              <label
                key={i}
                className={`flex items-start gap-3 p-2 rounded cursor-pointer transition-colors ${
                  title === t ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
                } ${canReview ? '' : 'pointer-events-none opacity-70'}`}
              >
                <input
                  type="radio"
                  name="title"
                  value={t}
                  checked={title === t}
                  onChange={() => setTitle(t)}
                  disabled={!canReview}
                  className="mt-1 accent-blue-500"
                />
                <span className="text-sm text-zinc-200">{t}</span>
              </label>
            ))}
          </div>
          {/* Custom title */}
          {canReview && (
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Or type a custom title..."
              className="mt-3 w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          )}
        </section>
      )}

      {/* Description Editor */}
      <section className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
        <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider mb-2">Description</h2>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={!canReview}
          rows={8}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-y disabled:opacity-70"
        />
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

      {/* Actions */}
      {canReview && (
        <section className="space-y-3">
          <div className="flex gap-3">
            <button
              onClick={handleApprove}
              disabled={loading || !title}
              className="flex-1 bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium py-3 rounded-lg transition-colors"
            >
              {loading ? 'Processing...' : 'Approve & Publish'}
            </button>
            <button
              onClick={() => setShowReject(!showReject)}
              disabled={loading}
              className="px-6 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium py-3 rounded-lg transition-colors"
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
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-y mb-3"
              />
              <button
                onClick={handleReject}
                disabled={loading}
                className="bg-red-600 hover:bg-red-500 disabled:bg-zinc-700 text-white font-medium px-6 py-2 rounded-lg transition-colors"
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
