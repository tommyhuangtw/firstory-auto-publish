// dashboard/src/services/resources/types.ts
export type ContentType = 'github' | 'x' | 'reddit' | 'link';

/** 爬蟲統一輸出。 */
export interface RawResource {
  guid: string;            // github_<owner/repo> | x_<id> | reddit_<id> | link_<hash>
  contentType: ContentType;
  title: string;
  description: string;
  url: string;
  author: string;
  publishedAt?: string;    // ISO
  source: string;          // 哪個 subreddit / X query / github query
  /** 社群互動（X/Reddit 原生資源用）。 */
  engagement?: { likes?: number; comments?: number; reposts?: number; stars?: number };
  /** 從這條社群貼文抽到的 repo 候選（extract 階段填）。 */
  mentionedRepos?: string[];
}

/** enrich 後（GitHub 類補了 star/age/delta）。 */
export interface EnrichedResource extends RawResource {
  stars?: number;
  createdAt?: string;      // repo created_at
  starVelocity?: number;   // stars/day（首見為 undefined）
  socialBuzz: number;      // 合成社群分
  freshnessScore: number;
  freshnessReason: string; // 'star_spike' | 'social_buzz' | 'native_post' | 'youth'
}

/** LLM 評分後。 */
export interface ScoredResource extends EnrichedResource {
  aiScore: number;         // 0-100
  aiSummary: string;       // 中文重點：這則資源在講什麼、為什麼有用（給 Tommy 快速掃）
  aiReasoning: string;
  aiHighlights: string[];
  aiAngle: string;
  worthSharing: boolean;
}

export interface ResourceScanResult {
  scraped: number;
  belowGate: number;       // freshness gate 淘汰
  deduped: number;         // guid 已 surface 過且無新動能
  scored: number;
  drafted: number;
  recorded: number;
}
