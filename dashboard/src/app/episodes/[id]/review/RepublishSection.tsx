'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  episodeNumber: number;
  soundonUrl: string | null;
  youtubeUrl: string | null;
  igPostId: string | null;
}

export default function RepublishSection({ episodeNumber, soundonUrl, youtubeUrl, igPostId }: Props) {
  const router = useRouter();
  const [loadingPlatform, setLoadingPlatform] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleRepublish(platform: 'soundon' | 'youtube' | 'instagram') {
    const labels: Record<string, string> = { soundon: 'SoundOn', youtube: 'YouTube', instagram: 'Instagram' };
    const label = labels[platform];
    if (!confirm(`確定要重新發布到 ${label}？`)) return;

    setLoadingPlatform(platform);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`/api/episodes/${episodeNumber}/republish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccess(`${label} 發布成功`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingPlatform(null);
    }
  }

  const isLoading = loadingPlatform !== null;

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
      <h3 className="text-sm font-medium text-zinc-300 mb-3">Published</h3>
      <div className="space-y-2.5">
        {/* SoundOn */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${soundonUrl ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <span className="text-sm text-zinc-300">SoundOn</span>
            {soundonUrl && (
              <a href={soundonUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline truncate max-w-[200px]">
                {soundonUrl.split('/').pop()?.slice(0, 16)}...
              </a>
            )}
          </div>
          <button
            onClick={() => handleRepublish('soundon')}
            disabled={isLoading}
            className="text-[11px] px-2.5 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 transition-colors cursor-pointer"
          >
            {loadingPlatform === 'soundon' ? '發布中...' : soundonUrl ? '重新發布' : '發布'}
          </button>
        </div>

        {/* YouTube */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${youtubeUrl ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <span className="text-sm text-zinc-300">YouTube</span>
            {youtubeUrl && (
              <a href={youtubeUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline truncate max-w-[200px]">
                {youtubeUrl}
              </a>
            )}
          </div>
          <button
            onClick={() => handleRepublish('youtube')}
            disabled={isLoading}
            className="text-[11px] px-2.5 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 transition-colors cursor-pointer"
          >
            {loadingPlatform === 'youtube' ? '發布中...' : youtubeUrl ? '重新發布' : '發布'}
          </button>
        </div>

        {/* Instagram */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${igPostId ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <span className="text-sm text-zinc-300">Instagram</span>
            {igPostId && (
              <span className="text-xs text-zinc-500 truncate max-w-[200px]">
                {igPostId}
              </span>
            )}
          </div>
          <button
            onClick={() => handleRepublish('instagram')}
            disabled={isLoading}
            className="text-[11px] px-2.5 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 transition-colors cursor-pointer"
          >
            {loadingPlatform === 'instagram' ? '發布中...' : igPostId ? '重新發布' : '發布'}
          </button>
        </div>

        {/* Republish All */}
        <div className="pt-2 border-t border-zinc-800">
          <button
            onClick={async () => {
              if (!confirm('確定要重新發布到 SoundOn + YouTube + Instagram？')) return;
              setLoadingPlatform('all');
              setError('');
              setSuccess('');
              try {
                const res = await fetch(`/api/episodes/${episodeNumber}/republish`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ platform: 'all' }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);
                const msgs: string[] = [];
                if (data.soundonUrl) msgs.push('SoundOn');
                if (data.youtubeUrl) msgs.push('YouTube');
                if (data.igPostId) msgs.push('Instagram');
                setSuccess(msgs.length > 0 ? `${msgs.join(' + ')} 發布成功` : '發布完成');
                if (data.errors?.length) setError(data.errors.join('; '));
                router.refresh();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setLoadingPlatform(null);
              }
            }}
            disabled={isLoading}
            className="w-full text-xs py-2 rounded-lg bg-blue-600/15 text-blue-400 hover:bg-blue-600/25 disabled:opacity-40 transition-colors cursor-pointer font-medium"
          >
            {loadingPlatform === 'all' ? '發布中...' : '全部重新發布'}
          </button>
        </div>
      </div>

      {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
      {success && <p className="mt-2 text-[11px] text-emerald-400">{success}</p>}
    </div>
  );
}
