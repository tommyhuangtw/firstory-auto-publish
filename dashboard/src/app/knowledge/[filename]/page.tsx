import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDocByFilename, getDocContent } from '@/services/knowledgeService';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const categoryColors: Record<string, string> = {
  content:      'bg-purple-900/50 text-purple-300',
  infra:        'bg-zinc-800 text-zinc-400',
  social_media: 'bg-pink-900/50 text-pink-300',
  youtube:      'bg-red-900/50 text-red-300',
  ig:           'bg-fuchsia-900/50 text-fuchsia-300',
  threads:      'bg-sky-900/50 text-sky-300',
  research:     'bg-teal-900/50 text-teal-300',
  ops:          'bg-amber-900/50 text-amber-300',
  growth:       'bg-green-900/50 text-green-300',
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export default async function KnowledgeDetailPage({
  params,
}: {
  params: Promise<{ filename: string }>;
}) {
  const { filename } = await params;
  const decoded = decodeURIComponent(filename);

  if (!/^[\w\u4e00-\u9fff\-.]+\.md$/.test(decoded)) notFound();

  const doc = getDocByFilename(decoded);
  const content = getDocContent(decoded);
  if (!content) notFound();

  const title = doc?.title || decoded.replace(/\.md$/, '').replace(/-/g, ' ');

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto">
      <Link
        href="/knowledge"
        className="text-sm text-zinc-400 hover:text-zinc-300 mb-4 inline-flex items-center gap-1"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Knowledge Base
      </Link>

      <header className="mb-8 mt-4">
        <h1 className="text-2xl font-bold text-zinc-100">{title}</h1>
        <div className="flex flex-wrap items-center gap-3 mt-3">
          {doc?.category && (
            <span className={`px-2 py-0.5 rounded-full text-xs ${categoryColors[doc.category] || 'bg-zinc-800 text-zinc-400'}`}>
              {doc.category}
            </span>
          )}
          {doc?.word_count && (
            <span className="text-sm text-zinc-500">{doc.word_count.toLocaleString()} words</span>
          )}
          {doc?.created_at && (
            <span className="text-sm text-zinc-500">{formatDate(doc.created_at)}</span>
          )}
          {doc?.task_id && (
            <Link href="/tasks" className="text-sm text-brand hover:text-brand-light transition-colors">
              Task #{doc.task_id}{doc.task_title ? `: ${doc.task_title}` : ''}
            </Link>
          )}
        </div>
      </header>

      <article className="prose prose-invert prose-zinc max-w-none
        prose-headings:text-zinc-200 prose-headings:font-bold
        prose-p:text-zinc-300 prose-p:leading-relaxed
        prose-a:text-brand prose-a:no-underline hover:prose-a:underline
        prose-strong:text-zinc-200
        prose-li:text-zinc-300
        prose-code:text-brand-light prose-code:bg-zinc-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm
        prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800
        prose-blockquote:border-brand/50 prose-blockquote:text-zinc-400
        prose-table:text-sm
        prose-th:text-zinc-300 prose-th:border-zinc-700
        prose-td:border-zinc-800
        prose-hr:border-zinc-800
      ">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </article>
    </div>
  );
}
