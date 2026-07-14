'use strict';
const assert = require('assert');
const { scorePost, nicheReason, isAIRelevant, velocityToHeat } = require('../scorer');

const NOW = Date.parse('2026-07-14T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();
let n = 0;
const t = (name, fn) => { fn(); n++; };

// --- niche gate ---
t('AI token matches', () => assert.strictEqual(nicheReason('剛用 ChatGPT 寫完腳本'), 'AI'));
t('AI boundary: "said" is NOT ai', () => assert.strictEqual(isAIRelevant('she said hello to the rain'), false));
t('freelance niche', () => assert.strictEqual(nicheReason('分享我的接案報價單心得'), '接案'));
t('career niche', () => assert.strictEqual(nicheReason('準備轉職面試好緊張'), '職涯'));
t('abroad needs country+life', () => {
  assert.strictEqual(nicheReason('英國股市今天大跌'), null);       // country only → no
  assert.strictEqual(nicheReason('在英國租屋簽證好麻煩'), '海外生活'); // country+life → yes
});
t('off-topic → null', () => assert.strictEqual(nicheReason('今天午餐吃拉麵好好吃'), null));
t('extraKeywords personalize', () => {
  assert.strictEqual(nicheReason('聊聊獨立開發的甘苦', []), null);
  assert.strictEqual(nicheReason('聊聊獨立開發的甘苦', ['獨立開發']), '自訂');
});

// --- verdict (hard interaction gate, default floor 100) ---
t('on-topic + interactions >= floor → reply', () => {
  const r = scorePost({ text: '用 Claude 寫程式的心得', likeCount: 120, replyCount: 30, timestamp: hoursAgo(3) }, {}, NOW);
  assert.strictEqual(r.verdict, 'reply');
  assert.strictEqual(r.reason, 'AI');
  assert.ok(r.heat > 0);
});
t('on-topic but below floor → skip', () => {
  const r = scorePost({ text: '用 Claude 寫程式的心得', likeCount: 40, replyCount: 5, timestamp: hoursAgo(3) }, {}, NOW);
  assert.strictEqual(r.verdict, 'skip');
  assert.strictEqual(r.reason, 'below_floor');
});
t('floor is configurable', () => {
  const post = { text: '用 Claude 寫程式的心得', likeCount: 60, replyCount: 30, timestamp: hoursAgo(3) }; // eng 90
  assert.strictEqual(scorePost(post, { minEngagement: 100 }, NOW).verdict, 'skip');
  assert.strictEqual(scorePost(post, { minEngagement: 80 }, NOW).verdict, 'reply');
});
t('off-topic → skip regardless of interactions', () => {
  const r = scorePost({ text: '午餐吃拉麵', likeCount: 999, replyCount: 999, timestamp: hoursAgo(1) }, {}, NOW);
  assert.strictEqual(r.verdict, 'skip');
});
t('muted author → skip even if on-topic & viral', () => {
  const r = scorePost({ text: 'AI agent 好神', author: 'spammer', likeCount: 500, replyCount: 90, timestamp: hoursAgo(1) }, { mutedAuthors: ['spammer'] }, NOW);
  assert.strictEqual(r.verdict, 'skip');
});
t('liked author → reply even below floor', () => {
  const r = scorePost({ text: 'AI agent 小聊', author: 'fav', likeCount: 1, replyCount: 0, timestamp: hoursAgo(1) }, { likedAuthors: ['fav'] }, NOW);
  assert.strictEqual(r.verdict, 'reply');
});

// --- heat monotonic ---
t('heat rises with velocity', () => {
  assert.ok(velocityToHeat(500) > velocityToHeat(50));
  assert.strictEqual(velocityToHeat(0), 0);
});

console.log(`scorer.test.js: ${n} tests passed`);
