'use client';

import { useEffect, useState, useCallback } from 'react';

interface SponsorPreset {
  id: number;
  name: string;
  script_text: string;
  audio_path: string;
  audio_duration_sec: number | null;
  is_active: number;
  expires_at: string | null;
  scheduled_dates: string | null;
  expired: boolean;
  ad_preset_id: number | null;
  ad_content: string | null;
  audio_merge_enabled: number;
  created_at: string;
}

interface AdOnlyPreset {
  id: number;
  name: string;
  content: string;
  is_active: number;
}

function parseScheduledDates(raw: string | null): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function formatDateShort(d: string) {
  const [, m, day] = d.split('-');
  return `${parseInt(m)}/${parseInt(day)}`;
}

export default function SponsorPage() {
  // TTS Tester state
  const [scriptText, setScriptText] = useState('');
  const [adContent, setAdContent] = useState('');
  const [generating, setGenerating] = useState(false);
  const [testAudioPath, setTestAudioPath] = useState<string | null>(null);
  const [testDuration, setTestDuration] = useState<number | null>(null);
  const [ttsSpeed, setTtsSpeed] = useState(1.18);
  const [testError, setTestError] = useState('');

  // Save preset state
  const [presetName, setPresetName] = useState('');
  const [scheduledDates, setScheduledDates] = useState<string[]>([]);
  const [newDate, setNewDate] = useState('');
  const [saving, setSaving] = useState(false);

  // Presets list
  const [presets, setPresets] = useState<SponsorPreset[]>([]);
  const [unlinkedAds, setUnlinkedAds] = useState<AdOnlyPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [activating, setActivating] = useState(false);

  // Inline edit state for ad content
  const [editingAdId, setEditingAdId] = useState<number | null>(null);
  const [editAdContent, setEditAdContent] = useState('');
  const [savingAd, setSavingAd] = useState(false);

  // Inline edit for unlinked ad
  const [editingUnlinkedId, setEditingUnlinkedId] = useState<number | null>(null);
  const [editUnlinkedContent, setEditUnlinkedContent] = useState('');
  const [expandedUnlinkedId, setExpandedUnlinkedId] = useState<number | null>(null);

  // Schedule editing for existing presets
  const [editingScheduleId, setEditingScheduleId] = useState<number | null>(null);
  const [editScheduleDates, setEditScheduleDates] = useState<string[]>([]);
  const [editNewDate, setEditNewDate] = useState('');

  const loadPresets = useCallback(async () => {
    try {
      const res = await fetch('/api/sponsor-audio');
      const data = await res.json();
      setPresets(data.presets);
      setUnlinkedAds(data.unlinkedAds);
    } catch {
      setMessage('載入失敗');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPresets(); }, [loadPresets]);

  async function handleGenerate() {
    if (!scriptText.trim()) return;
    setGenerating(true);
    setTestError('');
    setTestAudioPath(null);
    setTestDuration(null);
    try {
      const res = await fetch('/api/sponsor-audio/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptText, speed: ttsSpeed }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'TTS generation failed');
      }
      const data = await res.json();
      setTestAudioPath(data.audioPath);
      setTestDuration(data.durationSec);
    } catch (err) {
      setTestError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSavePreset() {
    if (!presetName.trim() || !testAudioPath) return;
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/sponsor-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: presetName,
          scriptText,
          audioPath: testAudioPath,
          durationSec: testDuration,
          scheduledDates: scheduledDates.length ? scheduledDates : undefined,
          adContent,
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      setPresetName('');
      setTestAudioPath(null);
      setTestDuration(null);
      setScriptText('');
      setAdContent('');
      setScheduledDates([]);
      setMessage('業配口播已儲存');
      await loadPresets();
    } catch {
      setMessage('儲存失敗');
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate(id: number) {
    setActivating(true);
    setMessage('');
    try {
      const res = await fetch('/api/sponsor-audio', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'activate' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '啟用失敗' }));
        throw new Error(err.error || '啟用失敗');
      }
      setPresets(prev => prev.map(p => p.id === id ? { ...p, is_active: 1 } : p));
      setMessage('已啟用（口播 + Description 已同步）');
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setActivating(false);
    }
  }

  async function handleDeactivate(id: number) {
    setActivating(true);
    setMessage('');
    try {
      const res = await fetch('/api/sponsor-audio', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'deactivate' }),
      });
      if (!res.ok) throw new Error('Failed');
      setPresets(prev => prev.map(p => p.id === id ? { ...p, is_active: 0 } : p));
      setMessage('已停用');
    } catch {
      setMessage('停用失敗');
    } finally {
      setActivating(false);
    }
  }

  async function handleToggleAudioMerge(id: number) {
    setMessage('');
    try {
      const res = await fetch('/api/sponsor-audio', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'toggle_audio_merge' }),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setPresets(prev => prev.map(p =>
        p.id === id ? { ...p, audio_merge_enabled: data.audio_merge_enabled } : p
      ));
      setMessage(data.audio_merge_enabled ? '口播音檔將合併到 Podcast' : '僅 Description，不合併口播');
    } catch {
      setMessage('切換失敗');
    }
  }

  async function handleSaveSchedule(id: number) {
    setMessage('');
    try {
      const res = await fetch('/api/sponsor-audio', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'update_schedule', scheduledDates: editScheduleDates.length ? editScheduleDates : null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '更新失敗' }));
        throw new Error(err.error || '更新失敗');
      }
      const json = editScheduleDates.length ? JSON.stringify(editScheduleDates) : null;
      setPresets(prev => prev.map(p =>
        p.id === id ? { ...p, scheduled_dates: json } : p
      ));
      setEditingScheduleId(null);
      setMessage('排程已更新');
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('確定要刪除這個業配口播？（對應的 Description 文案也會一併刪除）')) return;
    setMessage('');
    try {
      const res = await fetch(`/api/sponsor-audio?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      setPresets(prev => prev.filter(p => p.id !== id));
      setMessage('已刪除');
    } catch {
      setMessage('刪除失敗');
    }
  }

  async function handleSaveAdContent(id: number) {
    setSavingAd(true);
    setMessage('');
    try {
      const res = await fetch('/api/sponsor-audio', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, adContent: editAdContent }),
      });
      if (!res.ok) throw new Error('Failed');
      setPresets(prev => prev.map(p =>
        p.id === id ? { ...p, ad_content: editAdContent.trim() } : p
      ));
      setEditingAdId(null);
      setMessage('Description 文案已更新');
    } catch {
      setMessage('更新失敗');
    } finally {
      setSavingAd(false);
    }
  }

  // ── Unlinked ad preset handlers ──

  async function handleActivateAd(id: number) {
    setActivating(true);
    setMessage('');
    try {
      const res = await fetch('/api/ad-presets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'activate' }),
      });
      if (!res.ok) throw new Error('Failed');
      // Deactivate all sponsor presets locally + activate this ad
      setPresets(prev => prev.map(p => ({ ...p, is_active: 0 })));
      setUnlinkedAds(prev => prev.map(a => ({ ...a, is_active: a.id === id ? 1 : 0 })));
      setMessage('已啟用（僅 Description）');
    } catch {
      setMessage('啟用失敗');
    } finally {
      setActivating(false);
    }
  }

  async function handleDeactivateAd(id: number) {
    setActivating(true);
    setMessage('');
    try {
      const res = await fetch('/api/ad-presets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'deactivate' }),
      });
      if (!res.ok) throw new Error('Failed');
      setUnlinkedAds(prev => prev.map(a => a.id === id ? { ...a, is_active: 0 } : a));
      setMessage('已停用');
    } catch {
      setMessage('停用失敗');
    } finally {
      setActivating(false);
    }
  }

  async function handleDeleteAd(id: number) {
    if (!confirm('確定要刪除這個業配 Description？')) return;
    setMessage('');
    try {
      const res = await fetch(`/api/ad-presets?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      setUnlinkedAds(prev => prev.filter(a => a.id !== id));
      setMessage('已刪除');
    } catch {
      setMessage('刪除失敗');
    }
  }

  async function handleSaveUnlinkedAd(id: number) {
    setSavingAd(true);
    setMessage('');
    try {
      const res = await fetch('/api/ad-presets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, content: editUnlinkedContent }),
      });
      if (!res.ok) throw new Error('Failed');
      setUnlinkedAds(prev => prev.map(a =>
        a.id === id ? { ...a, content: editUnlinkedContent.trim() } : a
      ));
      setEditingUnlinkedId(null);
      setMessage('已更新');
    } catch {
      setMessage('更新失敗');
    } finally {
      setSavingAd(false);
    }
  }

  function formatDuration(sec: number | null) {
    if (!sec) return '--';
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
  }

  function formatSchedule(scheduledDates: string | null, expiresAt: string | null) {
    if (scheduledDates) {
      const dates = parseScheduledDates(scheduledDates);
      if (dates.length === 0) return '不限日期';
      return dates.map(formatDateShort).join(', ');
    }
    if (expiresAt) {
      const d = new Date(expiresAt);
      return `到期：${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    }
    return '不限日期';
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight mb-6 flex items-center gap-2">
        <span className="w-1 h-6 rounded-full bg-brand" />
        業配口播
      </h1>

      <div className="space-y-6">
        {/* Section A: TTS Tester */}
        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
          <h2 className="text-sm font-medium text-zinc-200 mb-1">TTS 測試</h2>
          <p className="text-[11px] text-zinc-500 mb-3">
            貼上業配文案，測試 VoAI TTS 唸出來是否順暢
          </p>

          <textarea
            value={scriptText}
            onChange={(e) => setScriptText(e.target.value)}
            placeholder="貼上業配口播文案..."
            rows={6}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 resize-y"
          />

          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-zinc-500 font-mono tabular-nums">
                {scriptText.length} 字
              </span>
              <div className="flex items-center gap-1.5">
                <label className="text-[11px] text-zinc-500">速度</label>
                <input
                  type="number"
                  min={0.8}
                  max={1.5}
                  step={0.01}
                  value={ttsSpeed}
                  onChange={(e) => setTtsSpeed(parseFloat(e.target.value) || 1.18)}
                  className="w-16 bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1 text-xs text-zinc-200 text-center font-mono focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
                />
                <span className="text-[11px] text-zinc-500">x</span>
              </div>
            </div>
            <button
              onClick={handleGenerate}
              disabled={generating || !scriptText.trim()}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-brand hover:bg-brand-light disabled:bg-zinc-700 disabled:text-zinc-500 text-white transition-colors cursor-pointer"
            >
              {generating && (
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {generating ? '生成中...' : '生成音檔'}
            </button>
          </div>

          {testError && (
            <p className="mt-2 text-sm text-red-400">{testError}</p>
          )}

          {testAudioPath && (
            <div className="mt-3 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] text-zinc-400">預覽音檔</span>
                {testDuration && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand/20 text-brand font-mono">
                    {formatDuration(testDuration)}
                  </span>
                )}
              </div>
              <audio
                controls
                className="w-full"
                src={`/api/audio${testAudioPath}`}
                preload="metadata"
              />
            </div>
          )}
        </section>

        {/* Section B: Save as Preset (visible after successful generation) */}
        {testAudioPath && (
          <section className="bg-zinc-900 rounded-xl border border-emerald-500/30 p-5">
            <h2 className="text-sm font-medium text-emerald-400 mb-3">儲存為業配 Preset</h2>

            <input
              type="text"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="Preset 名稱（例如：VoAI 5月業配）"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 mb-3"
            />

            <div className="mb-3">
              <label className="text-[11px] text-zinc-400 mb-1.5 block">
                Description 文案（YouTube / Podcast 描述欄位的業配內容）
              </label>
              <textarea
                value={adContent}
                onChange={(e) => setAdContent(e.target.value)}
                placeholder="業配 description 文案（選填，可之後再編輯）..."
                rows={5}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 resize-y"
              />
            </div>

            <div className="mb-3">
              <label className="text-[11px] text-zinc-400 mb-1.5 block">排程日期（不選 = 不限日期，一直生效）</label>
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
                />
                <button
                  onClick={() => {
                    if (newDate && !scheduledDates.includes(newDate)) {
                      setScheduledDates(prev => [...prev, newDate].sort());
                      setNewDate('');
                    }
                  }}
                  disabled={!newDate}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-300 transition-colors cursor-pointer"
                >
                  新增
                </button>
              </div>
              {scheduledDates.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {scheduledDates.map(d => (
                    <span key={d} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-brand/15 text-brand text-[11px] font-medium">
                      {formatDateShort(d)}
                      <button
                        onClick={() => setScheduledDates(prev => prev.filter(x => x !== d))}
                        className="hover:text-red-400 cursor-pointer"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={handleSavePreset}
              disabled={saving || !presetName.trim()}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white transition-colors cursor-pointer"
            >
              {saving ? '儲存中...' : '儲存 Preset'}
            </button>
          </section>
        )}

        {/* Section C: Existing Presets */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-medium text-zinc-200">業配 Presets</h2>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                啟用的 preset 會自動合併口播到音檔前面，並在 Description 加入業配文案
              </p>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-zinc-400">Loading...</p>
          ) : presets.length === 0 ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
              <p className="text-sm text-zinc-500">尚無業配 preset</p>
              <p className="text-[11px] text-zinc-600 mt-1">使用上方 TTS 測試區生成並儲存</p>
            </div>
          ) : (
            <div className="space-y-2">
              {presets.map(preset => {
                const isActive = preset.is_active === 1;
                const isExpanded = expandedId === preset.id;
                const isEditingAd = editingAdId === preset.id;

                return (
                  <div
                    key={preset.id}
                    className={`rounded-xl border transition-colors ${
                      preset.expired
                        ? 'border-zinc-800/50 bg-zinc-900/50 opacity-60'
                        : isActive
                        ? 'border-brand/40 bg-brand/5'
                        : 'border-zinc-800 bg-zinc-900 hover:border-brand/20'
                    }`}
                  >
                    <div
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : preset.id)}
                    >
                      {/* Radio indicator */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (preset.expired) return;
                          if (isActive) {
                            handleDeactivate(preset.id);
                          } else {
                            handleActivate(preset.id);
                          }
                        }}
                        disabled={activating || preset.expired}
                        className={`shrink-0 w-4 h-4 rounded-full border-2 transition-colors cursor-pointer ${
                          isActive
                            ? 'border-brand bg-brand'
                            : preset.expired
                            ? 'border-zinc-700'
                            : 'border-zinc-600 hover:border-zinc-400'
                        }`}
                        aria-label={`Activate ${preset.name}`}
                      >
                        {isActive && (
                          <svg className="w-full h-full text-white" viewBox="0 0 16 16" fill="none">
                            <path d="M4 8l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-zinc-200">{preset.name}</span>
                          {isActive && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand/20 text-brand font-medium">
                              使用中
                            </span>
                          )}
                          {preset.expired && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-medium">
                              已過期
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-zinc-500 font-mono">
                            {formatDuration(preset.audio_duration_sec)}
                          </span>
                          <span className="text-[10px] text-zinc-600">
                            {formatSchedule(preset.scheduled_dates, preset.expires_at)}
                          </span>
                          {preset.ad_content?.trim() ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                              有 Description
                            </span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500">
                              無 Description
                            </span>
                          )}
                          {isActive && !preset.audio_merge_enabled && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500">
                              口播已關閉
                            </span>
                          )}
                        </div>
                        {/* Audio merge toggle — only show for active preset */}
                        {isActive && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleAudioMerge(preset.id);
                            }}
                            className="flex items-center gap-1.5 mt-1 group cursor-pointer"
                          >
                            <div className={`relative w-7 h-4 rounded-full transition-colors ${
                              preset.audio_merge_enabled ? 'bg-brand' : 'bg-zinc-700'
                            }`}>
                              <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                                preset.audio_merge_enabled ? 'translate-x-3.5' : 'translate-x-0.5'
                              }`} />
                            </div>
                            <span className="text-[10px] text-zinc-500 group-hover:text-zinc-300 transition-colors">
                              合併口播音檔
                            </span>
                          </button>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(preset.id); }}
                          className="p-1.5 rounded-md hover:bg-red-950/50 text-zinc-500 hover:text-red-400 transition-colors cursor-pointer"
                          aria-label="Delete"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </button>
                        <svg
                          className={`w-4 h-4 text-zinc-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                        </svg>
                      </div>
                    </div>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-zinc-800/50 space-y-4">
                        {/* Script text */}
                        <div className="mt-3">
                          <span className="text-[11px] text-zinc-500 font-medium">口播文案</span>
                          <pre className="text-[12px] text-zinc-400 whitespace-pre-wrap mt-1 font-sans leading-relaxed">
                            {preset.script_text}
                          </pre>
                        </div>

                        {/* Audio player */}
                        <audio
                          controls
                          className="w-full"
                          src={`/api/audio${preset.audio_path}`}
                          preload="metadata"
                        />

                        {/* Schedule dates */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] text-zinc-500 font-medium">排程日期</span>
                            {editingScheduleId !== preset.id && (
                              <button
                                onClick={() => {
                                  setEditingScheduleId(preset.id);
                                  setEditScheduleDates(parseScheduledDates(preset.scheduled_dates));
                                  setEditNewDate('');
                                }}
                                className="p-1 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                                aria-label="Edit schedule"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                                </svg>
                              </button>
                            )}
                          </div>
                          {editingScheduleId === preset.id ? (
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <input
                                  type="date"
                                  value={editNewDate}
                                  onChange={(e) => setEditNewDate(e.target.value)}
                                  className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
                                />
                                <button
                                  onClick={() => {
                                    if (editNewDate && !editScheduleDates.includes(editNewDate)) {
                                      setEditScheduleDates(prev => [...prev, editNewDate].sort());
                                      setEditNewDate('');
                                    }
                                  }}
                                  disabled={!editNewDate}
                                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:text-zinc-600 text-zinc-300 transition-colors cursor-pointer"
                                >
                                  新增
                                </button>
                              </div>
                              {editScheduleDates.length > 0 ? (
                                <div className="flex flex-wrap gap-1.5 mb-2">
                                  {editScheduleDates.map(d => (
                                    <span key={d} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-brand/15 text-brand text-[11px] font-medium">
                                      {formatDateShort(d)}
                                      <button
                                        onClick={() => setEditScheduleDates(prev => prev.filter(x => x !== d))}
                                        className="hover:text-red-400 cursor-pointer"
                                      >
                                        ×
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-[11px] text-zinc-600 mb-2">不限日期（一直生效）</p>
                              )}
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleSaveSchedule(preset.id)}
                                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-brand hover:bg-brand-light text-white transition-colors cursor-pointer"
                                >
                                  儲存
                                </button>
                                <button
                                  onClick={() => setEditingScheduleId(null)}
                                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors cursor-pointer"
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-[12px] text-zinc-400">
                              {formatSchedule(preset.scheduled_dates, preset.expires_at)}
                            </p>
                          )}
                        </div>

                        {/* Description content */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] text-zinc-500 font-medium">Description 文案</span>
                            {!isEditingAd && (
                              <button
                                onClick={() => {
                                  setEditingAdId(preset.id);
                                  setEditAdContent(preset.ad_content || '');
                                }}
                                className="p-1 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                                aria-label="Edit description"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                                </svg>
                              </button>
                            )}
                          </div>
                          {isEditingAd ? (
                            <div>
                              <textarea
                                value={editAdContent}
                                onChange={(e) => setEditAdContent(e.target.value)}
                                rows={6}
                                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 resize-y"
                              />
                              <div className="flex gap-2 mt-2">
                                <button
                                  onClick={() => handleSaveAdContent(preset.id)}
                                  disabled={savingAd}
                                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-brand hover:bg-brand-light disabled:bg-zinc-700 disabled:text-zinc-500 text-white transition-colors cursor-pointer"
                                >
                                  {savingAd ? '儲存中...' : '儲存'}
                                </button>
                                <button
                                  onClick={() => setEditingAdId(null)}
                                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors cursor-pointer"
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          ) : preset.ad_content?.trim() ? (
                            <pre className="text-[12px] text-zinc-400 whitespace-pre-wrap font-sans leading-relaxed">
                              {preset.ad_content}
                            </pre>
                          ) : (
                            <p className="text-[11px] text-zinc-600 italic">
                              尚未設定 — 點擊編輯按鈕新增業配 Description 文案
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Section D: Description-only Presets (unlinked ad_presets) */}
        {unlinkedAds.length > 0 && (
          <section>
            <div className="mb-3">
              <h2 className="text-sm font-medium text-zinc-200">僅 Description 文案</h2>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                這些業配只有文字 Description，沒有口播音檔
              </p>
            </div>

            <div className="space-y-2">
              {unlinkedAds.map(ad => {
                const isActive = ad.is_active === 1;
                const isExpanded = expandedUnlinkedId === ad.id;
                const isEditing = editingUnlinkedId === ad.id;
                const isEmpty = !ad.content.trim();

                return (
                  <div
                    key={ad.id}
                    className={`rounded-xl border transition-colors ${
                      isActive
                        ? 'border-brand/40 bg-brand/5'
                        : 'border-zinc-800 bg-zinc-900 hover:border-brand/20'
                    }`}
                  >
                    <div
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                      onClick={() => setExpandedUnlinkedId(isExpanded ? null : ad.id)}
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isActive) handleDeactivateAd(ad.id);
                          else handleActivateAd(ad.id);
                        }}
                        disabled={activating}
                        className={`shrink-0 w-4 h-4 rounded-full border-2 transition-colors cursor-pointer ${
                          isActive
                            ? 'border-brand bg-brand'
                            : 'border-zinc-600 hover:border-zinc-400'
                        }`}
                        aria-label={`Activate ${ad.name}`}
                      >
                        {isActive && (
                          <svg className="w-full h-full text-white" viewBox="0 0 16 16" fill="none">
                            <path d="M4 8l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-zinc-200">{ad.name}</span>
                          {isActive && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand/20 text-brand font-medium">
                              使用中
                            </span>
                          )}
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                            僅文字
                          </span>
                        </div>
                        {!isExpanded && !isEmpty && (
                          <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                            {ad.content.slice(0, 80)}...
                          </p>
                        )}
                        {isEmpty && (
                          <p className="text-[11px] text-zinc-600 mt-0.5">無業配內容</p>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteAd(ad.id); }}
                          className="p-1.5 rounded-md hover:bg-red-950/50 text-zinc-500 hover:text-red-400 transition-colors cursor-pointer"
                          aria-label="Delete"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </button>
                        {!isEmpty && (
                          <svg
                            className={`w-4 h-4 text-zinc-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                            fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                          </svg>
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-zinc-800/50">
                        {isEditing ? (
                          <div className="mt-2">
                            <textarea
                              value={editUnlinkedContent}
                              onChange={(e) => setEditUnlinkedContent(e.target.value)}
                              rows={6}
                              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 resize-y"
                            />
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() => handleSaveUnlinkedAd(ad.id)}
                                disabled={savingAd}
                                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-brand hover:bg-brand-light disabled:bg-zinc-700 disabled:text-zinc-500 text-white transition-colors cursor-pointer"
                              >
                                {savingAd ? '儲存中...' : '儲存'}
                              </button>
                              <button
                                onClick={() => setEditingUnlinkedId(null)}
                                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors cursor-pointer"
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-2">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[11px] text-zinc-500 font-medium">Description 文案</span>
                              <button
                                onClick={() => {
                                  setEditingUnlinkedId(ad.id);
                                  setEditUnlinkedContent(ad.content);
                                }}
                                className="p-1 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                                aria-label="Edit"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                                </svg>
                              </button>
                            </div>
                            <pre className="text-[12px] text-zinc-400 whitespace-pre-wrap font-sans leading-relaxed">
                              {ad.content || '(空)'}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {message && (
        <p className={`mt-4 text-sm ${message.includes('失敗') ? 'text-red-400' : 'text-emerald-400'}`}>
          {message}
        </p>
      )}
    </div>
  );
}
