import { getDb } from '@/db';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import DebugClient from './DebugClient';

export const dynamic = 'force-dynamic';

const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

export default async function DebugPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const episodeId = parseInt(id);
  if (isNaN(episodeId)) notFound();

  const db = getDb();
  const episode = db.prepare('SELECT id, episode_number, selected_title, created_at FROM episodes WHERE id = ?')
    .get(episodeId) as { id: number; episode_number: number | null; selected_title: string | null; created_at: string } | undefined;
  if (!episode) notFound();

  const headerLabel = episode.episode_number
    ? `EP ${episode.episode_number}`
    : (() => {
        const date = episode.created_at?.split('T')[0] || '';
        if (date) {
          const d = new Date(date);
          return `${date} (${DAY_LABELS[d.getDay()] || ''})`;
        }
        return `#${episode.id}`;
      })();

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      <header className="mb-6">
        <Link
          href={`/episodes/${episodeId}/review`}
          className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-brand transition-colors mb-3"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Review
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">
          {headerLabel} Debug
        </h1>
        {episode.selected_title && (
          <p className="text-zinc-400 text-sm mt-1">{episode.selected_title}</p>
        )}
      </header>
      <DebugClient episodeId={episodeId} />
    </div>
  );
}
