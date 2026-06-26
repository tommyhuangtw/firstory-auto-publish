/** Source kind for an ingested item. */
export type SourceType = 'youtube' | 'apple_podcast' | 'manual';

/** A single insight as produced by the extractor (pre-DB). */
export interface InsightCandidate {
  hook: string;        // 記憶點一句話
  idea: string;        // 2-3 句把 mindset 講清楚
  why_share: string;   // 為什麼新穎 / 值得分享
  category: string;    // 'mindset' | 'tactic' | 'contrarian' | 'story'
}

/** Input to an ingest request. Exactly one of url/text is required. */
export interface IngestInput {
  url?: string;
  text?: string;            // manual paste
  title?: string;           // manual title (optional)
  userPoints?: string;      // 入口 A: Tommy's own highlighted points
  channelId?: number;       // set when ingested via a channel crawl
  externalId?: string;      // YouTube video id (or Apple episode id) — dedup key
  publishedAt?: string | null; // source publish date (ISO) — known upfront for channel crawls
}

/** Resolved source: transcript + metadata, before insight extraction. */
export interface ResolvedSource {
  sourceType: SourceType;
  title: string | null;
  channelName: string | null;
  thumbnailUrl: string | null;
  transcript: string;
  costUsd: number;          // transcription cost (Whisper); 0 for youtube/manual
  publishedAt: string | null; // original publish date of the video/episode (ISO), null if unknown
}
