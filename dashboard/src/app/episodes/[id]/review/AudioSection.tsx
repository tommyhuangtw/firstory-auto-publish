'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  episodeId: number;
  audioPath: string | null;
  hasOriginal: boolean;
}

export default function AudioSection({ episodeId, audioPath, hasOriginal }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');

  if (!audioPath) return null;

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setMessage('');
    try {
      const formData = new FormData();
      formData.append('audio', file);

      const res = await fetch(`/api/episodes/${episodeId}/upload-audio`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setMessage('音檔已替換');
      router.refresh();
    } catch (err) {
      setMessage(`上傳失敗: ${(err as Error).message}`);
    } finally {
      setUploading(false);
      // Reset input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div className="flex-1 flex flex-col justify-end">
      <div className="flex items-center gap-2 mb-1.5">
        <p className="text-[11px] text-zinc-400">Audio</p>
        {hasOriginal && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">
            已替換
          </span>
        )}
      </div>
      <audio
        controls
        className="w-full"
        src={`/api/audio${audioPath}`}
        preload="metadata"
      />
      <div className="flex items-center gap-2 mt-2">
        <a
          href={`/api/episodes/${episodeId}/download-audio`}
          download
          className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          下載
        </a>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 transition-colors cursor-pointer"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          {uploading ? '上傳中...' : '上傳替換'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".mp3,.wav,.m4a,.aac,.ogg"
          onChange={handleUpload}
          className="hidden"
        />
        {message && (
          <span className={`text-[11px] ${message.startsWith('上傳失敗') ? 'text-red-400' : 'text-green-400'}`}>
            {message}
          </span>
        )}
      </div>
    </div>
  );
}
