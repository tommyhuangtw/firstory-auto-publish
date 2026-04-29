import path from 'path';
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
import ShortsSection from './ShortsSection';
import IgCaptionSection from './IgCaptionSection';
import RegenerateCoverButton from './RegenerateCoverButton';
import FbCaptionSection from './FbCaptionSection';
import ThreadsCaptionSection from './ThreadsCaptionSection';

export const dynamic = 'force-dynamic';

interface Episode {
  id: number;
  episode_number: number | null;
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
  fb_caption: string | null;
  fb_post_id: string | null;
  threads_caption: string | null;
  threads_post_id: string | null;
  source_links: string | null;
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
  sysdesign: '系統設計懶懶學',
};

const segmentColors: Record<string, string> = {
  daily: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  weekly: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
  robot: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  sysdesign: 'bg-teal-500/15 text-teal-400 border-teal-500/20',
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

const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

function formatEpisodeHeader(episode: Episode): string {
  if (episode.episode_number) return `EP ${episode.episode_number}`;
  const date = episode.created_at?.split('T')[0] || '';
  if (date) {
    const d = new Date(date);
    const dayLabel = DAY_LABELS[d.getDay()] || '';
    return `${date} (${dayLabel})`;
  }
  return `#${episode.id}`;
}

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const episodeId = parseInt(id);
  if (isNaN(episodeId)) notFound();

  const db = getDb();
  const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId) as Episode | undefined;
  if (!episode) notFound();

  // Get latest pipeline run
  const pipelineRun = db.prepare(
    `SELECT id, error_log, current_stage, status FROM pipeline_runs
     WHERE episode_id = ? ORDER BY id DESC LIMIT 1`
  ).get(episodeId) as PipelineRun | undefined;

  // Get LLM calls for this episode
  const llmCalls = db.prepare(
    `SELECT * FROM llm_calls WHERE episode_id = ? ORDER BY id ASC`
  ).all(episodeId) as LlmCall[];

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
  const sourceLinks: { title: string; url: string }[] = episode.source_links ? JSON.parse(episode.source_links) : [];

  // Cover candidates
  const coverCandidatesRaw = db.prepare('SELECT cover_candidates FROM episodes WHERE id = ?').get(episodeId) as { cover_candidates: string | null } | undefined;
  const coverCandidates: { path: string; url: string; createdAt: string; source: string }[] = coverCandidatesRaw?.cover_candidates ? JSON.parse(coverCandidatesRaw.cover_candidates) : [];

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

  // Get latest shorts for this episode
  const shortsRow = db.prepare(
    `SELECT id, status, current_stage, error_log, video_path, cover_path,
            ig_caption, ig_post_id, beats_json, selected_beat_index,
            headlines_json, selected_headline_index, avatar_filename
     FROM shorts WHERE episode_id = ? ORDER BY id DESC LIMIT 1`
  ).get(episodeId) as {
    id: number; status: string; current_stage: string | null; error_log: string | null;
    video_path: string | null; cover_path: string | null; ig_caption: string | null;
    ig_post_id: string | null; beats_json: string | null; selected_beat_index: number | null;
    headlines_json: string | null; selected_headline_index: number | null;
    avatar_filename: string | null;
  } | undefined;

  const canEdit = episode.status === 'pending_review' || episode.status === 'failed' || episode.status === 'publishing';
  const sc = statusConfig[episode.status] || { color: 'bg-zinc-800 text-zinc-400', label: episode.status };
  const seg = segmentColors[episode.segment_type] || 'bg-zinc-800 text-zinc-400 border-zinc-700';
  const headerLabel = formatEpisodeHeader(episode);

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
          <h1 className="text-2xl font-semibold tracking-tight">{headerLabel}</h1>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border ${seg}`}>
            {segmentLabels[episode.segment_type] || episode.segment_type}
          </span>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ${sc.color}`}>
            {sc.label}
          </span>
          <Link
            href={`/episodes/${episode.id}/debug`}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors ml-auto"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 12.75c1.148 0 2.278.08 3.383.237 1.037.146 1.866.966 1.866 2.013 0 3.728-2.35 6.75-5.25 6.75S6.75 18.728 6.75 15c0-1.046.83-1.867 1.866-2.013A24.204 24.204 0 0112 12.75zm0 0c2.883 0 5.647.508 8.207 1.44a23.91 23.91 0 01-1.152-6.135 3.001 3.001 0 00-2.833-2.805 24.919 24.919 0 00-8.444 0 3.001 3.001 0 00-2.833 2.805A23.978 23.978 0 016.207 14.19C8.353 13.258 11.117 12.75 12 12.75zm0 0V8.25" />
            </svg>
            Debug
          </Link>
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
          <RegenerateCoverButton
            episodeId={episode.id}
            coverPath={episode.cover_path}
            candidates={coverCandidates}
          />
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

        {/* Interactive Review Section (title picker, approve/reject, collapsible details) */}
        <ReviewClient
          episodeId={episode.id}
          episodeNumber={episode.episode_number}
          status={episode.status}
          segmentType={episode.segment_type}
          candidateTitles={candidateTitles}
          selectedTitle={episode.selected_title || ''}
          description={episode.description || ''}
          tags={tags}
          soundonUrl={episode.soundon_url}
          youtubeUrl={episode.youtube_url}
        />

        {/* Podcast IG 貼文 — independent section */}
        <IgCaptionSection
          episodeId={episode.id}
          igCaption={igCaption}
          igPostId={episode.ig_post_id}
          coverPath={episode.cover_path}
          canEdit={episode.status === 'pending_review' || episode.status === 'published' || episode.status === 'approved' || episode.status === 'publishing'}
        />

        {/* Facebook 貼文 — independent section */}
        <FbCaptionSection
          episodeId={episode.id}
          fbCaption={episode.fb_caption || ''}
          fbPostId={episode.fb_post_id}
          coverPath={episode.cover_path}
          canEdit={episode.status === 'pending_review' || episode.status === 'published' || episode.status === 'approved' || episode.status === 'publishing'}
        />

        {/* Threads 貼文 — 開發中，暫時隱藏 */}
        {/* <ThreadsCaptionSection
          episodeId={episode.id}
          threadsCaption={episode.threads_caption || ''}
          threadsPostId={episode.threads_post_id}
          coverPath={episode.cover_path}
          canEdit={episode.status === 'pending_review' || episode.status === 'published' || episode.status === 'approved' || episode.status === 'publishing'}
        /> */}

        {/* Retry Controls — quick access for failed episodes */}
        {pipelineRun && (episode.status === 'failed' || episode.status === 'pending_review' || episode.status === 'publishing') && (
          <RetryControls
            pipelineRunId={pipelineRun.id}
            failedStage={pipelineRun.status === 'failed' ? pipelineRun.current_stage : null}
          />
        )}

        {/* Publish Status + Republish */}
        {(episode.status === 'published' || episode.status === 'publishing') && (
          <RepublishSection
            episodeId={episode.id}
            episodeStatus={episode.status}
            soundonUrl={episode.soundon_url}
            youtubeUrl={episode.youtube_url}
          />
        )}

        {/* Shorts Generation */}
        {(episode.status === 'published' || episode.status === 'pending_review' || episode.status === 'publishing') && (
          <ShortsSection
            episodeId={episode.id}
            initialShorts={shortsRow ? {
              ...shortsRow,
              avatar_path: shortsRow.avatar_filename
                ? path.join(process.cwd(), '..', 'remotion', 'public', shortsRow.avatar_filename)
                : null,
            } : null}
            segmentType={episode.segment_type}
          />
        )}

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
            episodeId={episode.id}
            scriptEn={episode.script_en || ''}
            scriptZh={episode.script_zh || ''}
            pipelineRunId={pipelineRun?.id ?? null}
            canEdit={canEdit}
          />
        )}

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
        <SourceVideos
          videos={sourceVideos}
          canEdit={canEdit}
          pipelineRunId={pipelineRun?.id}
        />

        {/* Source Links (sysdesign) */}
        {sourceLinks.length > 0 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <h3 className="text-sm font-medium text-zinc-300 mb-3">參考資料連結</h3>
            <div className="space-y-2">
              {sourceLinks.map((link, i) => (
                <a
                  key={i}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-teal-400 hover:text-teal-300 transition-colors"
                >
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-1.135a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.5 8.25" />
                  </svg>
                  {link.title}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
