import { getDb } from '@/db';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import ReviewClient from './ReviewClient';
import PipelineTimeline from './PipelineTimeline';
import ScriptEditor from './ScriptEditor';
import QualityBreakdown from './QualityBreakdown';
import QualityHistory from './QualityHistory';
import LlmCallsLog from './LlmCallsLog';
import SourceVideos from './SourceVideos';
import RetryControls from './RetryControls';
import RepublishSection from './RepublishSection';

export const dynamic = 'force-dynamic';

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
  youtube_description: string | null;
  tags: string | null;
  audio_path: string | null;
  cover_path: string | null;
  source_videos: string | null;
  quality_score: number | null;
  total_cost_usd: number | null;
  script_word_count: number | null;
  soundon_url: string | null;
  youtube_url: string | null;
  ig_caption: string | null;
  ig_post_id: string | null;
  created_at: string;
  approved_at: string | null;
  published_at: string | null;
}

interface PipelineRun {
  id: number;
  error_log: string | null;
  current_stage: string | null;
  status: string;
}

interface LlmCall {
  id: number;
  stage: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  success: number;
  error_message: string | null;
  created_at: string;
}

const segmentLabels: Record<string, string> = {
  daily: 'AI懶人報',
  weekly: 'AI精選週報',
  robot: '機器人週報',
};

const segmentColors: Record<string, string> = {
  daily: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  weekly: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
  robot: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
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

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const episodeNumber = parseInt(id);
  if (isNaN(episodeNumber)) notFound();

  const db = getDb();
  const episode = db.prepare('SELECT * FROM episodes WHERE episode_number = ?').get(episodeNumber) as Episode | undefined;
  if (!episode) notFound();

  // Get latest pipeline run
  const pipelineRun = db.prepare(
    `SELECT id, error_log, current_stage, status FROM pipeline_runs
     WHERE episode_number = ? ORDER BY id DESC LIMIT 1`
  ).get(episodeNumber) as PipelineRun | undefined;

  // Get LLM calls for this episode
  const llmCalls = db.prepare(
    `SELECT * FROM llm_calls WHERE episode_number = ? ORDER BY id ASC`
  ).all(episodeNumber) as LlmCall[];

  // Get quality score from latest snapshot if available
  let qualityScoreData = null;
  let qualityIterations = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let qualityHistory: any[] = [];
  if (pipelineRun) {
    const qSnapshot = db.prepare(
      `SELECT output_data FROM pipeline_snapshots
       WHERE pipeline_run_id = ? AND stage = 'scoreQuality'
       ORDER BY id DESC LIMIT 1`
    ).get(pipelineRun.id) as { output_data: string } | undefined;

    if (qSnapshot) {
      try {
        const data = JSON.parse(qSnapshot.output_data);
        if (data.qualityScore) qualityScoreData = data.qualityScore;
        if (data.qualityIterations != null) qualityIterations = data.qualityIterations;
        if (Array.isArray(data.qualityHistory)) qualityHistory = data.qualityHistory;
      } catch { /* skip */ }
    }
  }

  const candidateTitles: string[] = episode.candidate_titles ? JSON.parse(episode.candidate_titles) : [];
  const tags: string[] = episode.tags ? JSON.parse(episode.tags) : [];
  const sourceVideos = episode.source_videos ? JSON.parse(episode.source_videos) : [];

  // Recover ig_caption from pipeline snapshot if not in episodes table
  let igCaption = episode.ig_caption || '';
  if (!igCaption && pipelineRun) {
    const notifySnapshot = db.prepare(
      `SELECT output_data FROM pipeline_snapshots
       WHERE pipeline_run_id = ? AND stage = 'notify'
       ORDER BY id DESC LIMIT 1`
    ).get(pipelineRun.id) as { output_data: string } | undefined;
    if (notifySnapshot) {
      try {
        const data = JSON.parse(notifySnapshot.output_data);
        if (data.igCaption) igCaption = data.igCaption;
      } catch { /* skip */ }
    }
  }

  const canEdit = episode.status === 'pending_review' || episode.status === 'failed';
  const sc = statusConfig[episode.status] || { color: 'bg-zinc-800 text-zinc-400', label: episode.status };
  const seg = segmentColors[episode.segment_type] || 'bg-zinc-800 text-zinc-400 border-zinc-700';

  return (
    <div className="p-6 md:p-8 max-w-4xl">
      {/* Back link + Header */}
      <header className="mb-8">
        <Link
          href="/episodes"
          className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-brand transition-colors mb-4"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Episodes
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">EP {episode.episode_number}</h1>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border ${seg}`}>
            {segmentLabels[episode.segment_type] || episode.segment_type}
          </span>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ${sc.color}`}>
            {sc.label}
          </span>
        </div>
        {episode.selected_title && (
          <p className="text-zinc-400 text-sm mt-2">{episode.selected_title}</p>
        )}
        <p className="text-zinc-400 text-xs mt-1">{episode.created_at?.split('T')[0]}</p>
      </header>

      <div className="space-y-6">
        {/* Pipeline Error Banner */}
        {pipelineRun?.error_log && (pipelineRun.status === 'failed' || episode.status === 'generating') && (
          <div className="rounded-xl bg-red-950/20 border border-red-900/30 p-4">
            <div className="flex items-start gap-2">
              <svg className="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <div>
                <p className="text-[11px] font-medium text-red-400 mb-1">
                  Pipeline 錯誤 — 階段: {pipelineRun.current_stage}
                </p>
                <p className="text-[11px] text-red-300/80 font-mono break-all">{pipelineRun.error_log}</p>
              </div>
            </div>
          </div>
        )}

        {/* Cover + Audio row */}
        <div className="flex gap-4">
          {episode.cover_path && (
            <div className="shrink-0">
              <img
                src={`/api/audio${episode.cover_path}`}
                alt={`EP ${episode.episode_number} cover`}
                className="rounded-xl border border-brand/30 w-40 h-40 object-cover"
              />
            </div>
          )}
          {episode.audio_path && (
            <div className="flex-1 flex flex-col justify-end">
              <p className="text-[11px] text-zinc-400 mb-1.5">Audio</p>
              <audio
                controls
                className="w-full"
                src={`/api/audio${episode.audio_path}`}
                preload="metadata"
              />
            </div>
          )}
        </div>

        {/* Quality Breakdown */}
        {qualityScoreData && (
          <QualityBreakdown
            qualityScore={qualityScoreData}
            qualityIterations={qualityIterations}
            totalCost={episode.total_cost_usd}
            wordCount={episode.script_word_count}
          />
        )}

        {/* Quality Iteration History */}
        {qualityHistory.length > 1 && (
          <QualityHistory history={qualityHistory} />
        )}

        {/* Fallback: simple quality display if no snapshot data */}
        {!qualityScoreData && episode.quality_score != null && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <h3 className="text-sm font-medium text-zinc-300 mb-2">Quality</h3>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums">{episode.quality_score.toFixed(0)}</span>
              <span className="text-zinc-400">/100</span>
            </div>
            <div className="flex gap-3 mt-2 text-[11px] text-zinc-400">
              {episode.total_cost_usd != null && <span className="tabular-nums">${episode.total_cost_usd.toFixed(4)}</span>}
              {episode.script_word_count != null && <span className="tabular-nums">{episode.script_word_count.toLocaleString()} 字</span>}
            </div>
          </div>
        )}

        {/* Script Editor */}
        {(episode.script_zh || episode.script_en) && (
          <ScriptEditor
            episodeNumber={episode.episode_number}
            scriptEn={episode.script_en || ''}
            scriptZh={episode.script_zh || ''}
            pipelineRunId={pipelineRun?.id ?? null}
            canEdit={canEdit}
          />
        )}

        {/* Interactive Review Section (title picker, description, approve/reject) */}
        <ReviewClient
          episodeNumber={episode.episode_number}
          status={episode.status}
          segmentType={episode.segment_type}
          candidateTitles={candidateTitles}
          selectedTitle={episode.selected_title || ''}
          description={episode.description || ''}
          igCaption={igCaption}
          tags={tags}
          soundonUrl={episode.soundon_url}
          youtubeUrl={episode.youtube_url}
        />

        {/* Pipeline Timeline */}
        {pipelineRun && (
          <PipelineTimeline
            pipelineRunId={pipelineRun.id}
            currentStage={pipelineRun.current_stage}
            pipelineStatus={pipelineRun.status}
            errorLog={pipelineRun.error_log}
          />
        )}

        {/* LLM Calls Log */}
        <LlmCallsLog calls={llmCalls} />

        {/* Source Videos */}
        <SourceVideos videos={sourceVideos} />

        {/* Retry Controls */}
        {pipelineRun && (episode.status === 'failed' || episode.status === 'pending_review') && (
          <RetryControls
            pipelineRunId={pipelineRun.id}
            failedStage={pipelineRun.status === 'failed' ? pipelineRun.current_stage : null}
          />
        )}

        {/* Publish Status + Republish */}
        {episode.status === 'published' && (
          <RepublishSection
            episodeNumber={episode.episode_number}
            soundonUrl={episode.soundon_url}
            youtubeUrl={episode.youtube_url}
            igPostId={episode.ig_post_id}
          />
        )}
      </div>
    </div>
  );
}
