/**
 * Pipeline state — flows through every LangGraph node.
 * Each node reads what it needs, writes what it produces.
 */

import type { ResolvedTool } from '@/services/memory/toolExtractor';
import type { MemoryContext } from '@/services/memory/memoryService';

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
    chat_feel: number;
    eng_mix: number;
    tw_localization: number;
    clarity: number;
    word_count: number;
    structure_flow?: number; // sysdesign only
    audio_safety?: number; // sysdesign only
  };
  comments: {
    chat_feel: string;
    eng_mix: string;
    tw_localization: string;
    clarity: string;
    word_count: string;
    structure_flow?: string; // sysdesign only
    audio_safety?: string; // sysdesign only
    summary: string;
  };
}

export interface QualityIteration {
  iteration: number;
  score: QualityScore;
  scriptZh: string;
}

export interface SourceLink {
  title: string;
  url: string;
  viewCount?: number;
  channelName?: string;
  publishedAt?: string;
}

export type SegmentType = 'daily' | 'weekly' | 'robot' | 'sysdesign' | 'quickchat';

export type PipelineStatus =
  | 'fetching'
  | 'classifying'
  | 'scripting'
  | 'translating'
  | 'inserting_content'
  | 'scoring'
  | 'generating_meta'
  | 'generating_cover'
  | 'tts'
  | 'generating_subtitles'
  | 'uploading_assets'
  | 'notifying'
  | 'pending_review'
  | 'publishing'
  | 'completed'
  | 'failed';

export interface PipelineState {
  // ── Config ──
  episodeId: number;              // DB episodes.id — internal identifier
  episodeNumber: number | null;   // Assigned at publish time via RSS
  segmentType: SegmentType;
  pipelineRunId: number;

  // ── Manual input (any segment can use manualVideoUrls; episodeLength is quickchat-only) ──
  manualVideoUrls: string[];
  customInstructions: string;
  episodeLength: 12 | 15 | 18 | 21 | 25 | null;
  sourceLinks: SourceLink[];

  // ── Stage 1: Fetch YouTube ──
  videos: VideoSource[];

  // ── Stage 2: Classify ──
  classifiedVideos: VideoSource[];
  selectedVideos: VideoSource[];
  excludedVideoIds: string[];

  // ── Stage 3: English Script ──
  scriptEn: string;
  scriptWordCount: number;

  // ── Stage 3.5: Tool Extraction ──
  extractedTools: ResolvedTool[];

  // ── Stage 4: Translate ──
  scriptZh: string;

  // ── Stage 4.5b: Custom Content Insertion ──
  customContentInserted: boolean;

  // ── Stage 4.5: Memory Context ──
  memoryContext: MemoryContext | null;

  // ── Stage 5: Quality ──
  qualityScore: QualityScore | null;
  qualityIterations: number;
  qualityHistory: QualityIteration[];

  // ── Stage 5.5: Script Summary (for meta generation) ──
  scriptSummary: string;

  // ── Stage 6: Generate Meta (titles, description, tags) ──
  candidateTitles: string[];
  selectedTitle: string;
  description: string;
  youtubeDescription: string;
  tags: string[];

  // ── Stage 7: Cover Image ──
  coverPath: string;
  coverUrl: string;
  igHoliday: string; // detected holiday key applied to the cover (empty = none)

  // ── Stage 8: TTS ──
  audioPath: string;
  audioDurationSec: number;

  // ── Stage 8.5: Subtitles ──
  srtPath: string;
  srtContent: string;

  // ── Stage 9: Upload Assets ──
  driveAudioUrl: string;
  driveImageUrl: string;

  // ── Stage 10: Notify ──
  igScenario: string;
  igCaption: string;
  emailHtml: string;
  igPostId: string;

  // ── Stage 11: Review (pipeline pauses here) ──
  status: PipelineStatus;
  approvedAt: string;

  // ── Stage 12: Publish ──
  soundonUrl: string;
  youtubeUrl: string;

  // ── Cost tracking ──
  totalCostUsd: number;

  // ── Error ──
  error: string;
  coverError: string;
  publishErrors: Array<{ platform: string; error: string }>;
}

/**
 * Default initial state for a new pipeline run.
 */
export function createInitialState(
  episodeId: number,
  segmentType: SegmentType,
  pipelineRunId: number
): PipelineState {
  return {
    episodeId,
    episodeNumber: null,
    segmentType,
    pipelineRunId,
    manualVideoUrls: [],
    customInstructions: '',
    episodeLength: null,
    sourceLinks: [],
    videos: [],
    classifiedVideos: [],
    selectedVideos: [],
    excludedVideoIds: [],
    scriptEn: '',
    scriptWordCount: 0,
    extractedTools: [],
    scriptZh: '',
    customContentInserted: false,
    memoryContext: null,
    qualityScore: null,
    qualityIterations: 0,
    qualityHistory: [],
    scriptSummary: '',
    candidateTitles: [],
    selectedTitle: '',
    description: '',
    youtubeDescription: '',
    tags: [],
    coverPath: '',
    coverUrl: '',
    igHoliday: '',
    audioPath: '',
    audioDurationSec: 0,
    srtPath: '',
    srtContent: '',
    driveAudioUrl: '',
    driveImageUrl: '',
    igScenario: '',
    igCaption: '',
    emailHtml: '',
    igPostId: '',
    status: 'fetching',
    approvedAt: '',
    soundonUrl: '',
    youtubeUrl: '',
    totalCostUsd: 0,
    error: '',
    coverError: '',
    publishErrors: [],
  };
}
