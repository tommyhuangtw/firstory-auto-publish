/**
 * Velocity scoring — turns raw scraped posts into a heat-ranked cluster.
 * Favours fast-rising posts (engagement per hour) over old high-follower posts,
 * which is exactly "what's actually hot right now".
 */

import type { RawThreadPost, ScoredCluster } from './types';

/** Engagement per hour since the post was made. Missing timestamp → treat as 1h old. */
export function engagementVelocity(p: RawThreadPost, now = Date.now()): number {
  const engagement = (p.likeCount || 0) + (p.replyCount || 0);
  let hours = 1;
  if (p.timestamp) {
    const ageMs = now - new Date(p.timestamp).getTime();
    hours = Math.max(ageMs / 3_600_000, 0.5); // floor at 30min to avoid div-by-tiny spikes
  }
  return engagement / hours;
}

/** Normalize a raw velocity to 0-100. ~500 eng/hr maps to ~100 (log scale). */
export function velocityToHeat(topVelocity: number): number {
  if (topVelocity <= 0) return 0;
  const score = (Math.log10(topVelocity + 1) / Math.log10(501)) * 100;
  return Math.round(Math.min(100, Math.max(0, score)));
}

// Posts matching these are ranked to the front (Tommy's core content = AI).
// Tokens use non-letter boundaries so "ai" matches "AI應用"/" AI " but NOT "rain"/"said",
// and we avoid broad words like bare "agent" (F1 free agent) or "科技" (科技股 news).
const AI_TOKEN = /(^|[^a-zA-Z])(ai|llm|gpt|chatgpt|claude|gemini|openai|anthropic|nvidia|copilot|midjourney|mcp|n8n|agentic|rag)([^a-zA-Z]|$)/i;
const AI_PHRASE = /(ai ?agent|vibe ?coding|cursor|人工智慧|人工智能|生成式 ?ai|生成式|大語言模型|語言模型|機器學習|自動化|prompt engineering|寫 ?prompt)/i;

/** True if a post is genuinely AI-related (used to boost it up the ranking). */
export function isAIRelevant(text: string, source?: string): boolean {
  const hay = `${text} ${source || ''}`;
  return AI_TOKEN.test(hay) || AI_PHRASE.test(hay);
}

export function clusterAndScore(topic: string, posts: RawThreadPost[], now = Date.now()): ScoredCluster {
  const withVel = posts
    .map((p) => ({ ...p, velocity: engagementVelocity(p, now) }))
    .sort((a, b) => b.velocity - a.velocity);

  const topVelocity = withVel.length > 0 ? withVel[0].velocity : 0;

  return {
    topic,
    posts: withVel,
    heatScore: velocityToHeat(topVelocity),
    topVelocity,
    postCount: withVel.length,
  };
}
