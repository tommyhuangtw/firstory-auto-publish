'use client';

import { useEffect, useState, useCallback } from 'react';
import PageHeader from '@/components/PageHeader';
import PushNotificationSettings from '@/components/PushNotificationSettings';

interface FbStatus {
  connected: boolean;
  pageId?: string;
  pageName?: string;
}

interface ThreadsStatus {
  connected: boolean;
  userId?: string;
  username?: string;
}

interface SettingField {
  key: string;
  label: string;
  description: string;
  rows: number;
}

const FOOTER_FIELDS: SettingField[] = [
  {
    key: 'youtube_footer',
    label: 'YouTube Footer',
    description: 'YouTube description 底部的固定內容（buymeacoffee、社群連結等）',
    rows: 10,
  },
  {
    key: 'podcast_footer',
    label: 'Podcast Footer',
    description: 'Podcast description 底部的固定內容',
    rows: 4,
  },
];

interface WordCountField {
  key: string;
  label: string;
  description: string;
  defaultValue: string;
}

const WORD_COUNT_FIELDS: WordCountField[] = [
  { key: 'word_count_daily', label: 'Daily', description: '每日 AI 懶人報', defaultValue: '4500-5000' },
  { key: 'word_count_weekly', label: 'Weekly', description: '懶人精選週報', defaultValue: '5000-5500' },
  { key: 'word_count_robot', label: 'Robot', description: '機器人觀察週報', defaultValue: '5000-6000' },
  { key: 'word_count_sysdesign', label: 'System Design', description: '系統設計懶懶學', defaultValue: '6500-7500' },
];

interface TtsSpeedField {
  key: string;
  label: string;
  description: string;
  defaultValue: string;
}

const TTS_SPEED_FIELDS: TtsSpeedField[] = [
  { key: 'tts_speed_daily', label: 'Daily', description: '每日 AI 懶人報', defaultValue: '1.1' },
  { key: 'tts_speed_weekly', label: 'Weekly', description: '懶人精選週報', defaultValue: '1.1' },
  { key: 'tts_speed_robot', label: 'Robot', description: '機器人觀察週報', defaultValue: '1.07' },
  { key: 'tts_speed_sysdesign', label: 'System Design', description: '系統設計懶懶學', defaultValue: '1.05' },
  { key: 'tts_speed_sponsor', label: 'Sponsor', description: '業配口播', defaultValue: '1.18' },
];

export default function SettingsPage() {
  const [footerValues, setFooterValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [editingFooter, setEditingFooter] = useState<string | null>(null);
  const [fbStatus, setFbStatus] = useState<FbStatus | null>(null);
  const [fbDisconnecting, setFbDisconnecting] = useState(false);
  const [threadsStatus, setThreadsStatus] = useState<ThreadsStatus | null>(null);
  const [threadsDisconnecting, setThreadsDisconnecting] = useState(false);
  const [cleaningAudio, setCleaningAudio] = useState(false);
  const [cleanupResult, setCleanupResult] = useState('');

  const loadData = useCallback(async () => {
    const [settingsRes, fbRes, threadsRes] = await Promise.all([
      fetch('/api/settings').then(r => r.json()).catch(() => ({})),
      fetch('/api/auth/facebook/status').then(r => r.json()).catch(() => ({ connected: false })),
      fetch('/api/auth/threads/status').then(r => r.json()).catch(() => ({ connected: false })),
    ]);
    setFooterValues(settingsRes);
    setFbStatus(fbRes);
    setThreadsStatus(threadsRes);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Show toast when redirected back from Facebook OAuth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fb = params.get('fb');
    const threads = params.get('threads');
    if (fb === 'connected') setMessage('Facebook Page 已成功連結！');
    else if (fb === 'denied') setMessage('Facebook 授權已取消');
    else if (fb === 'error') setMessage('Facebook 連結失敗，請重試');
    else if (threads === 'connected') setMessage('Threads 已成功連結！');
    else if (threads === 'denied') setMessage('Threads 授權已取消');
    else if (threads === 'error') setMessage('Threads 連結失敗，請重試');
    // Clean up URL params
    if (fb || threads) window.history.replaceState({}, '', '/settings');
  }, []);

  async function handleFbDisconnect() {
    if (!confirm('確定要斷開 Facebook Page 連結？')) return;
    setFbDisconnecting(true);
    try {
      await fetch('/api/auth/facebook/status', { method: 'DELETE' });
      setFbStatus({ connected: false });
      setMessage('已斷開 Facebook 連結');
    } catch {
      setMessage('斷開失敗');
    } finally {
      setFbDisconnecting(false);
    }
  }

  async function handleThreadsDisconnect() {
    if (!confirm('確定要斷開 Threads 連結？')) return;
    setThreadsDisconnecting(true);
    try {
      await fetch('/api/auth/threads/status', { method: 'DELETE' });
      setThreadsStatus({ connected: false });
      setMessage('已斷開 Threads 連結');
    } catch {
      setMessage('斷開失敗');
    } finally {
      setThreadsDisconnecting(false);
    }
  }

  async function handleCleanupAudio() {
    if (!confirm('清理超過 60 天的本地音檔？（會先確認 Drive 上有備份才刪，之後點播會自動從雲端還原）')) return;
    setCleaningAudio(true);
    setCleanupResult('');
    try {
      const res = await fetch('/api/audio/cleanup', { method: 'POST' });
      const d = await res.json();
      if (d.error) {
        setCleanupResult(`失敗：${d.error}`);
      } else {
        setCleanupResult(
          `完成：掃描 ${d.scanned} 集、刪除 ${d.deleted} 檔、釋放 ${d.freedMB} MB` +
          (d.skippedNotOnDrive ? `；${d.skippedNotOnDrive} 檔 Drive 上找不到已保留` : '')
        );
      }
    } catch (e) {
      setCleanupResult(`失敗：${(e as Error).message}`);
    } finally {
      setCleaningAudio(false);
    }
  }

  async function handleSaveFooter(key: string) {
    setSaving(key);
    setMessage('');
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: footerValues[key] || '' }),
      });
      if (!res.ok) throw new Error('Save failed');
      setSaved(key);
      setTimeout(() => setSaved(prev => prev === key ? null : prev), 1500);
    } catch {
      setMessage('儲存失敗');
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <div className="p-6 md:p-8 max-w-3xl">
        <PageHeader title="設定" />
        <p className="text-zinc-400 text-sm">Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl">
      <PageHeader title="設定" />

      <div className="space-y-8">
        {/* Push Notifications (iPhone) */}
        <PushNotificationSettings />

        {/* Facebook Page Connection */}
        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
          <h2 className="text-sm font-medium text-zinc-200 mb-1">Facebook Page 連結</h2>
          <p className="text-[11px] text-zinc-500 mb-4">
            連結後，發布 IG 貼文時會自動同步到 Facebook Page
          </p>

          {fbStatus?.connected ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-sm text-zinc-200">{fbStatus.pageName}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-medium">
                  已連結
                </span>
              </div>
              <button
                onClick={handleFbDisconnect}
                disabled={fbDisconnecting}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-red-950/50 text-zinc-400 hover:text-red-400 transition-colors cursor-pointer"
              >
                {fbDisconnecting ? '斷開中...' : '斷開連結'}
              </button>
            </div>
          ) : (
            <a
              href="/api/auth/facebook"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
              連結 Facebook Page
            </a>
          )}
        </section>

        {/* Threads Connection */}
        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
          <h2 className="text-sm font-medium text-zinc-200 mb-1">Threads 連結</h2>
          <p className="text-[11px] text-zinc-500 mb-4">
            連結後可讀取你的貼文與互動數據（給「我的語料」用），並發布貼文到 Threads
          </p>

          {threadsStatus?.connected ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-sm text-zinc-200">@{threadsStatus.username}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-medium">
                  已連結
                </span>
              </div>
              <button
                onClick={handleThreadsDisconnect}
                disabled={threadsDisconnecting}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-red-950/50 text-zinc-400 hover:text-red-400 transition-colors cursor-pointer"
              >
                {threadsDisconnecting ? '斷開中...' : '斷開連結'}
              </button>
            </div>
          ) : (
            <a
              href="/api/auth/threads"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-zinc-100 hover:bg-white text-zinc-900 transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.781 3.631 2.695 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.331-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 1.999.062c-.084-.508-.243-.928-.476-1.252-.319-.444-.812-.667-1.467-.667h-.018c-.526 0-1.24.145-1.694.819l-1.689-1.137c.609-.903 1.601-1.4 2.794-1.4h.018c1.236.014 2.232.396 2.96 1.135.654.665 1.024 1.572 1.13 2.77.069.016.137.034.205.052.972.235 1.766.629 2.354 1.165.749.681 1.137 1.6 1.137 2.69 0 .926-.295 1.745-.876 2.434-.624.74-1.55 1.244-2.756 1.498l-.024.005.024-.005zm.16-7.043c-.327 0-.66.01-1.001.03-1.181.069-1.92.572-1.881 1.286.041.74.864 1.085 1.658 1.042.733-.04 1.69-.326 1.852-2.255a8.86 8.86 0 0 0-.628-.103z" />
              </svg>
              連結 Threads
            </a>
          )}
        </section>

        {/* Ad Presets — moved to Sponsor page */}
        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
          <h2 className="text-sm font-medium text-zinc-200 mb-1">業配內容</h2>
          <p className="text-[11px] text-zinc-500 mb-3">
            業配口播音檔與 Description 文案已整合至同一頁面管理
          </p>
          <a
            href="/sponsor"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
          >
            前往業配口播頁面
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </a>
        </section>

        {/* TTS Speed Settings */}
        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
          <h2 className="text-sm font-medium text-zinc-200 mb-1">TTS 語速設定</h2>
          <p className="text-[11px] text-zinc-500 mb-4">
            各單元的語音合成速度（0.8x ~ 1.5x）
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {TTS_SPEED_FIELDS.map((field) => (
              <div key={field.key} className="space-y-1">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-zinc-300">{field.label}</label>
                  <span className="text-[10px] text-zinc-500">{field.description}</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0.8}
                    max={1.5}
                    step={0.01}
                    value={footerValues[field.key] || field.defaultValue}
                    onChange={(e) => setFooterValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                    className="w-20 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 font-mono"
                  />
                  <span className="text-[11px] text-zinc-500">x</span>
                  <button
                    onClick={() => handleSaveFooter(field.key)}
                    disabled={saving === field.key || saved === field.key}
                    className={`w-8 h-8 flex items-center justify-center text-xs font-medium rounded-lg transition-all cursor-pointer ${
                      saved === field.key
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-300'
                    }`}
                  >
                    {saving === field.key ? (
                      <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : saved === field.key ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    ) : '存'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Word Count Targets */}
        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
          <h2 className="text-sm font-medium text-zinc-200 mb-1">腳本字數設定</h2>
          <p className="text-[11px] text-zinc-500 mb-4">
            各單元的中文腳本目標字數範圍（格式：最小-最大，例如 4500-5000）
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {WORD_COUNT_FIELDS.map((field) => (
              <div key={field.key} className="space-y-1">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-zinc-300">{field.label}</label>
                  <span className="text-[10px] text-zinc-500">{field.description}</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={footerValues[field.key] || field.defaultValue}
                    onChange={(e) => setFooterValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={field.defaultValue}
                    className="w-32 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 font-mono"
                  />
                  <button
                    onClick={() => handleSaveFooter(field.key)}
                    disabled={saving === field.key}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-300 transition-colors cursor-pointer"
                  >
                    {saving === field.key ? '...' : '儲存'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
          <h2 className="text-sm font-medium text-zinc-200 mb-1">本地儲存空間</h2>
          <p className="text-[11px] text-zinc-500 mb-4">
            清理超過 60 天的本地音檔以釋放空間。刪除前會確認 Drive 上有備份，之後點播會自動從雲端還原。
            系統每週一 04:00 也會自動執行一次。
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={handleCleanupAudio}
              disabled={cleaningAudio}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-300 transition-colors cursor-pointer"
            >
              {cleaningAudio ? '清理中…' : '立即清理舊音檔'}
            </button>
            {cleanupResult && <span className="text-[11px] text-zinc-400">{cleanupResult}</span>}
          </div>
        </section>

        {/* Footer Settings */}
        {FOOTER_FIELDS.map((field) => {
          const isEditingThis = editingFooter === field.key;
          return (
            <section key={field.key} className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-sm font-medium text-zinc-200">{field.label}</h2>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-zinc-500">{field.key}</span>
                  {!isEditingThis && (
                    <button
                      onClick={() => setEditingFooter(field.key)}
                      className="p-1 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                      aria-label="Edit"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-zinc-500 mb-3">{field.description}</p>

              {isEditingThis ? (
                <>
                  <textarea
                    value={footerValues[field.key] || ''}
                    onChange={(e) => setFooterValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                    rows={field.rows}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 resize-y font-mono"
                  />
                  <div className="flex items-center justify-end gap-2 mt-2">
                    <button
                      onClick={() => setEditingFooter(null)}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors cursor-pointer"
                    >
                      取消
                    </button>
                    <button
                      onClick={async () => { await handleSaveFooter(field.key); setEditingFooter(null); }}
                      disabled={saving === field.key}
                      className="px-4 py-1.5 text-xs font-medium rounded-lg bg-brand hover:bg-brand-light disabled:bg-zinc-700 disabled:text-zinc-500 text-white transition-colors cursor-pointer"
                    >
                      {saving === field.key ? '儲存中...' : '儲存'}
                    </button>
                  </div>
                </>
              ) : (
                <pre className="text-[12px] text-zinc-400 whitespace-pre-wrap font-sans leading-relaxed">
                  {footerValues[field.key] || '(empty)'}
                </pre>
              )}
            </section>
          );
        })}
      </div>

      {message && (
        <p className={`mt-4 text-sm ${message.includes('失敗') ? 'text-red-400' : 'text-emerald-400'}`}>
          {message}
        </p>
      )}
    </div>
  );
}
