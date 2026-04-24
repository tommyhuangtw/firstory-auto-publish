/**
 * LangGraph Content Pipeline — StateGraph definition.
 *
 * Replaces n8n workflow. 9 stages (linear) + publish triggered after review:
 * fetch → classify → script → extractTools → translate → enrichMemory → quality → meta → tts → END
 * (pipeline pauses at 'pending_review'; publish is triggered via /api/episodes/:id/approve)
 */

import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import {
  type PipelineState,
  type PipelineStatus,
  type SegmentType,
  type VideoSource,
  type QualityScore,
  createInitialState,
} from './state';
import type { ExtractedTool } from '@/services/memory/toolExtractor';

// Node implementations
import { fetchYoutube } from './nodes/fetchYoutube';
import { classify } from './nodes/classify';
import { scriptEnglish } from './nodes/scriptEnglish';
import { extractTools } from './nodes/extractTools';
import { translate } from './nodes/translate';
import { enrichMemory } from './nodes/enrichMemory';
import { qualityScore } from './nodes/qualityScore';
import { generateMeta } from './nodes/generateMeta';
import { tts } from './nodes/tts';
import { publish } from './nodes/publish';

const log = createChildLogger('pipeline');

/**
 * LangGraph Annotation — defines state schema with "last writer wins" reducers.
 */
const PipelineAnnotation = Annotation.Root({
  episodeNumber: Annotation<number>,
  segmentType: Annotation<SegmentType>,
  pipelineRunId: Annotation<number>,
  videos: Annotation<VideoSource[]>,
  classifiedVideos: Annotation<VideoSource[]>,
  selectedVideos: Annotation<VideoSource[]>,
  scriptEn: Annotation<string>,
  scriptWordCount: Annotation<number>,
  extractedTools: Annotation<ExtractedTool[]>,
  scriptZh: Annotation<string>,
  memoryEnrichments: Annotation<string[]>,
  qualityScore: Annotation<QualityScore | null>,
  qualityIterations: Annotation<number>,
  candidateTitles: Annotation<string[]>,
  selectedTitle: Annotation<string>,
  description: Annotation<string>,
  tags: Annotation<string[]>,
  audioPath: Annotation<string>,
  audioDurationSec: Annotation<number>,
  status: Annotation<PipelineStatus>,
  approvedAt: Annotation<string>,
  soundonUrl: Annotation<string>,
  youtubeUrl: Annotation<string>,
  igPostId: Annotation<string>,
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
    .addNode('enrichMemory', wrapNode('enrichMemory', enrichMemory))
    .addNode('scoreQuality', wrapNode('scoreQuality', qualityScore))
    .addNode('generateMeta', wrapNode('generateMeta', generateMeta))
    .addNode('synthesizeTts', wrapNode('synthesizeTts', tts))
    .addEdge(START, 'fetchYoutube')
    .addEdge('fetchYoutube', 'classify')
    .addEdge('classify', 'scriptEnglish')
    .addEdge('scriptEnglish', 'extractTools')
    .addEdge('extractTools', 'translate')
    .addEdge('translate', 'enrichMemory')
    .addEdge('enrichMemory', 'scoreQuality')
    .addEdge('scoreQuality', 'generateMeta')
    .addEdge('generateMeta', 'synthesizeTts')
    .addEdge('synthesizeTts', END);

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
  episodeNumber: number,
  segmentType: SegmentType
): Promise<{ pipelineRunId: number; state: PipelineState }> {
  const db = getDb();

  // Create pipeline_run record
  const result = db.prepare(
    `INSERT INTO pipeline_runs (episode_number, segment_type, status, current_stage)
     VALUES (?, ?, 'running', 'fetchYoutube')`
  ).run(episodeNumber, segmentType);
  const pipelineRunId = Number(result.lastInsertRowid);

  // Create episode record if not exists
  db.prepare(
    `INSERT OR IGNORE INTO episodes (episode_number, segment_type, status)
     VALUES (?, ?, 'generating')`
  ).run(episodeNumber, segmentType);

  const initialState = createInitialState(episodeNumber, segmentType, pipelineRunId);

  log.info({ episodeNumber, segmentType, pipelineRunId }, 'Pipeline started');

  try {
    const graph = getCompiledGraph();
    const finalState = await graph.invoke(initialState) as PipelineState;

    // Update pipeline_run
    db.prepare(
      `UPDATE pipeline_runs SET status = 'completed', current_stage = 'tts', completed_at = datetime('now')
       WHERE id = ?`
    ).run(pipelineRunId);

    // Update episode
    db.prepare(
      `UPDATE episodes SET
        status = 'pending_review',
        script_en = ?,
        script_zh = ?,
        candidate_titles = ?,
        selected_title = ?,
        description = ?,
        tags = ?,
        audio_path = ?,
        source_videos = ?,
        quality_score = ?,
        total_cost_usd = ?,
        script_word_count = ?
      WHERE episode_number = ?`
    ).run(
      finalState.scriptEn,
      finalState.scriptZh,
      JSON.stringify(finalState.candidateTitles),
      finalState.selectedTitle,
      finalState.description,
      JSON.stringify(finalState.tags),
      finalState.audioPath,
      JSON.stringify(finalState.selectedVideos),
      finalState.qualityScore?.overall ?? null,
      finalState.totalCostUsd,
      finalState.scriptWordCount,
      episodeNumber
    );

    log.info({ episodeNumber, pipelineRunId }, 'Pipeline completed, awaiting review');
    return { pipelineRunId, state: finalState };
  } catch (error) {
    const errMsg = (error as Error).message;
    db.prepare(
      `UPDATE pipeline_runs SET status = 'failed', error_log = ?, completed_at = datetime('now')
       WHERE id = ?`
    ).run(errMsg, pipelineRunId);

    log.error({ episodeNumber, pipelineRunId, error: errMsg }, 'Pipeline failed');
    throw error;
  }
}

/**
 * Publish an approved episode (called after human review).
 */
export async function publishEpisode(episodeNumber: number): Promise<Partial<PipelineState>> {
  const db = getDb();
  const episode = db.prepare('SELECT * FROM episodes WHERE episode_number = ?').get(episodeNumber) as Record<string, unknown> | undefined;

  if (!episode) throw new Error(`Episode ${episodeNumber} not found`);
  if (episode.status !== 'pending_review' && episode.status !== 'approved') {
    throw new Error(`Episode ${episodeNumber} is not ready for publishing (status: ${episode.status})`);
  }

  db.prepare(`UPDATE episodes SET status = 'publishing' WHERE episode_number = ?`).run(episodeNumber);

  const state: PipelineState = {
    episodeNumber,
    segmentType: episode.segment_type as SegmentType,
    pipelineRunId: 0,
    videos: [],
    classifiedVideos: [],
    selectedVideos: [],
    scriptEn: (episode.script_en as string) || '',
    scriptWordCount: (episode.script_word_count as number) || 0,
    extractedTools: [],
    scriptZh: (episode.script_zh as string) || '',
    memoryEnrichments: [],
    qualityScore: null,
    qualityIterations: 0,
    candidateTitles: JSON.parse((episode.candidate_titles as string) || '[]'),
    selectedTitle: (episode.selected_title as string) || '',
    description: (episode.description as string) || '',
    tags: JSON.parse((episode.tags as string) || '[]'),
    audioPath: (episode.audio_path as string) || '',
    audioDurationSec: 0,
    status: 'publishing',
    approvedAt: new Date().toISOString(),
    soundonUrl: '',
    youtubeUrl: '',
    igPostId: '',
    totalCostUsd: (episode.total_cost_usd as number) || 0,
    error: '',
  };

  return publish(state);
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
    log.info({ node: name, episodeNumber: state.episodeNumber }, 'Node started');

    // Update current stage in pipeline_runs
    const db = getDb();
    db.prepare('UPDATE pipeline_runs SET current_stage = ? WHERE id = ?').run(name, state.pipelineRunId);

    const result = await fn(state as PipelineState);
    const elapsed = Date.now() - start;

    log.info({ node: name, elapsed: `${elapsed}ms` }, 'Node completed');
    return result;
  };
}
