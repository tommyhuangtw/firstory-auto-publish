'use client';

import { useEffect, useState, useCallback } from 'react';

interface AdPreset {
  id: number;
  name: string;
  content: string;
  is_active: number;
}

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

export default function SettingsPage() {
  const [presets, setPresets] = useState<AdPreset[]>([]);
  const [footerValues, setFooterValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [editingPreset, setEditingPreset] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');
  const [expandedPreset, setExpandedPreset] = useState<number | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newContent, setNewContent] = useState('');
  const [editingFooter, setEditingFooter] = useState<string | null>(null);
  const [fbStatus, setFbStatus] = useState<FbStatus | null>(null);
  const [fbDisconnecting, setFbDisconnecting] = useState(false);
  const [threadsStatus, setThreadsStatus] = useState<ThreadsStatus | null>(null);
  const [threadsDisconnecting, setThreadsDisconnecting] = useState(false);

  const loadData = useCallback(async () => {
    const [presetsRes, settingsRes, fbRes, threadsRes] = await Promise.all([
      fetch('/api/ad-presets').then(r => r.json()),
      fetch('/api/settings').then(r => r.json()),
      fetch('/api/auth/facebook/status').then(r => r.json()).catch(() => ({ connected: false })),
      fetch('/api/auth/threads/status').then(r => r.json()).catch(() => ({ connected: false })),
    ]);
    setPresets(presetsRes);
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

  async function handleActivate(id: number) {
    setSaving('preset');
    setMessage('');
    try {
      const res = await fetch('/api/ad-presets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'activate' }),
      });
      if (!res.ok) throw new Error('Failed');
      setPresets(prev => prev.map(p => ({ ...p, is_active: p.id === id ? 1 : 0 })));
      setMessage('業配已切換');
    } catch {
      setMessage('切換失敗');
    } finally {
      setSaving(null);
    }
  }

  function startEdit(preset: AdPreset) {
    setEditingPreset(preset.id);
    setEditName(preset.name);
    setEditContent(preset.content);
    setExpandedPreset(null);
  }

  function cancelEdit() {
    setEditingPreset(null);
    setEditName('');
    setEditContent('');
  }

  async function handleSaveEdit() {
    if (!editingPreset) return;
    setSaving('edit');
    setMessage('');
    try {
      const res = await fetch('/api/ad-presets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingPreset, name: editName, content: editContent }),
      });
      if (!res.ok) throw new Error('Failed');
      setPresets(prev => prev.map(p =>
        p.id === editingPreset ? { ...p, name: editName, content: editContent } : p
      ));
      setEditingPreset(null);
      setMessage('業配已更新');
    } catch {
      setMessage('更新失敗');
    } finally {
      setSaving(null);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('確定要刪除這個業配模板？')) return;
    setSaving('delete');
    setMessage('');
    try {
      const res = await fetch(`/api/ad-presets?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      setPresets(prev => prev.filter(p => p.id !== id));
      setMessage('已刪除');
    } catch {
      setMessage('刪除失敗');
    } finally {
      setSaving(null);
    }
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setSaving('create');
    setMessage('');
    try {
      const res = await fetch('/api/ad-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, content: newContent }),
      });
      if (!res.ok) throw new Error('Failed');
      const created = await res.json();
      setPresets(prev => [...prev, { ...created, is_active: 0 }]);
      setShowNewForm(false);
      setNewName('');
      setNewContent('');
      setMessage('業配已新增');
    } catch {
      setMessage('新增失敗');
    } finally {
      setSaving(null);
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
      setMessage('已儲存');
    } catch {
      setMessage('儲存失敗');
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <div className="p-6 md:p-8 max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight mb-6 flex items-center gap-2">
          <span className="w-1 h-6 rounded-full bg-brand" />
          Settings
        </h1>
        <p className="text-zinc-400 text-sm">Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight mb-6 flex items-center gap-2">
        <span className="w-1 h-6 rounded-full bg-brand" />
        Settings
      </h1>

      <div className="space-y-8">
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
            連結後可從 Review 頁面發布貼文到 Threads
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
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.5 12.068c0-3.518.85-6.372 2.495-8.423C5.845 1.34 8.598.16 12.179.136h.007c2.907.02 5.408.862 7.258 2.46 1.85 1.599 2.93 3.83 3.056 6.404h-3.86c-.12-1.612-.79-2.888-1.98-3.784-1.19-.896-2.67-1.376-4.467-1.22-2.342.205-3.964 1.218-4.987 2.855C6.183 8.388 5.64 10.35 5.64 12.068c0 1.718.543 3.68 1.566 5.317 1.023 1.637 2.645 2.65 4.987 2.855 1.797.156 3.277-.324 4.467-1.22 1.19-.896 1.86-2.172 1.98-3.784h3.86c-.126 2.574-1.206 4.805-3.056 6.404-1.85 1.598-4.351 2.44-7.258 2.46z"/>
              </svg>
              連結 Threads
            </a>
          )}
        </section>

        {/* Ad Presets Section */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-medium text-zinc-200">業配內容</h2>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                選擇要放在 description 最前面的業配文案
              </p>
            </div>
            <button
              onClick={() => { setShowNewForm(true); setEditingPreset(null); }}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              新增
            </button>
          </div>

          {/* New preset form */}
          {showNewForm && (
            <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-950/10 p-4">
              <h3 className="text-xs font-medium text-emerald-400 mb-3">新增業配模板</h3>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="模板名稱（例如：VoAI 絕好聲創）"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 mb-2"
              />
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="業配文案內容..."
                rows={6}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 resize-y"
              />
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleCreate}
                  disabled={saving === 'create' || !newName.trim()}
                  className="px-4 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white transition-colors cursor-pointer"
                >
                  {saving === 'create' ? '新增中...' : '新增'}
                </button>
                <button
                  onClick={() => { setShowNewForm(false); setNewName(''); setNewContent(''); }}
                  className="px-4 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors cursor-pointer"
                >
                  取消
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {presets.map((preset) => {
              const isActive = preset.is_active === 1;
              const isEditing = editingPreset === preset.id;
              const isExpanded = expandedPreset === preset.id;
              const isEmpty = !preset.content.trim();

              if (isEditing) {
                return (
                  <div key={preset.id} className="rounded-xl border border-amber-500/30 bg-amber-950/10 p-4">
                    <h3 className="text-xs font-medium text-amber-400 mb-3">編輯業配模板</h3>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 mb-2"
                    />
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={8}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 resize-y"
                    />
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={handleSaveEdit}
                        disabled={saving === 'edit'}
                        className="px-4 py-1.5 text-xs font-medium rounded-lg bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white transition-colors cursor-pointer"
                      >
                        {saving === 'edit' ? '儲存中...' : '儲存'}
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="px-4 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors cursor-pointer"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={preset.id}
                  className={`rounded-xl border transition-colors ${
                    isActive
                      ? 'border-brand/40 bg-brand/5'
                      : 'border-zinc-800 bg-zinc-900 hover:border-brand/20'
                  }`}
                >
                  <div
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                    onClick={() => setExpandedPreset(isExpanded ? null : preset.id)}
                  >
                    {/* Radio indicator */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleActivate(preset.id);
                      }}
                      disabled={saving === 'preset'}
                      className={`shrink-0 w-4 h-4 rounded-full border-2 transition-colors cursor-pointer ${
                        isActive
                          ? 'border-brand bg-brand'
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
                      </div>
                      {!isExpanded && !isEmpty && (
                        <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                          {preset.content.slice(0, 80)}...
                        </p>
                      )}
                      {isEmpty && (
                        <p className="text-[11px] text-zinc-600 mt-0.5">不加業配</p>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); startEdit(preset); }}
                        className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                        aria-label="Edit"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(preset.id); }}
                        disabled={saving === 'delete'}
                        className="p-1.5 rounded-md hover:bg-red-950/50 text-zinc-500 hover:text-red-400 transition-colors cursor-pointer"
                        aria-label="Delete"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      </button>

                      {/* Expand chevron */}
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

                  {/* Expanded content */}
                  {isExpanded && !isEmpty && (
                    <div className="px-4 pb-3 border-t border-zinc-800/50">
                      <pre className="text-[12px] text-zinc-400 whitespace-pre-wrap mt-2 font-sans leading-relaxed">
                        {preset.content}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
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
