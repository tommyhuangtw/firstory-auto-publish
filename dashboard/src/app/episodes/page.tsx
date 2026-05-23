import Link from 'next/link';
import { getDb } from '@/db';
import { formatLocalDate, getLocalDayOfWeek } from '@/lib/formatDate';
import NewEpisodeForm from './NewEpisodeForm';
import ActivePipelines from './ActivePipelines';
import DeleteButton from './DeleteButton';

export const dynamic = 'force-dynamic';

interface Episode {
  id: number;
  episode_number: number | null;
  segment_type: string;
  status: string;
  selected_title: string | null;
  quality_score: number | null;
  total_cost_usd: number | null;
  created_at: string;
  current_stage: string | null;
  pipeline_status: string | null;
  error_log: string | null;
}

const segmentLabels: Record<string, string> = {
  daily: 'AI懶人報',
  weekly: 'AI精選週報',
  robot: '機器人週報',
  sysdesign: '系統設計懶懶學',
  quickchat: '懶懶碎碎念',
};

const segmentColors: Record<string, string> = {
  daily: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  weekly: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
  robot: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  sysdesign: 'bg-teal-500/15 text-teal-400 border-teal-500/20',
  quickchat: 'bg-pink-500/15 text-pink-400 border-pink-500/20',
};

const statusConfig: Record<string, { color: string; label: string }> = {
  generating: { color: 'bg-yellow-500/15 text-yellow-400', label: '生成中' },
  pending_review: { color: 'bg-blue-500/15 text-blue-300', label: '待審核' },
  approved: { color: 'bg-indigo-500/15 text-indigo-300', label: '已核准' },
  publishing: { color: 'bg-purple-500/15 text-purple-300', label: '發布中' },
  published: { color: 'bg-emerald-500/15 text-emerald-400', label: '已發布' },
  rejected: { color: 'bg-red-500/15 text-red-400', label: '已拒絕' },
  failed: { color: 'bg-red-500/15 text-red-400', label: '失敗' },
};

const STAGE_KEYS = [
  'fetchYoutube', 'classify', 'scriptEnglish', 'extractTools', 'translate',
  'customContentInsert', 'enrichMemory', 'scoreQuality', 'generateMeta',
  'generateCover', 'synthesizeTts', 'uploadAssets', 'notify',
];

const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

function formatEpisodeLabel(ep: Episode): string {
  if (ep.episode_number) return `EP ${ep.episode_number}`;
  // Show date + day of week for unpublished episodes (UTC-aware)
  if (ep.created_at) {
    const dateStr = formatLocalDate(ep.created_at);
    const dayLabel = DAY_LABELS[getLocalDayOfWeek(ep.created_at)] || '';
    return `${dateStr} (${dayLabel})`;
  }
  return `#${ep.id}`;
}

export default function EpisodesPage() {
  const db = getDb();
  const episodes = db.prepare(`
    SELECT e.id, e.episode_number, e.segment_type, e.status,
           e.selected_title, e.quality_score, e.total_cost_usd, e.created_at,
           pr.current_stage, pr.status as pipeline_status, pr.error_log
    FROM episodes e
    LEFT JOIN pipeline_runs pr ON pr.id = (
      SELECT id FROM pipeline_runs
      WHERE episode_id = e.id
      ORDER BY id DESC LIMIT 1
    )
    ORDER BY e.id DESC
  `).all() as Episode[];

  // Separate running pipelines from completed episodes
  const activePipelines = episodes.filter(
    (ep) => ep.status === 'generating' && ep.pipeline_status === 'running'
  );
  const otherEpisodes = episodes.filter(
    (ep) => !(ep.status === 'generating' && ep.pipeline_status === 'running')
  );

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <span className="w-1 h-6 rounded-full bg-brand" />
              Episodes
            </h1>
            <p className="text-zinc-400 text-sm mt-1">
              {episodes.length} episode{episodes.length !== 1 ? 's' : ''}
            </p>
          </div>
          <NewEpisodeForm />
        </div>
      </header>

      {/* Active Pipelines — client component with live polling */}
      {activePipelines.length > 0 && (
        <section className="mb-6">
          <ActivePipelines
            initialRuns={activePipelines.map((ep) => ({
              episode_id: ep.id,
              segment_type: ep.segment_type,
              current_stage: ep.current_stage,
              pipeline_status: ep.pipeline_status,
              error_log: ep.error_log,
            }))}
          />
        </section>
      )}

      {/* Episode List */}
      {otherEpisodes.length === 0 && activePipelines.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-zinc-800/80 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-zinc-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </div>
          <p className="text-zinc-400 text-sm">還沒有 episode，點右上角開始建立</p>
        </div>
      ) : (
        <div className="space-y-2">
          {otherEpisodes.map((ep) => {
            const stageIdx = ep.current_stage ? STAGE_KEYS.indexOf(ep.current_stage) : -1;
            const progress = ep.status === 'generating' && stageIdx >= 0
              ? Math.round(((stageIdx + 1) / STAGE_KEYS.length) * 100)
              : null;
            const sc = statusConfig[ep.status] || { color: 'bg-zinc-800 text-zinc-400', label: ep.status };
            const seg = segmentColors[ep.segment_type] || 'bg-zinc-800 text-zinc-400 border-zinc-700';
            const epLabel = formatEpisodeLabel(ep);

            return (
              <Link
                key={ep.id}
                href={`/episodes/${ep.id}/review`}
                className="group block rounded-xl bg-zinc-900/60 border border-zinc-800/60 hover:border-brand/30 hover:bg-zinc-900 transition-all duration-200 cursor-pointer"
              >
                <div className="p-4">
                  <div className="flex items-center justify-between gap-4">
                    {/* Left: EP label + badges */}
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-base font-mono font-semibold text-zinc-200 tabular-nums shrink-0">
                        {epLabel}
                      </span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border ${seg}`}>
                        {segmentLabels[ep.segment_type] || ep.segment_type}
                      </span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ${sc.color}`}>
                        {sc.label}
                      </span>
                    </div>

                    {/* Right: metadata */}
                    <div className="flex items-center gap-4 text-xs text-zinc-400 shrink-0">
                      {ep.quality_score != null && (
                        <span className="tabular-nums">{ep.quality_score.toFixed(0)} pts</span>
                      )}
                      {ep.total_cost_usd != null && (
                        <span className="tabular-nums">${ep.total_cost_usd.toFixed(3)}</span>
                      )}
                      <span className="tabular-nums">{formatLocalDate(ep.created_at)}</span>
                      {ep.status !== 'published' && (
                        <DeleteButton episodeId={ep.id} />
                      )}
                      <svg className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300 transition-colors" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                    </div>
                  </div>

                  {/* Title */}
                  {ep.selected_title && (
                    <p className="mt-2 text-sm text-zinc-400 truncate group-hover:text-zinc-300 transition-colors">
                      {ep.selected_title}
                    </p>
                  )}

                  {/* Inline progress bar for stalled/generating */}
                  {progress != null && (
                    <div className="mt-3">
                      <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
                        <div className="h-full rounded-full bg-yellow-500/70 transition-all duration-500" style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                  )}

                  {/* Error */}
                  {ep.error_log && (
                    <p className="mt-2 text-xs text-red-400/80 truncate">{ep.error_log}</p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
