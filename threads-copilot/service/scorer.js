'use strict';
/*
 * Pure scoring brain — no DOM, no network. Given already-extracted posts + a
 * preference profile, decides which are worth replying to.
 *
 * Ported from dashboard/src/services/trends/scorer.ts (niche gate + velocity),
 * kept dependency-free so this service can run standalone on any machine (M4),
 * independent of the podcast dashboard.
 */

// Tommy's core content = AI. Short latin tokens are matched on word boundaries
// (so "ai" hits "AI應用"/" AI " but NOT "rain"/"said"); CJK/phrases are substring.
const AI_TOKENS = ['ai', 'llm', 'gpt', 'chatgpt', 'claude', 'gemini', 'openai', 'anthropic', 'nvidia', 'copilot', 'midjourney', 'mcp', 'n8n', 'agentic', 'rag'];
const AI_PHRASES = ['ai agent', 'vibe coding', 'cursor', '人工智慧', '人工智能', '生成式', '大語言模型', '語言模型', '機器學習', '自動化', 'prompt engineering', '寫 prompt'];

// Reply-zone niches Tommy wants: AI + 接案 / 職涯 / 留學 / 英美生活.
const NICHE_GROUPS = {
  接案: ['接案', '外包', '自由工作者', '自由接案', 'freelance', 'soho', '報價單', '接案人生'],
  職涯: ['職涯', '轉職', '跳槽', '求職', '找工作', '換工作', '面試', '履歷', '升遷', '加薪', '待業', '應徵', 'career'],
  留學: ['留學', '留學生', '交換學生', '獎學金', '申請學校', '研究所', '碩士', '博士', 'study abroad', '出國唸書', '出國讀書'],
};
// Country alone is too noisy (news); require a living/working/studying context.
const ABROAD_COUNTRY = ['英國', '美國', '倫敦', '曼徹斯特', '矽谷', 'silicon valley', '紐約', '加州'];
const ABROAD_LIFE = ['生活', '工作', '讀書', '唸書', '留學', '搬', '租屋', '租房', '簽證', '物價', '文化', '定居', '移民', '打工度假'];

/** Match one keyword against text: word-boundary for pure-ASCII, substring for CJK. */
function hasKeyword(text, kw) {
  if (!kw) return false;
  const k = String(kw).toLowerCase();
  if (/^[\x00-\x7f]+$/.test(k)) {
    if (k.includes(' ')) return text.toLowerCase().includes(k);
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^a-z0-9])' + esc + '([^a-z0-9]|$)', 'i').test(text);
  }
  return text.includes(kw);
}
function anyKeyword(text, list) { return (list || []).some((k) => hasKeyword(text, k)); }

function isAIRelevant(text) {
  return anyKeyword(text, AI_TOKENS) || anyKeyword(text, AI_PHRASES);
}

/** Short label of WHY a post matches the interest profile, or null if it doesn't. */
function nicheReason(text, extraKeywords) {
  if (isAIRelevant(text)) return 'AI';
  for (const label of Object.keys(NICHE_GROUPS)) {
    if (anyKeyword(text, NICHE_GROUPS[label])) return label;
  }
  if (anyKeyword(text, ABROAD_COUNTRY) && anyKeyword(text, ABROAD_LIFE)) return '海外生活';
  if (extraKeywords && extraKeywords.length && anyKeyword(text, extraKeywords)) return '自訂';
  return null;
}

/** Engagement per hour since the post was made. Missing timestamp → treat as 1h old. */
function engagementVelocity(post, now) {
  const eng = (post.likeCount || 0) + (post.replyCount || 0);
  let hours = 1;
  if (post.timestamp) {
    const ageMs = now - new Date(post.timestamp).getTime();
    if (Number.isFinite(ageMs)) hours = Math.max(ageMs / 3600000, 0.5);
  }
  return eng / hours;
}

/** Normalize raw velocity to 0-100. ~500 eng/hr ≈ 100 (log scale). */
function velocityToHeat(v) {
  if (v <= 0) return 0;
  return Math.round(Math.min(100, Math.max(0, (Math.log10(v + 1) / Math.log10(501)) * 100)));
}

const DEFAULTS = { minEngagement: 100, extraKeywords: [], mutedAuthors: [], likedAuthors: [] };

/**
 * Score one post → { verdict: 'reply'|'skip', reason, heat, eng }.
 * Only posts worth replying to are surfaced; everything else is 'skip' and shown nowhere.
 *  - skip : muted author, off-topic, OR interaction count below minEngagement (hard gate)
 *  - reply: on-topic AND interactions >= minEngagement  (OR from an author you 👍'd)
 * `heat` (engagement velocity, 0-100) is used only to RANK the surfaced posts.
 */
function scorePost(post, pref, now) {
  const p = Object.assign({}, DEFAULTS, pref || {});
  const text = post.text || '';
  const author = post.author || '';
  if (author && p.mutedAuthors.includes(author)) return { verdict: 'skip', reason: 'muted' };
  const reason = nicheReason(text, p.extraKeywords);
  if (!reason) return { verdict: 'skip', reason: null };
  const eng = (post.likeCount || 0) + (post.replyCount || 0);
  const liked = !!author && p.likedAuthors.includes(author);
  // Hard interaction gate — cut the noise. Below the floor shows nowhere, unless it's
  // an author you explicitly 👍'd.
  if (eng < p.minEngagement && !liked) return { verdict: 'skip', reason: 'below_floor', eng };
  const heat = velocityToHeat(engagementVelocity(post, now));
  return { verdict: 'reply', reason, heat, eng };
}

function scorePosts(posts, pref, now) {
  return (posts || []).map((post) =>
    Object.assign({ permalink: post.permalink, author: post.author }, scorePost(post, pref, now)),
  );
}

module.exports = {
  scorePost, scorePosts, nicheReason, isAIRelevant,
  engagementVelocity, velocityToHeat, hasKeyword, DEFAULTS,
};
