'use client';

import { useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';

interface Draft {
  id: number;
  episodeId: number;
  seoTitle: string;
  deck: string;
  seoDescription: string;
  coverImageUrl: string;
  bodyMarkdown: string;
  audioUrl: string;
  status: string;
}

interface Props {
  episodeId: number;
  initialDraft: Draft | null;
}

// AI 懶人報 Substack — opens a fresh newsletter post composer.
const SUBSTACK_NEW_POST_URL = 'https://ailanrenbao.substack.com/publish/post?type=newsletter';

const inputClass =
  'w-full bg-zinc-800 border border-zinc-700 rounded-lg p-2.5 text-xs text-zinc-300 focus:outline-none focus:border-violet-500/50';

export default function SubstackDraftSection({ episodeId, initialDraft }: Props) {
  const [draft, setDraft] = useState<Draft | null>(initialDraft);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  async function generate() {
    setGenerating(true);
    setError('');
    try {
      const res = await fetch(`/api/episodes/${episodeId}/substack-draft`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Generation failed');
      setDraft(json.draft);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/substack-drafts/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seoTitle: draft.seoTitle,
          deck: draft.deck,
          seoDescription: draft.seoDescription,
          bodyMarkdown: draft.bodyMarkdown,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Save failed');
      setDraft(json.draft);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // Copy the RENDERED body as rich HTML so Substack's ProseMirror editor keeps
  // headings/bold/lists/links. Falls back to plain Markdown text if the
  // async Clipboard API is unavailable.
  async function copyRichHtml() {
    if (!draft) return;
    const html = previewRef.current?.innerHTML ?? '';
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([draft.bodyMarkdown], { type: 'text/plain' }),
        }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      await navigator.clipboard.writeText(draft.bodyMarkdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function field(key: keyof Draft, value: string) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-2.5">
          <svg className="w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
          </svg>
          <h3 className="text-sm font-medium text-zinc-300">Substack 草稿</h3>
        </div>
        <button
          onClick={generate}
          disabled={generating}
          className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-light disabled:opacity-50 text-white text-sm font-medium transition-colors cursor-pointer"
        >
          {generating ? '產生中…' : draft ? '重新產生' : '產生 Substack 草稿'}
        </button>
      </div>

      {error && <p className="px-4 pb-3 text-[11px] text-red-400">{error}</p>}

      {draft && (
        <div className="px-4 pb-4 space-y-3 border-t border-zinc-800 pt-3">
          <label className="block">
            <div className="text-[11px] text-zinc-500 mb-1">SEO 標題</div>
            <input value={draft.seoTitle} onChange={(e) => field('seoTitle', e.target.value)} className={inputClass} />
          </label>
          <label className="block">
            <div className="text-[11px] text-zinc-500 mb-1">副標 (deck)</div>
            <input value={draft.deck} onChange={(e) => field('deck', e.target.value)} className={inputClass} />
          </label>
          <label className="block">
            <div className="text-[11px] text-zinc-500 mb-1">Meta description</div>
            <input
              value={draft.seoDescription}
              onChange={(e) => field('seoDescription', e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block">
            <div className="text-[11px] text-zinc-500 mb-1">正文 (Markdown)</div>
            <textarea
              value={draft.bodyMarkdown}
              onChange={(e) => field('bodyMarkdown', e.target.value)}
              rows={16}
              className={`${inputClass} font-mono resize-y`}
            />
          </label>

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 hover:text-zinc-100 disabled:opacity-50 text-sm transition-colors cursor-pointer"
            >
              {saving ? '儲存中…' : '儲存編輯'}
            </button>
            <button
              onClick={copyRichHtml}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors cursor-pointer"
            >
              {copied ? '已複製 ✓' : '複製內容（貼進 Substack）'}
            </button>
            <a href={SUBSTACK_NEW_POST_URL} target="_blank" rel="noopener noreferrer">
              <button className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 hover:text-zinc-100 text-sm transition-colors cursor-pointer">
                開啟 Substack 新文章
              </button>
            </a>
          </div>

          <details>
            <summary className="cursor-pointer text-[11px] text-zinc-500">預覽（複製來源）</summary>
            <div
              ref={previewRef}
              className="mt-2 border border-zinc-800 rounded-lg p-3 text-sm text-zinc-300 leading-relaxed [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-zinc-100 [&_h2]:mt-3 [&_a]:text-violet-400 [&_ul]:list-disc [&_ul]:pl-5 [&_p]:my-2"
            >
              <ReactMarkdown>{draft.bodyMarkdown}</ReactMarkdown>
            </div>
          </details>

          <p className="text-[11px] text-zinc-500">
            待你手動在 Substack 後台填：封面圖（Canva 模板）、SEO 標題/描述、內嵌音檔。
          </p>
        </div>
      )}
    </div>
  );
}
