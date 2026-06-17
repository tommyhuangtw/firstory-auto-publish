/**
 * Telegram digest for trend drafts — pushes one card per pending draft with the
 * full 草稿 (copy-pasteable on mobile), heat/可蹭度/risk, a format suggestion, and
 * inline buttons (❌不用 / 🎬建議改格式) + a link to the /trends Dashboard page.
 *
 * No "publish" button by design — Tommy posts manually after review.
 *
 * HMAC tokens use the SAME secret scheme as /api/tasks/quick-action so the trends
 * quick-action route can verify them.
 */

import path from 'path';
import { readFileSync, existsSync } from 'fs';
import { createHmac } from 'crypto';
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('trend-digest');

// ── Telegram credentials (process.env, else ~/.hermes/.env) ──
function loadCreds(): { botToken: string; chatId: string } {
  let botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  let chatId = process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_HOME_CHANNEL || '';
  if (!botToken || !chatId) {
    const envPath = path.join(process.env.HOME || '~', '.hermes', '.env');
    if (existsSync(envPath)) {
      for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const eq = trimmed.indexOf('=');
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim();
        if (key === 'TELEGRAM_BOT_TOKEN' && !botToken) botToken = val;
        if ((key === 'TELEGRAM_CHAT_ID' || key === 'TELEGRAM_HOME_CHANNEL') && !chatId) chatId = val;
      }
    }
  }
  return { botToken, chatId };
}

/** Matches getSecret() in /api/tasks/quick-action/route.ts */
function getSecret(): string {
  const { botToken } = loadCreds();
  return botToken || 'fallback-secret';
}

export function trendQuickActionToken(draftId: number, action: string): string {
  return createHmac('sha256', getSecret()).update(`${draftId}:${action}`).digest('hex').slice(0, 16);
}

function buildQuickActionUrl(draftId: number, action: 'reject' | 'format'): string | null {
  const publicUrl = process.env.DASHBOARD_PUBLIC_URL;
  if (!publicUrl) return null;
  const token = trendQuickActionToken(draftId, action);
  return `${publicUrl.replace(/\/$/, '')}/api/trends/quick-action?id=${draftId}&action=${action}&token=${token}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendTelegramMessage(
  message: string,
  buttons?: Array<Array<{ text: string; url: string }>>,
): Promise<boolean> {
  const { botToken, chatId } = loadCreds();
  if (!botToken || !chatId) {
    log.warn('Telegram credentials not found — skipping send');
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
      }),
    });
    if (!res.ok) {
      log.warn({ status: res.status, body: (await res.text()).slice(0, 200) }, 'Telegram API error');
      return false;
    }
    return true;
  } catch (e) {
    log.warn({ err: String(e) }, 'Failed to send Telegram');
    return false;
  }
}

/** Plain alert (used for scrape failures — fail loud, never silent). */
export async function sendTrendAlert(message: string): Promise<void> {
  await sendTelegramMessage(`⚠️ <b>社群熱點機器人</b>\n${escapeHtml(message)}`);
}

/** After a scheduled scan: ping a short summary of the top fresh hot posts (reply targets). */
export async function sendHotPostsNote(): Promise<{ sent: boolean }> {
  const db = getDb();
  const topN = parseInt(
    (db.prepare('SELECT value FROM settings WHERE key = ?').get('trend_top_n') as { value: string } | undefined)?.value || '6',
    10,
  );
  const rows = db.prepare(`
    SELECT author, like_count, reply_count, relevant, text, permalink
    FROM trend_posts
    WHERE scraped_at > datetime('now', '-1 day')
    ORDER BY relevant DESC, velocity DESC
    LIMIT ?
  `).all(topN) as Array<{ author: string | null; like_count: number; reply_count: number; relevant: number; text: string; permalink: string | null }>;

  if (rows.length === 0) return { sent: false };

  const url = process.env.DASHBOARD_PUBLIC_URL?.replace(/\/$/, '');
  const aiCount = rows.filter((r) => r.relevant).length;
  const lines = [`🔥 <b>社群熱點掃描完成</b>　${rows.length} 篇近期熱點${aiCount ? `（含 ${aiCount} 篇 AI）` : ''}`, ''];
  for (const r of rows) {
    lines.push(`${r.relevant ? '🟢' : '•'} 讚${r.like_count}/回${r.reply_count} @${r.author || '?'}\n${escapeHtml(r.text.slice(0, 45))}${r.permalink ? `\n${r.permalink}` : ''}`);
  }
  if (url) lines.push('', `→ 去看全部 / 生成草稿：${url}/trends`);
  const ok = await sendTelegramMessage(lines.join('\n'));
  return { sent: ok };
}

const RISK_EMOJI: Record<string, string> = { low: '🟢', medium: '🟡', high: '🔴' };
const FORMAT_LABEL: Record<string, string> = {
  text: '📝 純文字貼文',
  video: '🎬 短影片',
  webapp: '🌐 互動網頁',
  interactive: '🗳️ 互動貼文',
};

interface DigestRow {
  draft_id: number;
  draft_text: string;
  format_suggestion: string;
  char_count: number | null;
  topic: string;
  heat_score: number;
  rideability: number | null;
  risk_level: string | null;
  risk_reason: string | null;
}

/** Send a digest of pending drafts. Returns the number of cards sent. */
export async function sendTrendDigest(): Promise<{ sent: number }> {
  const db = getDb();
  const topN = parseInt(
    (db.prepare('SELECT value FROM settings WHERE key = ?').get('trend_top_n') as { value: string } | undefined)?.value || '5',
    10,
  );

  const rows = db.prepare(`
    SELECT d.id AS draft_id, d.draft_text, d.format_suggestion, d.char_count,
           t.topic, t.heat_score, t.rideability, t.risk_level, t.risk_reason
    FROM trend_drafts d
    JOIN trend_topics t ON t.id = d.topic_id
    WHERE d.status = 'pending_review'
    ORDER BY t.heat_score DESC
    LIMIT ?
  `).all(topN) as DigestRow[];

  if (rows.length === 0) {
    log.info('No pending drafts to send');
    return { sent: 0 };
  }

  const publicUrl = process.env.DASHBOARD_PUBLIC_URL?.replace(/\/$/, '');
  let sent = 0;

  for (const r of rows) {
    const risk = RISK_EMOJI[r.risk_level || 'medium'] || '🟡';
    const fmt = FORMAT_LABEL[r.format_suggestion] || r.format_suggestion;
    const lines = [
      `🔥 <b>${escapeHtml(r.topic)}</b>`,
      `熱度 ${Math.round(r.heat_score)} ｜ 可蹭度 ${r.rideability ?? '—'} ｜ ${risk} 風險${r.risk_reason ? `：${escapeHtml(r.risk_reason)}` : ''}`,
      `建議格式：${fmt}`,
      '',
      `📝 草稿（${r.char_count ?? r.draft_text.length} 字，可直接複製）：`,
      escapeHtml(r.draft_text),
    ];
    if (publicUrl) lines.push('', `🔗 在 Dashboard 編輯/複製：${publicUrl}/trends`);

    const btnRow: Array<{ text: string; url: string }> = [];
    const rejectUrl = buildQuickActionUrl(r.draft_id, 'reject');
    if (rejectUrl) btnRow.push({ text: '❌ 不用', url: rejectUrl });
    const buttons: Array<Array<{ text: string; url: string }>> = btnRow.length ? [btnRow] : [];
    if (r.format_suggestion !== 'text') {
      const formatUrl = buildQuickActionUrl(r.draft_id, 'format');
      if (formatUrl) buttons.push([{ text: '🎬 這題建議改格式', url: formatUrl }]);
    }

    const ok = await sendTelegramMessage(lines.join('\n'), buttons.length ? buttons : undefined);
    if (ok) sent++;
  }

  log.info({ sent }, 'Trend digest sent');
  return { sent };
}
