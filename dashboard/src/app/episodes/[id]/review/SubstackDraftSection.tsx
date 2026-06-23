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
    <section style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Substack 草稿</h2>
        <button onClick={generate} disabled={generating} style={{ padding: '6px 14px' }}>
          {generating ? '產生中…' : draft ? '重新產生' : '產生 Substack 草稿'}
        </button>
      </div>

      {error && <p style={{ color: '#dc2626', marginTop: 8 }}>{error}</p>}

      {draft && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            <div style={{ fontSize: 12, color: '#6b7280' }}>SEO 標題</div>
            <input
              value={draft.seoTitle}
              onChange={(e) => field('seoTitle', e.target.value)}
              style={{ width: '100%', padding: 6 }}
            />
          </label>
          <label>
            <div style={{ fontSize: 12, color: '#6b7280' }}>副標 (deck)</div>
            <input
              value={draft.deck}
              onChange={(e) => field('deck', e.target.value)}
              style={{ width: '100%', padding: 6 }}
            />
          </label>
          <label>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Meta description</div>
            <input
              value={draft.seoDescription}
              onChange={(e) => field('seoDescription', e.target.value)}
              style={{ width: '100%', padding: 6 }}
            />
          </label>
          <label>
            <div style={{ fontSize: 12, color: '#6b7280' }}>正文 (Markdown)</div>
            <textarea
              value={draft.bodyMarkdown}
              onChange={(e) => field('bodyMarkdown', e.target.value)}
              rows={16}
              style={{ width: '100%', padding: 6, fontFamily: 'monospace', fontSize: 13 }}
            />
          </label>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={save} disabled={saving}>{saving ? '儲存中…' : '儲存編輯'}</button>
            <button onClick={copyRichHtml}>{copied ? '已複製 ✓' : '複製內容（貼進 Substack）'}</button>
            <a href={SUBSTACK_NEW_POST_URL} target="_blank" rel="noopener noreferrer">
              <button>開啟 Substack 新文章</button>
            </a>
          </div>

          <details>
            <summary style={{ cursor: 'pointer', fontSize: 13, color: '#6b7280' }}>預覽（複製來源）</summary>
            <div
              ref={previewRef}
              style={{ border: '1px solid #f3f4f6', borderRadius: 6, padding: 12, marginTop: 8 }}
            >
              <ReactMarkdown>{draft.bodyMarkdown}</ReactMarkdown>
            </div>
          </details>

          <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
            待你手動在 Substack 後台填：封面圖（Canva 模板）、SEO 標題/描述、內嵌音檔。
          </p>
        </div>
      )}
    </section>
  );
}
