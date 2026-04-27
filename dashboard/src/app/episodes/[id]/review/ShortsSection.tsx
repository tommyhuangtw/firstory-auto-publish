'use client';

import { useState, useEffect, useCallback } from 'react';

interface ShortsData {
  id: number;
  status: string;
  current_stage: string | null;
  error_log: string | null;
  video_path: string | null;
  cover_path: string | null;
  ig_caption: string | null;
  ig_post_id: string | null;
  beats_json: string | null;
  selected_beat_index: number | null;
  headlines_json: string | null;
  selected_headline_index: number | null;
}

interface Beat {
  text: string;
  reason: string;
}

interface Props {
  episodeId: number;
  initialShorts: ShortsData | null;
}

const STAGE_LABELS: Record<string, string> = {
  extractHighlight: '腳本生成',
  tts: 'TTS 語音合成',
  whisper: '字幕時間軸',
  slothVideo: '樹懶動畫',
  broll: 'B-roll 素材',
  concatAudio: '音訊合併',
  render: '影片渲染',
};

const STAGES = Object.keys(STAGE_LABELS);

export default function ShortsSection({ episodeId, initialShorts }: Props) {
  const [shorts, setShorts] = useState<ShortsData | null>(initialShorts);
  const [step, setStep] = useState<'idle' | 'select_avatar' | 'loading_beats' | 'select_beat' | 'loading_headlines' | 'select_headline' | 'generating' | 'completed' | 'publishing' | 'published' | 'failed'>('idle');
  const [shortsId, setShortsId] = useState<number | null>(initialShorts?.id ?? null);
  const [avatars, setAvatars] = useState<{ filename: string; label: string; path: string }[]>([]);
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(null);
  const [beats, setBeats] = useState<Beat[]>([]);
  const [selectedBeatIdx, setSelectedBeatIdx] = useState<number | null>(null);
  const [headlines, setHeadlines] = useState<string[]>([]);
  const [selectedHeadlineIdx, setSelectedHeadlineIdx] = useState<number | null>(null);
  const [customHeadline, setCustomHeadline] = useState('');
  const [igCaption, setIgCaption] = useState('');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);

  // Derive step from initialShorts on mount
  useEffect(() => {
    if (!initialShorts) { setStep('idle'); return; }
    const s = initialShorts;
    setShortsId(s.id);
    if (s.ig_caption) setIgCaption(s.ig_caption);

    switch (s.status) {
      case 'beats_ready':
        setBeats(s.beats_json ? JSON.parse(s.beats_json) : []);
        setStep('select_beat');
        setExpanded(true);
        break;
      case 'headline_ready':
        setBeats(s.beats_json ? JSON.parse(s.beats_json) : []);
        setSelectedBeatIdx(s.selected_beat_index);
        setHeadlines(s.headlines_json ? JSON.parse(s.headlines_json) : []);
        setStep('select_headline');
        setExpanded(true);
        break;
      case 'generating':
        setStep('generating');
        setExpanded(true);
        break;
      case 'completed':
        setStep('completed');
        setExpanded(true);
        break;
      case 'published':
        setStep('published');
        break;
      case 'failed':
        setStep('failed');
        setExpanded(true);
        break;
      default:
        setStep('idle');
    }
  }, [initialShorts]);

  // Poll during generating
  useEffect(() => {
    if (step !== 'generating' || !shortsId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/shorts/status/${shortsId}`);
        const data = await res.json();
        setShorts(data);
        if (data.status === 'completed') {
          setStep('completed');
          setIgCaption(data.ig_caption || '');
        } else if (data.status === 'failed') {
          setStep('failed');
          setError(data.error_log || 'Unknown error');
        }
      } catch { /* ignore poll errors */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [step, shortsId]);

  const handleShowAvatars = useCallback(async () => {
    setError('');
    setExpanded(true);
    try {
      const res = await fetch('/api/shorts/avatars');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAvatars(data.avatars);
      setStep('select_avatar');
    } catch (err) {
      setError((err as Error).message);
      setStep('idle');
    }
  }, []);

  const handleStartBeats = useCallback(async () => {
    setError('');
    setStep('loading_beats');
    try {
      const res = await fetch('/api/shorts/beats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeId, avatarFilename: selectedAvatar }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShortsId(data.shortsId);
      setBeats(data.beats);
      setStep('select_beat');
      setExpanded(true);
    } catch (err) {
      setError((err as Error).message);
      setStep('idle');
    }
  }, [episodeId, selectedAvatar]);

  const handleSelectBeat = useCallback(async () => {
    if (selectedBeatIdx === null || !shortsId) return;
    setError('');
    setStep('loading_headlines');
    try {
      const res = await fetch('/api/shorts/headlines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortsId, selectedBeatIndex: selectedBeatIdx }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setHeadlines(data.headlines);
      setStep('select_headline');
    } catch (err) {
      setError((err as Error).message);
      setStep('select_beat');
    }
  }, [selectedBeatIdx, shortsId]);

  const handleRegenerateHeadlines = useCallback(async () => {
    if (selectedBeatIdx === null || !shortsId) return;
    setError('');
    setSelectedHeadlineIdx(null);
    setCustomHeadline('');
    setStep('loading_headlines');
    try {
      const res = await fetch('/api/shorts/headlines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortsId, selectedBeatIndex: selectedBeatIdx }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setHeadlines(data.headlines);
      setStep('select_headline');
    } catch (err) {
      setError((err as Error).message);
      setStep('select_headline');
    }
  }, [selectedBeatIdx, shortsId]);

  const handleGenerate = useCallback(async () => {
    if (selectedHeadlineIdx === null || !shortsId) return;
    setError('');
    setStep('generating');
    // Send customHeadline only if user edited it
    const edited = customHeadline.trim() !== headlines[selectedHeadlineIdx] ? customHeadline.trim() : undefined;
    try {
      const res = await fetch('/api/shorts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortsId, selectedHeadlineIndex: selectedHeadlineIdx, customHeadline: edited }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    } catch (err) {
      setError((err as Error).message);
      setStep('select_headline');
    }
  }, [selectedHeadlineIdx, shortsId, customHeadline, headlines]);

  const handlePublish = useCallback(async () => {
    if (!shortsId) return;
    if (!confirm('確定要發布到 Instagram Reels？')) return;
    setError('');
    setStep('publishing');
    try {
      const res = await fetch(`/api/shorts/publish/${shortsId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption: igCaption }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShorts((prev) => prev ? { ...prev, ig_post_id: data.igPostId, status: 'published' } : prev);
      setStep('published');
    } catch (err) {
      setError((err as Error).message);
      setStep('completed');
    }
  }, [shortsId, igCaption]);

  const handleRestart = useCallback(() => {
    // Reuse existing beats — same script always produces same highlights.
    // Keep avatar selection, just reset beat/headline choices.
    const existingBeats = beats;
    setShortsId(null);
    setShorts(null);
    setSelectedBeatIdx(null);
    setHeadlines([]);
    setSelectedHeadlineIdx(null);
    setCustomHeadline('');
    setIgCaption('');
    setError('');
    if (existingBeats.length > 0) {
      setBeats(existingBeats);
      setStep('select_beat');
      setExpanded(true);
    } else {
      setStep('idle');
    }
  }, [beats]);

  const currentStageIndex = shorts?.current_stage ? STAGES.indexOf(shorts.current_stage) : -1;

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-zinc-800/50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-base">🎬</span>
          <h3 className="text-sm font-medium text-zinc-300">Shorts</h3>
          {step === 'published' && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-emerald-500/15 text-emerald-400">
              已發布
            </span>
          )}
          {step === 'completed' && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-blue-500/15 text-blue-300">
              已完成
            </span>
          )}
          {step === 'generating' && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-yellow-500/15 text-yellow-400">
              生成中
            </span>
          )}
        </div>
        <svg className={`w-4 h-4 text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-zinc-800">
          {/* Step: Idle — Generate button */}
          {step === 'idle' && (
            <div className="pt-4">
              <button
                onClick={handleShowAvatars}
                className="w-full py-2.5 rounded-lg bg-violet-600/20 text-violet-300 hover:bg-violet-600/30 font-medium text-sm transition-colors cursor-pointer"
              >
                Generate Shorts
              </button>
            </div>
          )}

          {/* Step: Select avatar */}
          {step === 'select_avatar' && (
            <div className="pt-4 space-y-3">
              <p className="text-xs text-zinc-400">選擇樹懶形象：</p>
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                {avatars.map((a) => (
                  <button
                    key={a.filename}
                    onClick={() => setSelectedAvatar(a.filename)}
                    className={`relative rounded-lg overflow-hidden border-2 transition-all cursor-pointer aspect-[9/16] ${
                      selectedAvatar === a.filename
                        ? 'border-violet-500 ring-2 ring-violet-500/30'
                        : 'border-zinc-700 hover:border-zinc-500'
                    }`}
                  >
                    <img
                      src={`/api/audio${a.path}`}
                      alt={a.label}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute bottom-0 inset-x-0 bg-black/60 px-1 py-0.5">
                      <p className="text-[9px] text-zinc-300 text-center truncate">{a.label}</p>
                    </div>
                  </button>
                ))}
              </div>
              <button
                onClick={handleStartBeats}
                disabled={!selectedAvatar}
                className="w-full py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium transition-colors cursor-pointer"
              >
                下一步：選擇主題
              </button>
            </div>
          )}

          {/* Step: Loading beats */}
          {step === 'loading_beats' && (
            <div className="pt-4 flex items-center gap-2 text-sm text-zinc-400">
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              正在擷取精華候選段落...
            </div>
          )}

          {/* Step: Select beat */}
          {step === 'select_beat' && (
            <div className="pt-4 space-y-3">
              <p className="text-xs text-zinc-400">選擇要做成 Shorts 的主題：</p>
              <div className="space-y-2">
                {beats.map((beat, i) => (
                  <label
                    key={i}
                    className={`block p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedBeatIdx === i
                        ? 'border-violet-500/50 bg-violet-500/10'
                        : 'border-zinc-700 hover:border-zinc-600'
                    }`}
                  >
                    <div className="flex gap-2">
                      <input
                        type="radio"
                        name="beat"
                        checked={selectedBeatIdx === i}
                        onChange={() => setSelectedBeatIdx(i)}
                        className="mt-1 accent-violet-500"
                      />
                      <div>
                        <p className="text-xs text-zinc-300 leading-relaxed">{beat.text.slice(0, 150)}...</p>
                        {beat.reason && (
                          <p className="text-[10px] text-zinc-500 mt-1">{beat.reason}</p>
                        )}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
              <button
                onClick={handleSelectBeat}
                disabled={selectedBeatIdx === null}
                className="w-full py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium transition-colors cursor-pointer"
              >
                下一步：選擇封面標題
              </button>
            </div>
          )}

          {/* Step: Loading headlines */}
          {step === 'loading_headlines' && (
            <div className="pt-4 flex items-center gap-2 text-sm text-zinc-400">
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              正在生成封面標題...
            </div>
          )}

          {/* Step: Select headline */}
          {step === 'select_headline' && (
            <div className="pt-4 space-y-3">
              {/* Show selected beat for context */}
              {selectedBeatIdx !== null && beats[selectedBeatIdx] && (
                <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-3">
                  <p className="text-[10px] text-zinc-500 mb-1">已選主題</p>
                  <p className="text-xs text-zinc-400 leading-relaxed">{beats[selectedBeatIdx].text.slice(0, 100)}...</p>
                </div>
              )}
              <p className="text-xs text-zinc-400">選擇 Reels 封面標題：</p>
              <div className="grid grid-cols-1 gap-2">
                {headlines.map((headline, i) => (
                  <label
                    key={i}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                      selectedHeadlineIdx === i
                        ? 'border-violet-500/50 bg-violet-500/10'
                        : 'border-zinc-700 hover:border-zinc-600'
                    }`}
                  >
                    <input
                      type="radio"
                      name="headline"
                      checked={selectedHeadlineIdx === i}
                      onChange={() => { setSelectedHeadlineIdx(i); setCustomHeadline(headline); }}
                      className="accent-violet-500"
                    />
                    <span className="text-sm text-zinc-300">{headline}</span>
                  </label>
                ))}
              </div>
              {/* Editable headline input */}
              {selectedHeadlineIdx !== null && (
                <div>
                  <p className="text-[10px] text-zinc-500 mb-1">微調封面標題</p>
                  <input
                    type="text"
                    value={customHeadline}
                    onChange={(e) => setCustomHeadline(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-violet-500/50"
                  />
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => handleRestart()}
                  className="px-4 py-2.5 rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-sm transition-colors cursor-pointer"
                >
                  重新選擇
                </button>
                <button
                  onClick={handleRegenerateHeadlines}
                  className="px-4 py-2.5 rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-sm transition-colors cursor-pointer"
                >
                  換一批標題
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={selectedHeadlineIdx === null}
                  className="flex-1 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium transition-colors cursor-pointer"
                >
                  開始生成 Shorts
                </button>
              </div>
            </div>
          )}

          {/* Step: Generating — 7-stage progress */}
          {step === 'generating' && (
            <div className="pt-4 space-y-3">
              <p className="text-xs text-zinc-400 mb-2">正在生成 Shorts 影片...</p>
              <div className="space-y-1.5">
                {STAGES.map((stage, i) => {
                  const isCurrent = i === currentStageIndex;
                  const isDone = i < currentStageIndex;
                  return (
                    <div key={stage} className="flex items-center gap-2">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-medium ${
                        isDone ? 'bg-emerald-500/20 text-emerald-400' :
                        isCurrent ? 'bg-violet-500/20 text-violet-400' :
                        'bg-zinc-800 text-zinc-600'
                      }`}>
                        {isDone ? '✓' : isCurrent ? (
                          <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        ) : i + 1}
                      </div>
                      <span className={`text-xs ${
                        isDone ? 'text-emerald-400' : isCurrent ? 'text-violet-300' : 'text-zinc-600'
                      }`}>
                        {STAGE_LABELS[stage]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step: Completed — Preview + Publish */}
          {(step === 'completed' || step === 'publishing') && shorts && (
            <div className="pt-4 space-y-4">
              {/* Video preview */}
              {shorts.video_path && (
                <div>
                  <p className="text-xs text-zinc-400 mb-1.5">影片預覽</p>
                  <video
                    controls
                    className="w-full max-w-[280px] rounded-lg border border-zinc-700"
                    src={`/api/audio${shorts.video_path}`}
                    preload="metadata"
                  />
                </div>
              )}

              {/* Cover preview */}
              {shorts.cover_path && (
                <div>
                  <p className="text-xs text-zinc-400 mb-1.5">封面</p>
                  <img
                    src={`/api/audio${shorts.cover_path}`}
                    alt="Shorts cover"
                    className="w-32 rounded-lg border border-zinc-700"
                  />
                </div>
              )}

              {/* IG Caption */}
              <div>
                <p className="text-xs text-zinc-400 mb-1.5">IG 文案</p>
                <textarea
                  value={igCaption}
                  onChange={(e) => setIgCaption(e.target.value)}
                  rows={6}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-xs text-zinc-300 resize-y focus:outline-none focus:border-violet-500/50"
                />
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handlePublish}
                  disabled={step === 'publishing'}
                  className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 text-white text-sm font-medium transition-all cursor-pointer"
                >
                  {step === 'publishing' ? '發布中...' : 'Publish to Instagram'}
                </button>
                <button
                  onClick={() => handleRestart()}
                  className="px-4 py-2.5 rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-sm transition-colors cursor-pointer"
                >
                  重新製作
                </button>
              </div>
            </div>
          )}

          {/* Step: Published */}
          {step === 'published' && (
            <div className="pt-4 space-y-3">
              <div className="flex items-center gap-2 text-emerald-400">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm">已發布到 Instagram Reels</span>
              </div>
              {shorts?.ig_post_id && (
                <p className="text-[10px] text-zinc-500">Post ID: {shorts.ig_post_id}</p>
              )}
              <button
                onClick={() => handleRestart()}
                className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
              >
                重新製作
              </button>
            </div>
          )}

          {/* Step: Failed */}
          {step === 'failed' && (
            <div className="pt-4 space-y-3">
              <div className="rounded-lg bg-red-950/20 border border-red-900/30 p-3">
                <p className="text-[11px] text-red-400 font-medium mb-1">Shorts 生成失敗</p>
                <p className="text-[10px] text-red-300/80 font-mono break-all">
                  {error || shorts?.error_log || 'Unknown error'}
                </p>
              </div>
              <button
                onClick={() => handleRestart()}
                className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
              >
                重新嘗試
              </button>
            </div>
          )}

          {/* Error message */}
          {error && step !== 'failed' && (
            <p className="text-[11px] text-red-400">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}
