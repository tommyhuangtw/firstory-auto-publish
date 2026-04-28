/**
 * LangGraph Content Pipeline — StateGraph definition.
 *
 * Replaces n8n workflow. 13 stages (linear) + publish triggered after review:
 * fetch → classify → script → extractTools → translate → customContentInsert → enrichMemory → quality → meta → cover → tts → upload → notify → END
 * (pipeline pauses at 'pending_review'; publish is triggered via /api/episodes/:id/approve)
 */

import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import {
  type PipelineState,
  type PipelineStatus,
  type SegmentType,
  type SourceLink,
  type VideoSource,
  type QualityScore,
  type QualityIteration,
  createInitialState,
} from './state';
import type { ExtractedTool } from '@/services/memory/toolExtractor';
import type { MemoryContext } from '@/services/memory/memoryService';

// Node implementations
import { fetchYoutube } from './nodes/fetchYoutube';
import { classify } from './nodes/classify';
import { scriptEnglish } from './nodes/scriptEnglish';
import { extractTools } from './nodes/extractTools';
import { translate } from './nodes/translate';
import { customContentInsert } from './nodes/customContentInsert';
import { enrichMemory } from './nodes/enrichMemory';
import { qualityScore } from './nodes/qualityScore';
import { generateMeta } from './nodes/generateMeta';
import { generateCover } from './nodes/generateCover';
import { tts } from './nodes/tts';
import { uploadAssets } from './nodes/uploadAssets';
import { notify } from './nodes/notify';
import { publish } from './nodes/publish';

const log = createChildLogger('pipeline');

/**
 * LangGraph Annotation — defines state schema with "last writer wins" reducers.
 */
const PipelineAnnotation = Annotation.Root({
  episodeId: Annotation<number>,
  episodeNumber: Annotation<number | null>,
  segmentType: Annotation<SegmentType>,
  pipelineRunId: Annotation<number>,
  manualVideoUrls: Annotation<string[]>,
  sourceLinks: Annotation<SourceLink[]>,
  videos: Annotation<VideoSource[]>,
  classifiedVideos: Annotation<VideoSource[]>,
  selectedVideos: Annotation<VideoSource[]>,
  excludedVideoIds: Annotation<string[]>,
  scriptEn: Annotation<string>,
  scriptWordCount: Annotation<number>,
  extractedTools: Annotation<ExtractedTool[]>,
  scriptZh: Annotation<string>,
  customContentInserted: Annotation<boolean>,
  memoryContext: Annotation<MemoryContext | null>,
  memoryEnrichments: Annotation<string[]>,
  qualityScore: Annotation<QualityScore | null>,
  qualityIterations: Annotation<number>,
  qualityHistory: Annotation<QualityIteration[]>,
  candidateTitles: Annotation<string[]>,
  selectedTitle: Annotation<string>,
  description: Annotation<string>,
  youtubeDescription: Annotation<string>,
  tags: Annotation<string[]>,
  coverPath: Annotation<string>,
  coverUrl: Annotation<string>,
  audioPath: Annotation<string>,
  audioDurationSec: Annotation<number>,
  driveAudioUrl: Annotation<string>,
  driveImageUrl: Annotation<string>,
  igScenario: Annotation<string>,
  igCaption: Annotation<string>,
  emailHtml: Annotation<string>,
  igPostId: Annotation<string>,
  status: Annotation<PipelineStatus>,
  approvedAt: Annotation<string>,
  soundonUrl: Annotation<string>,
  youtubeUrl: Annotation<string>,
  totalCostUsd: Annotation<number>,
  error: Annotation<string>,
});

type AnnotatedState = typeof PipelineAnnotation.State;

/**
 * Build the compiled LangGraph pipeline.
 */
function buildGraph() {
  const graph = new StateGraph(PipelineAnnotation)
    .addNode('fetchYoutube', wrapNode('fetchYoutube', fetchYoutube))
    .addNode('classify', wrapNode('classify', classify))
    .addNode('scriptEnglish', wrapNode('scriptEnglish', scriptEnglish))
    .addNode('extractTools', wrapNode('extractTools', extractTools))
    .addNode('translate', wrapNode('translate', translate))
    .addNode('customContentInsert', wrapNode('customContentInsert', customContentInsert))
    .addNode('enrichMemory', wrapNode('enrichMemory', enrichMemory))
    .addNode('scoreQuality', wrapNode('scoreQuality', qualityScore))
    .addNode('generateMeta', wrapNode('generateMeta', generateMeta))
    .addNode('generateCover', wrapNode('generateCover', generateCover))
    .addNode('synthesizeTts', wrapNode('synthesizeTts', tts))
    .addNode('uploadAssets', wrapNode('uploadAssets', uploadAssets))
    .addNode('notify', wrapNode('notify', notify))
    .addEdge(START, 'fetchYoutube')
    .addEdge('fetchYoutube', 'classify')
    .addEdge('classify', 'scriptEnglish')
    .addEdge('scriptEnglish', 'extractTools')
    .addEdge('extractTools', 'translate')
    .addEdge('translate', 'customContentInsert')
    .addEdge('customContentInsert', 'enrichMemory')
    .addEdge('enrichMemory', 'scoreQuality')
    .addEdge('scoreQuality', 'generateMeta')
    .addEdge('generateMeta', 'generateCover')
    .addEdge('generateCover', 'synthesizeTts')
    .addEdge('synthesizeTts', 'uploadAssets')
    .addEdge('uploadAssets', 'notify')
    .addEdge('notify', END);

  return graph.compile();
}

// Singleton compiled graph
let _compiledGraph: ReturnType<typeof buildGraph> | null = null;
function getCompiledGraph() {
  if (!_compiledGraph) _compiledGraph = buildGraph();
  return _compiledGraph;
}

/**
 * Start a new pipeline run.
 */
export async function startPipeline(
  episodeId: number,
  segmentType: SegmentType,
  pipelineRunId?: number,
  opts?: { manualVideoUrls?: string[] }
): Promise<{ pipelineRunId: number; state: PipelineState }> {
  const db = getDb();

  // If no pipelineRunId provided, create records (backward compat)
  if (!pipelineRunId) {
    const epResult = db.prepare(
      `INSERT INTO episodes (segment_type, status) VALUES (?, 'generating')`
    ).run(segmentType);
    episodeId = Number(epResult.lastInsertRowid);

    const result = db.prepare(
      `INSERT INTO pipeline_runs (episode_id, segment_type, status, current_stage)
       VALUES (?, ?, 'running', 'fetchYoutube')`
    ).run(episodeId, segmentType);
    pipelineRunId = Number(result.lastInsertRowid);
  }

  const initialState = createInitialState(episodeId, segmentType, pipelineRunId);
  if (opts?.manualVideoUrls?.length) {
    initialState.manualVideoUrls = opts.manualVideoUrls;
  }

  log.info({ episodeId, segmentType, pipelineRunId }, 'Pipeline started');

  try {
    const graph = getCompiledGraph();
    const finalState = await graph.invoke(initialState) as PipelineState;

    // Update pipeline_run
    db.prepare(
      `UPDATE pipeline_runs SET status = 'completed', current_stage = 'notify', completed_at = datetime('now')
       WHERE id = ?`
    ).run(pipelineRunId);

    // Update episode
    updateEpisodeFromState(db, finalState, episodeId);

    log.info({ episodeId, pipelineRunId }, 'Pipeline completed, awaiting review');
    return { pipelineRunId, state: finalState };
  } catch (error) {
    const errMsg = (error as Error).message;
    db.prepare(
      `UPDATE pipeline_runs SET status = 'failed', error_log = ?, completed_at = datetime('now')
       WHERE id = ?`
    ).run(errMsg, pipelineRunId);

    log.error({ episodeId, pipelineRunId, error: errMsg }, 'Pipeline failed');
    throw error;
  }
}

/**
 * Publish an approved episode (called after human review).
 */
export async function publishEpisode(episodeId: number): Promise<Partial<PipelineState>> {
  const db = getDb();
  const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId) as Record<string, unknown> | undefined;

  if (!episode) throw new Error(`Episode id=${episodeId} not found`);
  if (episode.status !== 'pending_review' && episode.status !== 'approved') {
    throw new Error(`Episode id=${episodeId} is not ready for publishing (status: ${episode.status})`);
  }

  // Assign episode number from RSS at publish time
  const { getNextEpisodeNumber } = await import('@/lib/rssEpisodeNumber');
  const episodeNumber = await getNextEpisodeNumber(db);

  db.prepare(`UPDATE episodes SET episode_number = ?, status = 'publishing' WHERE id = ?`)
    .run(episodeNumber, episodeId);

  // Backfill episode_number in related tables
  db.prepare('UPDATE pipeline_runs SET episode_number = ? WHERE episode_id = ?')
    .run(episodeNumber, episodeId);
  db.prepare('UPDATE llm_calls SET episode_number = ? WHERE episode_id = ?')
    .run(episodeNumber, episodeId);
  db.prepare('UPDATE service_costs SET episode_number = ? WHERE episode_id = ?')
    .run(episodeNumber, episodeId);

  log.info({ episodeId, episodeNumber }, 'Episode number assigned at publish time');

  const state: PipelineState = {
    episodeId,
    episodeNumber,
    segmentType: episode.segment_type as SegmentType,
    pipelineRunId: 0,
    manualVideoUrls: [],
    sourceLinks: JSON.parse((episode.source_links as string) || '[]'),
    videos: [],
    classifiedVideos: [],
    selectedVideos: [],
    excludedVideoIds: [],
    scriptEn: (episode.script_en as string) || '',
    scriptWordCount: (episode.script_word_count as number) || 0,
    extractedTools: [],
    scriptZh: (episode.script_zh as string) || '',
    customContentInserted: false,
    memoryContext: null,
    memoryEnrichments: [],
    qualityScore: null,
    qualityIterations: 0,
    qualityHistory: [],
    scriptSummary: '',
    candidateTitles: JSON.parse((episode.candidate_titles as string) || '[]'),
    selectedTitle: (episode.selected_title as string) || '',
    description: (episode.description as string) || '',
    youtubeDescription: (episode.youtube_description as string) || '',
    tags: JSON.parse((episode.tags as string) || '[]'),
    coverPath: (episode.cover_path as string) || '',
    coverUrl: (episode.cover_url as string) || '',
    audioPath: (episode.audio_path as string) || '',
    audioDurationSec: 0,
    driveAudioUrl: '',
    driveImageUrl: '',
    igScenario: '',
    igCaption: (episode.ig_caption as string) || '',
    emailHtml: '',
    igPostId: '',
    status: 'publishing',
    approvedAt: new Date().toISOString(),
    soundonUrl: '',
    youtubeUrl: '',
    totalCostUsd: (episode.total_cost_usd as number) || 0,
    error: '',
    coverError: '',
  };

  return publish(state);
}

/**
 * Ordered list of stage keys — must match the graph edge order.
 */
const STAGE_ORDER = [
  'fetchYoutube', 'classify', 'scriptEnglish', 'extractTools', 'translate',
  'customContentInsert', 'enrichMemory', 'scoreQuality', 'generateMeta',
  'generateCover', 'synthesizeTts', 'uploadAssets', 'notify',
] as const;

/**
 * Map stage names to their node functions.
 */
const NODE_FNS: Record<string, (state: PipelineState) => Promise<Partial<PipelineState>>> = {
  fetchYoutube, classify, scriptEnglish, extractTools, translate,
  customContentInsert, enrichMemory, scoreQuality: qualityScore,
  generateMeta, generateCover, synthesizeTts: tts,
  uploadAssets, notify,
};

/**
 * Retry pipeline from a specific stage.
 * Rebuilds state from snapshots up to (but not including) fromStage,
 * then runs fromStage → END.
 */
export async function retryFromStage(
  pipelineRunId: number,
  fromStage: string,
  stateOverrides?: Partial<PipelineState>
): Promise<{ newPipelineRunId: number }> {
  const db = getDb();
  const fromIdx = STAGE_ORDER.indexOf(fromStage as typeof STAGE_ORDER[number]);
  if (fromIdx < 0) throw new Error(`Unknown stage: ${fromStage}`);

  // Get the original pipeline run info
  const originalRun = db.prepare(
    'SELECT episode_id, episode_number, segment_type FROM pipeline_runs WHERE id = ?'
  ).get(pipelineRunId) as { episode_id: number | null; episode_number: number | null; segment_type: string } | undefined;
  if (!originalRun) throw new Error(`Pipeline run ${pipelineRunId} not found`);

  // Resolve episodeId: prefer episode_id column, fallback to lookup by episode_number (old data)
  let episodeId = originalRun.episode_id;
  if (!episodeId && originalRun.episode_number) {
    const ep = db.prepare('SELECT id FROM episodes WHERE episode_number = ?').get(originalRun.episode_number) as { id: number } | undefined;
    episodeId = ep?.id ?? null;
  }
  if (!episodeId) throw new Error(`Cannot resolve episode for pipeline run ${pipelineRunId}`);

  // Rebuild state from snapshots
  const snapshots = db.prepare(
    `SELECT stage, output_data FROM pipeline_snapshots
     WHERE pipeline_run_id = ? ORDER BY id ASC`
  ).all(pipelineRunId) as { stage: string; output_data: string }[];

  // Create initial state, then layer snapshots up to (before) fromStage
  const state = createInitialState(
    episodeId,
    originalRun.segment_type as SegmentType,
    0 // will be updated below
  );

  for (const snap of snapshots) {
    const snapIdx = STAGE_ORDER.indexOf(snap.stage as typeof STAGE_ORDER[number]);
    if (snapIdx < 0 || snapIdx >= fromIdx) break;
    try {
      Object.assign(state, JSON.parse(snap.output_data));
    } catch { /* skip malformed */ }
  }

  // Apply overrides (e.g. edited scriptZh)
  if (stateOverrides) Object.assign(state, stateOverrides);

  // Create new pipeline run
  const result = db.prepare(
    `INSERT INTO pipeline_runs (episode_id, episode_number, segment_type, status, current_stage)
     VALUES (?, ?, ?, 'running', ?)`
  ).run(episodeId, originalRun.episode_number, originalRun.segment_type, fromStage);
  const newRunId = Number(result.lastInsertRowid);
  state.pipelineRunId = newRunId;

  // Update episode status
  db.prepare(`UPDATE episodes SET status = 'generating' WHERE id = ?`)
    .run(episodeId);

  log.info({ pipelineRunId, newRunId, fromStage }, 'Retry started');

  // Run stages sequentially from fromStage to end
  try {
    let currentState: PipelineState = state;

    for (let i = fromIdx; i < STAGE_ORDER.length; i++) {
      const stageName = STAGE_ORDER[i];
      const fn = NODE_FNS[stageName];
      if (!fn) throw new Error(`No function for stage: ${stageName}`);

      const start = Date.now();
      db.prepare('UPDATE pipeline_runs SET current_stage = ? WHERE id = ?').run(stageName, newRunId);

      const partial = await fn(currentState);
      const elapsed = Date.now() - start;

      // Save snapshot
      try {
        db.prepare(
          `INSERT INTO pipeline_snapshots (pipeline_run_id, stage, output_data, elapsed_ms)
           VALUES (?, ?, ?, ?)`
        ).run(newRunId, stageName, JSON.stringify(partial), elapsed);
      } catch (e) {
        log.warn({ node: stageName, error: (e as Error).message }, 'Failed to save snapshot');
      }

      currentState = { ...currentState, ...partial };
      log.info({ node: stageName, elapsed: `${elapsed}ms` }, 'Retry node completed');
    }

    // Mark completed
    db.prepare(
      `UPDATE pipeline_runs SET status = 'completed', current_stage = 'notify', completed_at = datetime('now')
       WHERE id = ?`
    ).run(newRunId);

    updateEpisodeFromState(db, currentState, episodeId);

    log.info({ newRunId, fromStage }, 'Retry completed');
    return { newPipelineRunId: newRunId };
  } catch (error) {
    const errMsg = (error as Error).message;
    db.prepare(
      `UPDATE pipeline_runs SET status = 'failed', error_log = ?, completed_at = datetime('now')
       WHERE id = ?`
    ).run(errMsg, newRunId);
    log.error({ newRunId, error: errMsg }, 'Retry failed');
    throw error;
  }
}

// ── Helpers ──

/**
 * Wrap a node function with logging and DB stage tracking.
 */
function wrapNode(
  name: string,
  fn: (state: PipelineState) => Promise<Partial<PipelineState>>
) {
  return async (state: AnnotatedState): Promise<Partial<AnnotatedState>> => {
    const start = Date.now();
    log.info({ node: name, episodeId: state.episodeId }, 'Node started');

    // Update current stage in pipeline_runs
    const db = getDb();
    db.prepare('UPDATE pipeline_runs SET current_stage = ? WHERE id = ?').run(name, state.pipelineRunId);

    const result = await fn(state as PipelineState);
    const elapsed = Date.now() - start;

    // Save snapshot
    try {
      db.prepare(
        `INSERT INTO pipeline_snapshots (pipeline_run_id, stage, output_data, elapsed_ms)
         VALUES (?, ?, ?, ?)`
      ).run(state.pipelineRunId, name, JSON.stringify(result), elapsed);
    } catch (e) {
      log.warn({ node: name, error: (e as Error).message }, 'Failed to save snapshot');
    }

    log.info({ node: name, elapsed: `${elapsed}ms` }, 'Node completed');
    return result;
  };
}

/**
 * Shared helper to update episode record from final pipeline state.
 */
function updateEpisodeFromState(
  db: ReturnType<typeof getDb>,
  state: PipelineState,
  episodeId: number
) {
  // Calculate actual cost from DB tables instead of state.totalCostUsd (which is never updated)
  const llmCost = (db.prepare(
    'SELECT COALESCE(SUM(cost_usd), 0) as total FROM llm_calls WHERE episode_id = ?'
  ).get(episodeId) as { total: number }).total;
  const serviceCost = (db.prepare(
    'SELECT COALESCE(SUM(cost_usd), 0) as total FROM service_costs WHERE episode_id = ?'
  ).get(episodeId) as { total: number }).total;
  const totalCostUsd = llmCost + serviceCost;

  db.prepare(
    `UPDATE episodes SET
      status = 'pending_review',
      script_en = ?,
      script_zh = ?,
      candidate_titles = ?,
      selected_title = ?,
      description = ?,
      youtube_description = ?,
      tags = ?,
      audio_path = ?,
      cover_path = ?,
      cover_url = ?,
      source_videos = ?,
      source_links = ?,
      quality_score = ?,
      total_cost_usd = ?,
      script_word_count = ?,
      ig_post_id = ?
    WHERE id = ?`
  ).run(
    state.scriptEn,
    state.scriptZh,
    JSON.stringify(state.candidateTitles),
    state.selectedTitle,
    state.description,
    state.youtubeDescription || null,
    JSON.stringify(state.tags),
    state.audioPath,
    state.coverPath || null,
    state.coverUrl || null,
    JSON.stringify(state.selectedVideos),
    JSON.stringify(state.sourceLinks),
    state.qualityScore?.overall ?? null,
    totalCostUsd,
    state.scriptWordCount,
    state.igPostId || null,
    episodeId
  );
}
