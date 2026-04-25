'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  episodeNumber: number;
  scriptEn: string;
  scriptZh: string;
  pipelineRunId: number | null;
  canEdit: boolean;
}

export default function ScriptEditor({ episodeNumber, scriptEn, scriptZh, pipelineRunId, canEdit }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<'zh' | 'en'>('zh');
  const [editedZh, setEditedZh] = useState(scriptZh);
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [message, setMessage] = useState('');

  const hasChanges = editedZh !== scriptZh;

  async function handleSave() {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch(`/api/episodes/${episodeNumber}/edit-script`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptZh: editedZh }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      setMessage('已儲存');
      router.refresh();
    } catch (err) {
      setMessage(`儲存失敗: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleRegenTts() {
    if (!pipelineRunId) return;
    setRetrying(true);
    setMessage('');
    try {
      // Save first if changed
      if (hasChanges) {
        const saveRes = await fetch(`/api/episodes/${episodeNumber}/edit-script`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scriptZh: editedZh }),
        });
        if (!saveRes.ok) throw new Error('Failed to save script');
      }

      const res = await fetch('/api/pipeline/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pipelineRunId,
          fromStage: 'synthesizeTts',
          stateOverrides: { scriptZh: editedZh },
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      setMessage('語音重新生成中...');
      router.refresh();
    } catch (err) {
      setMessage(`重試失敗: ${(err as Error).message}`);
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-zinc-800">
        <button
          onClick={() => setTab('zh')}
          className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors cursor-pointer ${
            tab === 'zh'
              ? 'text-zinc-200 bg-zinc-800/50 border-b-2 border-blue-500'
              : 'text-zinc-400 hover:text-zinc-300'
          }`}
        >
          中文講稿
        </button>
        <button
          onClick={() => setTab('en')}
          className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors cursor-pointer ${
            tab === 'en'
              ? 'text-zinc-200 bg-zinc-800/50 border-b-2 border-blue-500'
              : 'text-zinc-400 hover:text-zinc-300'
          }`}
        >
          English Script
        </button>
      </div>

      {/* Content */}
      <div className="p-4">
        {tab === 'zh' ? (
          <textarea
            value={editedZh}
            onChange={(e) => setEditedZh(e.target.value)}
            disabled={!canEdit}
            rows={16}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-zinc-300 leading-relaxed font-mono focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600/30 resize-y disabled:opacity-60 transition-colors"
          />
        ) : (
          <pre className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-zinc-400 leading-relaxed font-mono max-h-[28rem] overflow-y-auto whitespace-pre-wrap">
            {scriptEn || '(No English script)'}
          </pre>
        )}

        {/* Actions */}
        {canEdit && tab === 'zh' && (
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={handleSave}
              disabled={saving || !hasChanges}
              className="inline-flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              {saving ? '儲存中...' : '儲存修改'}
            </button>
            {pipelineRunId && (
              <button
                onClick={handleRegenTts}
                disabled={retrying}
                className="inline-flex items-center gap-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border border-blue-500/20"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                </svg>
                {retrying ? '重新生成中...' : '重新生成語音'}
              </button>
            )}
          </div>
        )}

        {/* Character count */}
        {tab === 'zh' && (
          <p className="mt-2 text-[11px] text-zinc-400 tabular-nums">
            {editedZh.length.toLocaleString()} 字
            {hasChanges && <span className="text-amber-500 ml-2">(未儲存)</span>}
          </p>
        )}

        {message && (
          <p className={`mt-2 text-xs ${message.includes('失敗') ? 'text-red-400' : 'text-emerald-400'}`}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
