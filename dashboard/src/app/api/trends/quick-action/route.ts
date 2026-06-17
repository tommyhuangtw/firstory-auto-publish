import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { createHmac } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

// ── HMAC secret — same scheme as /api/tasks/quick-action ──
function getSecret(): string {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  const envPath = path.join(process.env.HOME || '~', '.hermes', '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('TELEGRAM_BOT_TOKEN=')) {
        return trimmed.slice('TELEGRAM_BOT_TOKEN='.length).trim();
      }
    }
  }
  return 'fallback-secret';
}

function verifyToken(draftId: number, action: string, token: string): boolean {
  const expected = createHmac('sha256', getSecret()).update(`${draftId}:${action}`).digest('hex').slice(0, 16);
  return expected === token;
}

function htmlPage(title: string, message: string, success: boolean): string {
  const color = success ? '#22c55e' : '#ef4444';
  const icon = success ? '&#10003;' : '&#10007;';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center;
    min-height: 100vh; margin: 0; background: #09090b; color: #fafafa; }
  .card { text-align: center; padding: 2rem; max-width: 400px; }
  .icon { font-size: 3rem; color: ${color}; margin-bottom: 1rem; }
  h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
  p { color: #a1a1aa; font-size: 0.875rem; margin: 0; }
</style></head>
<body><div class="card">
  <div class="icon">${icon}</div>
  <h1>${title}</h1>
  <p>${message}</p>
</div></body></html>`;
}

function page(title: string, message: string, success: boolean, status = 200) {
  return new NextResponse(htmlPage(title, message, success), {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

interface DraftRow {
  id: number;
  status: string;
  draft_text: string;
  format_suggestion: string;
  format_reason: string | null;
  topic: string;
}

/** Telegram quick-action for trend drafts: reject or request a format change. No auto-post. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const id = parseInt(searchParams.get('id') || '', 10);
  const action = searchParams.get('action') || '';
  const token = searchParams.get('token') || '';

  if (!id || !['reject', 'format'].includes(action) || !token) {
    return page('Invalid Request', 'Missing or invalid parameters.', false, 400);
  }
  if (!verifyToken(id, action, token)) {
    return page('Unauthorized', 'Invalid token. This link may have expired.', false, 403);
  }

  const db = getDb();
  const draft = db.prepare(`
    SELECT d.id, d.status, d.draft_text, d.format_suggestion, d.format_reason, t.topic
    FROM trend_drafts d JOIN trend_topics t ON t.id = d.topic_id
    WHERE d.id = ?
  `).get(id) as DraftRow | undefined;

  if (!draft) {
    return page('Not Found', `Draft #${id} not found.`, false, 404);
  }
  if (draft.status !== 'pending_review') {
    return page('Already Handled', `Draft #${id} is currently "${draft.status}".`, false);
  }

  if (action === 'reject') {
    db.prepare(`UPDATE trend_drafts SET status = 'rejected', reviewed_at = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(new Date().toISOString(), id);
    return page('已忽略', `「${draft.topic}」這則草稿不用了。`, true);
  }

  // action === 'format' — file a content task to evaluate a richer format; never auto-builds.
  const fmtLabel: Record<string, string> = { video: '短影片', webapp: '互動網頁', interactive: '互動貼文' };
  const fmt = fmtLabel[draft.format_suggestion] || draft.format_suggestion;
  const taskResult = db.prepare(`
    INSERT INTO tasks (title, description, status, priority, category, auto_execute, created_by)
    VALUES (?, ?, 'todo', 'medium', 'content', 0, 'trend-bot')
  `).run(
    `評估「${draft.topic}」改用${fmt}形式`,
    `社群熱點機器人建議這題改用「${fmt}」形式來蹭。\n\n建議原因：${draft.format_reason || '（無）'}\n\n原文字草稿：\n${draft.draft_text}`,
  );
  const taskId = Number(taskResult.lastInsertRowid);
  db.prepare(`UPDATE trend_drafts SET status = 'format_requested', task_id = ?, reviewed_at = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(taskId, new Date().toISOString(), id);

  return page('已建立任務', `已建立 task #${taskId}：評估「${draft.topic}」改用${fmt}形式。`, true);
}
