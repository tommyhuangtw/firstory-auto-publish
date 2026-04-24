import Link from 'next/link';
import { getDb } from '@/db';

interface Episode {
  id: number;
  episode_number: number;
  segment_type: string;
  status: string;
  selected_title: string | null;
  quality_score: number | null;
  total_cost_usd: number | null;
  created_at: string;
}

const statusColors: Record<string, string> = {
  generating: 'bg-yellow-900/50 text-yellow-300',
  pending_review: 'bg-blue-900/50 text-blue-300',
  approved: 'bg-indigo-900/50 text-indigo-300',
  publishing: 'bg-purple-900/50 text-purple-300',
  published: 'bg-green-900/50 text-green-300',
  rejected: 'bg-red-900/50 text-red-300',
  failed: 'bg-red-900/50 text-red-300',
};

export default function EpisodesPage() {
  const db = getDb();
  const episodes = db.prepare(
    'SELECT id, episode_number, segment_type, status, selected_title, quality_score, total_cost_usd, created_at FROM episodes ORDER BY episode_number DESC'
  ).all() as Episode[];

  return (
    <div className="p-6 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Episodes</h1>
        <p className="text-zinc-400 text-sm mt-1">{episodes.length} episodes total</p>
      </header>

      {episodes.length === 0 ? (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-500">No episodes yet. Start a pipeline to generate your first episode.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {episodes.map((ep) => (
            <Link
              key={ep.id}
              href={`/episodes/${ep.episode_number}/review`}
              className="block bg-zinc-900 rounded-lg border border-zinc-800 p-4 hover:border-zinc-700 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-lg font-mono font-bold text-zinc-300">
                    #{ep.episode_number}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-xs ${statusColors[ep.status] || 'bg-zinc-800 text-zinc-400'}`}>
                    {ep.status}
                  </span>
                  <span className="text-xs text-zinc-500 uppercase">{ep.segment_type}</span>
                </div>
                <div className="flex items-center gap-4 text-sm text-zinc-500">
                  {ep.quality_score != null && (
                    <span title="Quality score">{ep.quality_score.toFixed(0)}pts</span>
                  )}
                  {ep.total_cost_usd != null && (
                    <span title="Cost">${ep.total_cost_usd.toFixed(3)}</span>
                  )}
                </div>
              </div>
              {ep.selected_title && (
                <p className="mt-2 text-sm text-zinc-300 truncate">{ep.selected_title}</p>
              )}
              <p className="mt-1 text-xs text-zinc-600">{ep.created_at}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
