/**
 * Shared types for the social trend bot (蹭大眾熱點 → 爆紅貼文草稿).
 */

/** A single Threads post scraped from the web. */
export interface RawThreadPost {
  text: string;
  likeCount: number;
  replyCount: number;
  /** ISO timestamp if parseable from the relative time label, else undefined. */
  timestamp?: string;
  permalink?: string;
  /** @username of the post author (without the leading @). */
  author?: string;
  /** Where this post came from: '為你推薦' or a seed topic like 'AI應用'. */
  source?: string;
}

export type FormatSuggestion = 'text' | 'video' | 'webapp' | 'interactive';
export type RiskLevel = 'low' | 'medium' | 'high';

/** A trending topic with its scraped posts, after velocity scoring. */
export interface ScoredCluster {
  topic: string;
  posts: Array<RawThreadPost & { velocity: number }>;
  heatScore: number;   // 0-100, normalized engagement velocity
  topVelocity: number; // raw max velocity in the cluster
  postCount: number;
}

/** LLM assessment + generated draft for one hot post the algorithm surfaced. */
export interface TrendAssessment {
  topic: string;         // LLM-derived theme of the hot post (5-12 chars)
  rideability: number;   // 0-100 可蹭度
  riskLevel: RiskLevel;
  riskReason: string;
  draftText: string;     // 繁中 viral Threads post
  formatSuggestion: FormatSuggestion;
  formatReason: string;
}

export interface TrendScanResult {
  postsRecorded: number;   // every fresh post recorded (for the reply use-case)
  draftsCreated: number;   // 蹭點 drafts generated for top on-brand posts
  skipped: number;
}
