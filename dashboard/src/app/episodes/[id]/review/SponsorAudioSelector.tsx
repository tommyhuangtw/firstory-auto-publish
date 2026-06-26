'use client';

import { useEffect, useState, useCallback } from 'react';

interface PresetOption {
  id: number;
  name: string;
  audio_duration_sec: number | null;
  is_active: number;
  ad_content: string;
}

interface Props {
  episodeId: number;
  initialSponsorId: number | null;
}

export default function SponsorAudioSelector({ episodeId, initialSponsorId }: Props) {
  const [sponsorId, setSponsorId] = useState<number | null>(initialSponsorId);
  const [presets, setPresets] = useState<PresetOption[]>([]);
  const [globalAdContent, setGlobalAdContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState(false);
  const [message, setMessage] = useState('');

  const loadPresets = useCallback(async () => {
    try {
      const res = await fetch(`/api/episodes/${episodeId}/sponsor-audio`);
      const data = await res.json();
      setSponsorId(data.sponsorAudioId);
      setPresets(data.presets || []);
      setGlobalAdContent(data.globalAdContent || '');
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [episodeId]);

  useEffect(() => { loadPresets(); }, [loadPresets]);

  async function handleChange(newId: number | null) {
    setMerging(true);
    setMessage('');
    try {
      const res = await fetch(`/api/episodes/${episodeId}/sponsor-audio`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sponsorAudioId: newId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed');
      }
      setSponsorId(newId);
      setMessage(newId ? '業配音檔已合併' : '已移除業配');
      // Force audio player reload by reloading the page
      window.location.reload();
    } catch (err) {
      setMessage(`失敗: ${(err as Error).message}`);
    } finally {
      setMerging(false);
    }
  }

  const availablePresets = presets;
  const selectedPreset = presets.find(p => p.id === sponsorId);
  // The ad text that will be inserted into the SoundOn/YouTube description:
  // selected sponsor's ad content, or the globally active one when none is selected.
  const resolvedAd = (sponsorId ? selectedPreset?.ad_content : globalAdContent) || '';

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
          <svg className="w-4 h-4 text-zinc-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 010 3.46" />
          </svg>
          業配口播
        </h3>
        {merging && (
          <span className="text-[11px] text-amber-400 flex items-center gap-1">
            <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            合併中...
          </span>
        )}
      </div>

      <select
        value={sponsorId ?? ''}
        onChange={(e) => {
          const val = e.target.value;
          handleChange(val === '' ? null : parseInt(val));
        }}
        disabled={merging || loading}
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 cursor-pointer disabled:opacity-50"
      >
        <option value="">不使用業配</option>
        {availablePresets.map(p => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.audio_duration_sec ? ` (${Math.round(p.audio_duration_sec)}s)` : ''}
            {p.is_active ? ' ★' : ''}
          </option>
        ))}
      </select>

      {loading ? (
        <p className="text-[11px] text-zinc-500 mt-1.5">載入業配清單中…</p>
      ) : availablePresets.length === 0 ? (
        <p className="text-[11px] text-zinc-500 mt-1.5">
          尚無業配口播，請先到 <a href="/sponsor" className="text-brand hover:underline">業配口播</a> 頁面建立
        </p>
      ) : selectedPreset ? (
        <p className="text-[11px] text-zinc-500 mt-1.5">
          目前使用：{selectedPreset.name}
        </p>
      ) : (
        <p className="text-[11px] text-zinc-500 mt-1.5">預設不使用業配；選擇後會即時合併到音檔前面</p>
      )}

      {!loading && (
        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">
            會加入 SoundOn / YouTube 描述開頭的業配文字
            {!sponsorId && resolvedAd && <span className="ml-1 normal-case tracking-normal">（全域業配）</span>}
          </p>
          {resolvedAd.trim() ? (
            <pre className="text-[12px] text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed max-h-48 overflow-y-auto">
              {resolvedAd.trim()}
            </pre>
          ) : (
            <p className="text-[11px] text-zinc-600 italic">
              {sponsorId
                ? '這個業配沒有 description 文字（只會合併口播音檔）。可到「業配口播」頁編輯。'
                : '目前沒有業配 description 會被加入。'}
            </p>
          )}
        </div>
      )}

      {message && (
        <p className={`text-[11px] mt-1.5 ${message.includes('失敗') ? 'text-red-400' : 'text-emerald-400'}`}>
          {message}
        </p>
      )}
    </div>
  );
}
