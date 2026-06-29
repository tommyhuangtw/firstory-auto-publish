import { getGmailService } from '@/services/gmail';
import { createChildLogger } from '@/lib/logger';
import type { ScoredResource } from './types';

const log = createChildLogger('resource-digest');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function sendResourceDigest(
  items: ScoredResource[],
  costUsd = 0,
): Promise<void> {
  // 專屬收件人，不沿用全域 RECIPIENT_EMAIL（那是 ops 通知信箱）。
  const to = process.env.RESOURCE_DIGEST_EMAIL || process.env.RECIPIENT_EMAIL;
  if (!to) {
    log.warn('no RESOURCE_DIGEST_EMAIL / RECIPIENT_EMAIL, skip digest');
    return;
  }
  const date = new Date().toISOString().split('T')[0];
  const costLine = costUsd > 0
    ? `<p style="color:#888;margin:2px 0">💸 本次成本 ~$${costUsd.toFixed(3)}（月估 ~$${(costUsd * 30).toFixed(2)}）</p>`
    : '';
  const cards = items
    .map((r, i) => {
      const why =
        r.freshnessReason === 'star_spike'
          ? `⭐ 星速度 ${r.starVelocity?.toFixed(0)}/day`
          : r.freshnessReason === 'youth'
            ? '🆕 剛上線新工具'
            : '🔥 社群熱議';
      const postDate = r.publishedAt ? new Date(r.publishedAt).toISOString().split('T')[0] : '';
      return `<div style="border:1px solid #e0e0e0;border-radius:12px;padding:18px;margin:16px 0;background:#fafafa">
      <h3 style="margin:0 0 6px">#${i + 1} ${esc(r.title)}</h3>
      <p style="margin:4px 0;color:#555">📊 ${r.aiScore}/100 ｜ ${esc(r.author || r.contentType)} ｜ ${why}${postDate ? ` ｜ 📅 ${postDate}` : ''}</p>
      <p style="margin:8px 0;font-size:15px;line-height:1.6">📌 ${esc(r.aiSummary || r.aiHighlights.join('、'))}</p>
      <p>🔗 <a href="${esc(r.url)}">${esc(r.url)}</a></p>
    </div>`;
    })
    .join('');
  const gmail = getGmailService();
  await gmail.initialize();
  await gmail.sendRawHtml({
    to,
    subject: `📚 學習資源每日精選 — ${items.length} 篇待 review (${date})`,
    html: `<h2>📚 學習資源每日精選</h2><p style="color:#888">${date}｜有興趣的到 /resources 頁按「✍️ 改寫成我的貼文」一鍵生成草稿</p>${costLine}${cards}`,
  });
  log.info({ count: items.length }, 'resource digest sent');
}
