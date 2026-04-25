import { getDb } from '@/db';
import { notFound } from 'next/navigation';
import ReviewClient from './ReviewClient';

interface Episode {
  id: number;
  episode_number: number;
  segment_type: string;
  status: string;
  script_en: string | null;
  script_zh: string | null;
  candidate_titles: string | null;
  selected_title: string | null;
  description: string | null;
  tags: string | null;
  audio_path: string | null;
  cover_path: string | null;
  source_videos: string | null;
  quality_score: number | null;
  total_cost_usd: number | null;
  script_word_count: number | null;
  soundon_url: string | null;
  youtube_url: string | null;
  created_at: string;
  approved_at: string | null;
  published_at: string | null;
}

interface PipelineRun {
  error_log: string | null;
  current_stage: string | null;
  status: string;
}

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const episodeNumber = parseInt(id);
  if (isNaN(episodeNumber)) notFound();

  const db = getDb();
  const episode = db.prepare('SELECT * FROM episodes WHERE episode_number = ?').get(episodeNumber) as Episode | undefined;
  if (!episode) notFound();

  // Get latest pipeline run for error info
  const pipelineRun = db.prepare(
    `SELECT error_log, current_stage, status FROM pipeline_runs
     WHERE episode_number = ? ORDER BY id DESC LIMIT 1`
  ).get(episodeNumber) as PipelineRun | undefined;

  const candidateTitles: string[] = episode.candidate_titles ? JSON.parse(episode.candidate_titles) : [];
  const tags: string[] = episode.tags ? JSON.parse(episode.tags) : [];
  const sourceVideos = episode.source_videos ? JSON.parse(episode.source_videos) : [];

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto">
      <header className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl font-bold">EP #{episode.episode_number}</h1>
          <span className="text-xs uppercase text-zinc-500">{episode.segment_type}</span>
        </div>
        <StatusBadge status={episode.status} />
      </header>

      {/* Pipeline Error */}
      {pipelineRun?.error_log && (pipelineRun.status === 'failed' || episode.status === 'generating') && (
        <section className="mb-6 bg-red-950/30 border border-red-900/50 rounded-lg p-4">
          <h2 className="text-sm font-medium text-red-400 uppercase tracking-wider mb-2">Pipeline 錯誤</h2>
          <p className="text-sm text-red-300 font-mono whitespace-pre-wrap break-all">
            {pipelineRun.error_log}
          </p>
          {pipelineRun.current_stage && (
            <p className="text-xs text-red-400/70 mt-2">失敗階段: {pipelineRun.current_stage}</p>
          )}
        </section>
      )}

      {/* Cover Image Preview */}
      {episode.cover_path && (
        <section className="mb-6">
          <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-2">封面圖</h2>
          <img
            src={`/api/audio${episode.cover_path}`}
            alt={`EP #${episode.episode_number} cover`}
            className="rounded-lg border border-zinc-800 max-w-xs"
          />
        </section>
      )}

      {/* Audio Player */}
      {episode.audio_path && (
        <section className="mb-6">
          <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-2">Audio</h2>
          <audio
            controls
            className="w-full"
            src={`/api/audio${episode.audio_path}`}
            preload="metadata"
          />
        </section>
      )}

      {/* Quality Score */}
      {episode.quality_score != null && (
        <section className="mb-6 bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-2">Quality</h2>
          <div className="flex items-center gap-3">
            <span className="text-3xl font-bold">{episode.quality_score.toFixed(0)}</span>
            <span className="text-zinc-500">/100</span>
          </div>
          {episode.total_cost_usd != null && (
            <p className="text-xs text-zinc-500 mt-1">Cost: ${episode.total_cost_usd.toFixed(4)}</p>
          )}
          {episode.script_word_count != null && (
            <p className="text-xs text-zinc-500">Word count: {episode.script_word_count.toLocaleString()}</p>
          )}
        </section>
      )}

      {/* Interactive Review Section */}
      <ReviewClient
        episodeNumber={episode.episode_number}
        status={episode.status}
        candidateTitles={candidateTitles}
        selectedTitle={episode.selected_title || ''}
        description={episode.description || ''}
        tags={tags}
        soundonUrl={episode.soundon_url}
        youtubeUrl={episode.youtube_url}
      />

      {/* Source Videos */}
      {sourceVideos.length > 0 && (
        <section className="mt-6">
          <details className="bg-zinc-900 rounded-lg border border-zinc-800">
            <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-zinc-400 uppercase tracking-wider">
              Source Videos ({sourceVideos.length})
            </summary>
            <div className="px-4 pb-4 space-y-2">
              {sourceVideos.map((v: Record<string, unknown>, i: number) => (
                <div key={i} className="text-sm">
                  <p className="text-zinc-300">{v.title as string}</p>
                  <p className="text-xs text-zinc-500">{v.channelTitle as string}</p>
                </div>
              ))}
            </div>
          </details>
        </section>
      )}

      {/* Publish URLs */}
      {(episode.soundon_url || episode.youtube_url) && (
        <section className="mt-6 bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-2">Published</h2>
          {episode.soundon_url && (
            <a href={episode.soundon_url} target="_blank" rel="noopener noreferrer" className="block text-sm text-blue-400 hover:underline">
              SoundOn
            </a>
          )}
          {episode.youtube_url && (
            <a href={episode.youtube_url} target="_blank" rel="noopener noreferrer" className="block text-sm text-blue-400 hover:underline mt-1">
              YouTube
            </a>
          )}
        </section>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    generating: 'bg-yellow-900/50 text-yellow-300',
    pending_review: 'bg-blue-900/50 text-blue-300',
    approved: 'bg-indigo-900/50 text-indigo-300',
    publishing: 'bg-purple-900/50 text-purple-300',
    published: 'bg-green-900/50 text-green-300',
    rejected: 'bg-red-900/50 text-red-300',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${colors[status] || 'bg-zinc-800 text-zinc-400'}`}>
      {status}
    </span>
  );
}
