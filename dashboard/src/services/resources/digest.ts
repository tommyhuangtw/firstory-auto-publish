import { getGmailService } from '@/services/gmail';
import { createChildLogger } from '@/lib/logger';
import type { ScoredResource } from './types';

const log = createChildLogger('resource-digest');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function sendResourceDigest(
  items: Array<{ r: ScoredResource; text: string; viral: number }>,
): Promise<void> {
  const to = process.env.RECIPIENT_EMAIL;
  if (!to) {
    log.warn('no RECIPIENT_EMAIL, skip digest');
    return;
  }
  const date = new Date().toISOString().split('T')[0];
  const cards = items
    .map(({ r, text, viral }, i) => {
      const why =
        r.freshnessReason === 'star_spike'
          ? `⭐ 星速度 ${r.starVelocity?.toFixed(0)}/day`
          : r.freshnessReason === 'youth'
            ? '🆕 剛上線新工具'
            : '🔥 社群熱議';
      return `<div style="border:1px solid #e0e0e0;border-radius:12px;padding:18px;margin:16px 0;background:#fafafa">
      <h3 style="margin:0 0 6px">#${i + 1} ${esc(r.title)}</h3>
      <p style="margin:4px 0;color:#555">📊 ${r.aiScore}/100 ｜ ${r.contentType} ｜ ${why} ｜ 爆文分 ${(viral * 100).toFixed(0)}</p>
      <p style="margin:4px 0">✨ ${esc(r.aiHighlights.join('、'))}</p>
      <div style="background:#fff;padding:14px;border-radius:8px;border-left:4px solid #6366f1;white-space:pre-wrap">${esc(text)}</div>
      <p>🔗 <a href="${esc(r.url)}">${esc(r.url)}</a></p>
    </div>`;
    })
    .join('');
  const gmail = getGmailService();
  await gmail.initialize();
  await gmail.sendRawHtml({
    to,
    subject: `📚 學習資源每日精選 — ${items.length} 篇待 review (${date})`,
    html: `<h2>📚 學習資源每日精選</h2><p style="color:#888">${date}｜在 /resources 頁可編輯/發布</p>${cards}`,
  });
  log.info({ count: items.length }, 'resource digest sent');
}
