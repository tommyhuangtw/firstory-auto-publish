/**
 * Pipeline state — flows through every LangGraph node.
 * Each node reads what it needs, writes what it produces.
 */

import type { ExtractedTool } from '@/services/memory/toolExtractor';

export interface VideoSource {
  videoId: string;
  title: string;
  channelName: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  durationSeconds: number;
  transcript: string;
  classification?: 'is_tool' | 'not_tool' | 'is_robotics' | 'non_robotics';
}

export interface QualityScore {
  overall: number;
  dimensions: {
    accuracy: number;
    engagement: number;
    structure: number;
    naturalness: number;
  };
  feedback: string;
}

export type SegmentType = 'daily' | 'weekly' | 'robot';

export type PipelineStatus =
  | 'fetching'
  | 'classifying'
  | 'scripting'
  | 'translating'
  | 'scoring'
  | 'generating_meta'
  | 'tts'
  | 'pending_review'
  | 'publishing'
  | 'completed'
  | 'failed';

export interface PipelineState {
  // ── Config ──
  episodeNumber: number;
  segmentType: SegmentType;
  pipelineRunId: number;

  // ── Stage 1: Fetch YouTube ──
  videos: VideoSource[];

  // ── Stage 2: Classify ──
  classifiedVideos: VideoSource[];
  selectedVideos: VideoSource[];

  // ── Stage 3: English Script ──
  scriptEn: string;
  scriptWordCount: number;

  // ── Stage 3.5: Tool Extraction ──
  extractedTools: ExtractedTool[];

  // ── Stage 4: Translate ──
  scriptZh: string;

  // ── Stage 4.5: Memory Enrichment ──
  memoryEnrichments: string[];

  // ── Stage 5: Quality ──
  qualityScore: QualityScore | null;
  qualityIterations: number;

  // ── Stage 6: Generate Meta (titles, description, tags) ──
  candidateTitles: string[];
  selectedTitle: string;
  description: string;
  tags: string[];

  // ── Stage 7: TTS ──
  audioPath: string;
  audioDurationSec: number;

  // ── Stage 8: Review (pipeline pauses here) ──
  status: PipelineStatus;
  approvedAt: string;

  // ── Stage 9: Publish ──
  soundonUrl: string;
  youtubeUrl: string;
  igPostId: string;

  // ── Cost tracking ──
  totalCostUsd: number;

  // ── Error ──
  error: string;
}

/**
 * Default initial state for a new pipeline run.
 */
export function createInitialState(
  episodeNumber: number,
  segmentType: SegmentType,
  pipelineRunId: number
): PipelineState {
  return {
    episodeNumber,
    segmentType,
    pipelineRunId,
    videos: [],
    classifiedVideos: [],
    selectedVideos: [],
    scriptEn: '',
    scriptWordCount: 0,
    extractedTools: [],
    scriptZh: '',
    memoryEnrichments: [],
    qualityScore: null,
    qualityIterations: 0,
    candidateTitles: [],
    selectedTitle: '',
    description: '',
    tags: [],
    audioPath: '',
    audioDurationSec: 0,
    status: 'fetching',
    approvedAt: '',
    soundonUrl: '',
    youtubeUrl: '',
    igPostId: '',
    totalCostUsd: 0,
    error: '',
  };
}
