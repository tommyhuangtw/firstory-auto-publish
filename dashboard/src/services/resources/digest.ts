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
  const dashUrl = (process.env.DASHBOARD_PUBLIC_URL || '').replace(/\/$/, '');
  const costLine = costUsd > 0
    ? `<p style="color:#999;font-size:12px;margin:2px 0">💸 本次成本 ~$${costUsd.toFixed(3)}（月估 ~$${(costUsd * 30).toFixed(2)}）</p>`
    : '';
  const cards = items
    .map((r, i) => {
      const postDate = r.publishedAt ? new Date(r.publishedAt).toISOString().split('T')[0] : '';
      const eng = r.contentType === 'github'
        ? `⭐ ${r.stars ?? 0} stars${postDate ? ` ｜ 📅 發布 ${postDate}` : ''}`
        : `👍 ${r.engagement?.likes ?? 0} ｜ 💬 ${r.engagement?.comments ?? 0} ｜ 🔁 ${r.engagement?.reposts ?? 0}${postDate ? ` ｜ 📅 ${postDate}` : ''}`;
      const cta = dashUrl
        ? `<div style="margin-top:14px"><a href="${dashUrl}/resources" style="display:inline-block;padding:10px 20px;background:#6366f1;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:14px">✍️ 去改寫成我的貼文</a></div>`
        : '';
      return `<div style="border:1px solid #e0e0e0;border-radius:12px;padding:20px;margin:20px 0;background:#fafafa">
  <h3 style="color:#1a1a2e;margin:0 0 10px">#${i + 1} - ${esc(r.title)}</h3>
  <p style="margin:4px 0;color:#444">📊 <strong>AI 評分:</strong> ${r.aiScore}/100 ｜ 📂 <strong>類型:</strong> ${esc(r.contentType)} ｜ 👤 <strong>作者:</strong> ${esc(r.author || '-')}</p>
  <p style="margin:4px 0;color:#444">📈 <strong>互動:</strong> ${eng}</p>
  <p style="margin:10px 0;color:#222;font-size:15px;line-height:1.7">💡 <strong>AI 說:</strong> ${esc(r.aiSummary || '')}</p>
  ${r.aiHighlights.length ? `<p style="margin:6px 0;color:#444">✨ <strong>亮點:</strong> ${esc(r.aiHighlights.join('、'))}</p>` : ''}
  ${r.description ? `<div style="background:#fff;padding:14px;border-radius:8px;border-left:4px solid #6366f1;margin:12px 0;white-space:pre-wrap;font-size:14px;line-height:1.7;color:#333">📄 ${esc(r.description)}</div>` : ''}
  <p style="margin:6px 0">🔗 <a href="${esc(r.url)}" style="color:#6366f1">${esc(r.url)}</a></p>
  ${cta}
</div>`;
    })
    .join('');
  const gmail = getGmailService();
  await gmail.initialize();
  await gmail.sendRawHtml({
    to,
    subject: `📚 學習資源每日精選 - 共 ${items.length} 篇 (${date})`,
    html: `<h2 style="color:#1a1a2e">📚 學習資源每日精選 - 共 ${items.length} 篇</h2>`
      + `<p style="color:#888">產生時間: ${date}｜有興趣的點卡片下方「✍️ 去改寫成我的貼文」到 /resources 一鍵生成草稿</p>`
      + costLine
      + `<hr style="border:none;border-top:1px solid #eee;margin:12px 0">`
      + cards,
  });
  log.info({ count: items.length }, 'resource digest sent');
}
