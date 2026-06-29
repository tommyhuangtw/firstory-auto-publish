import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { createHmac } from 'crypto';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');

function getSecret(): string {
  // Use the same bot token as agents/base.ts for HMAC
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  const envPath = path.join(process.env.HOME || '~', '.hermes', '.env');
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('TELEGRAM_BOT_TOKEN=')) {
        return trimmed.slice('TELEGRAM_BOT_TOKEN='.length).trim();
      }
    }
  }
  return 'fallback-secret';
}

function genToken(taskId: number, action: string): string {
  return createHmac('sha256', getSecret()).update(`${taskId}:${action}`).digest('hex').slice(0, 16);
}

function verifyToken(taskId: number, action: string, token: string): boolean {
  return genToken(taskId, action) === token;
}

/** Try to create a PR for the task's feature branch. Returns PR URL or error message. */
function tryCreatePR(taskId: number, title: string, branch: string): { prUrl?: string; error?: string } {
  try {
    // Check if branch exists on remote
    try {
      execSync(`git ls-remote --heads origin ${branch}`, { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 15_000 });
    } catch {
      // Push branch to remote first
      execSync(`git push origin ${branch}`, { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30_000 });
    }

    // Check if PR already exists
    const existing = execSync(
      `gh pr list --head "${branch}" --json url --jq '.[0].url'`,
      { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 15_000 }
    ).trim();
    if (existing) return { prUrl: existing };

    // Create PR
    const prUrl = execSync(
      `gh pr create --head "${branch}" --base main --title "Task #${taskId}: ${title.replace(/"/g, '\\"')}" --body "Approved via Telegram quick-action.\n\nTask #${taskId}"`,
      { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30_000 }
    ).trim();

    return { prUrl };
  } catch (e) {
    return { error: String(e).slice(0, 200) };
  }
}

type Task = { id: number; title: string; status: string };

/**
 * Apply an approve/reject decision to a todo or review task.
 * Shared by the Telegram one-tap GET buttons and the "comment first" POST form.
 * Any guidance comment is inserted by the caller BEFORE this runs, so the agent
 * (which reads ticket comments before executing) picks it up automatically.
 */
function applyDecision(
  db: ReturnType<typeof getDb>,
  task: Task,
  action: 'approve' | 'reject',
): { title: string; message: string; success: boolean; extra?: string } {
  const now = new Date().toISOString();

  // ── TODO task: approve = queue it for execution, reject = drop it ──
  if (task.status === 'todo') {
    if (action === 'approve') {
      db.prepare(`UPDATE tasks SET auto_execute = 1, updated_at = ? WHERE id = ?`).run(now, task.id);
      db.prepare(`INSERT INTO task_comments (task_id, author, type, content) VALUES (?, 'tommy', 'note', 'Tommy approved — 批准執行')`).run(task.id);
      return {
        title: 'Approved! 已批准',
        message: `#${task.id} ${task.title} — 已排入執行佇列，下個空檔（你沒在改 code 時）會自動執行，結果會在早上的快報通知你。`,
        success: true,
      };
    }
    db.prepare(`UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(now, task.id);
    db.prepare(`INSERT INTO task_comments (task_id, author, type, content) VALUES (?, 'tommy', 'note', 'Tommy rejected — 不需要做')`).run(task.id);
    return { title: 'Cancelled 已取消', message: `#${task.id} ${task.title} — removed`, success: true };
  }

  // ── REVIEW task: approve = done + PR, reject = send back for rework ──
  if (action === 'approve') {
    db.prepare(`UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?`).run(now, now, task.id);
    db.prepare(`INSERT INTO task_comments (task_id, author, type, content) VALUES (?, 'tommy', 'review', 'Approved via Telegram')`).run(task.id);

    // Find branch from comments and try to create PR
    const branchRow = db.prepare(`
      SELECT metadata, content FROM task_comments
      WHERE task_id = ? AND type = 'branch'
      ORDER BY id DESC LIMIT 1
    `).get(task.id) as { metadata: string | null; content: string } | undefined;

    let branch = '';
    if (branchRow?.metadata) {
      try { branch = JSON.parse(branchRow.metadata).branch; } catch {}
    }
    if (!branch && branchRow?.content) {
      branch = branchRow.content.replace(/^Branch:\s*/i, '').trim();
    }

    let prInfo = '';
    if (branch) {
      const result = tryCreatePR(task.id, task.title, branch);
      if (result.prUrl) {
        prInfo = `<br><br><a href="${result.prUrl}">View PR on GitHub</a>`;
        db.prepare(`INSERT INTO task_comments (task_id, author, type, content) VALUES (?, 'system', 'action', ?)`).run(task.id, `PR created: ${result.prUrl}`);
      } else if (result.error) {
        prInfo = `<br><br>PR creation failed: ${result.error.slice(0, 100)}`;
      }
    }
    return { title: 'Approved! 已上線', message: `#${task.id} ${task.title}`, success: true, extra: prInfo };
  }

  // reject a review task → send back as an auto-redo so the agent reworks it
  // (reading the boss's guidance comment + the prior review on its next pass)
  db.prepare(`UPDATE tasks SET status = 'todo', auto_execute = 1, result_notes = 'Tommy 退回重做', updated_at = ? WHERE id = ?`).run(now, task.id);
  db.prepare(`INSERT INTO task_comments (task_id, author, type, content) VALUES (?, 'tommy', 'review', 'Rejected — 退回重做（依上方引導）')`).run(task.id);
  return { title: 'Sent back 已退回', message: `#${task.id} ${task.title} — team 會依你的指示重做，完成後再請你 review。`, success: true };
}

function htmlPage(title: string, message: string, success: boolean, extra?: string): string {
  const color = success ? '#22c55e' : '#ef4444';
  const icon = success ? '&#10003;' : '&#10007;';
  const extraHtml = extra ? `<p style="color:#a1a1aa;font-size:0.875rem;margin:0.75rem 0 0;word-break:break-all">${extra}</p>` : '';
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
  a { color: #60a5fa; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style></head>
<body><div class="card">
  <div class="icon">${icon}</div>
  <h1>${title}</h1>
  <p>${message}</p>
  ${extraHtml}
</div></body></html>`;
}

/** A small form letting Tommy attach guidance before approving/rejecting. */
function htmlFormPage(task: Task): string {
  const approveToken = genToken(task.id, 'approve');
  const rejectToken = genToken(task.id, 'reject');
  const isReview = task.status === 'review';
  const approveLabel = isReview ? '✅ 上線 + 開 PR' : '✅ 批准執行';
  const rejectLabel = isReview ? '🔄 退回重做' : '❌ 不做';
  const hint = isReview
    ? '想退回就寫下要怎麼改，team 會照著重做。'
    : '想引導方向就寫在這裡，小工執行前會讀到。留空也可以直接決定。';
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>加註再決定 · #${task.id}</title>
<style>
  body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: flex-start;
    min-height: 100vh; margin: 0; background: #09090b; color: #fafafa; padding: 1.5rem; box-sizing: border-box; }
  .card { width: 100%; max-width: 480px; }
  .tag { color: #71717a; font-size: 0.8rem; }
  h1 { font-size: 1.1rem; margin: 0.25rem 0 0.75rem; line-height: 1.4; }
  .hint { color: #a1a1aa; font-size: 0.85rem; margin: 0 0 0.75rem; }
  textarea { width: 100%; box-sizing: border-box; min-height: 120px; background: #18181b; color: #fafafa;
    border: 1px solid #3f3f46; border-radius: 0.5rem; padding: 0.75rem; font-size: 1rem; font-family: inherit; resize: vertical; }
  .row { display: flex; gap: 0.6rem; margin-top: 1rem; }
  button { flex: 1; padding: 0.85rem 0.5rem; font-size: 1rem; font-weight: 600; border: none; border-radius: 0.6rem;
    cursor: pointer; color: #09090b; }
  .approve { background: #22c55e; }
  .reject { background: #f59e0b; }
</style></head>
<body><div class="card">
  <div class="tag">#${task.id} · ${isReview ? 'review' : 'todo'}</div>
  <h1>${esc(task.title)}</h1>
  <p class="hint">${hint}</p>
  <form method="POST" action="/api/tasks/quick-action">
    <input type="hidden" name="id" value="${task.id}">
    <input type="hidden" name="approveToken" value="${approveToken}">
    <input type="hidden" name="rejectToken" value="${rejectToken}">
    <textarea name="comment" placeholder="（你的引導 / 方向 / 退回原因，可留空）"></textarea>
    <div class="row">
      <button class="reject" type="submit" name="action" value="reject">${rejectLabel}</button>
      <button class="approve" type="submit" name="action" value="approve">${approveLabel}</button>
    </div>
  </form>
</div></body></html>`;
}

function html(body: string, status = 200): NextResponse {
  return new NextResponse(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function loadTask(id: number): Task | undefined {
  const db = getDb();
  return db.prepare('SELECT id, title, status FROM tasks WHERE id = ?').get(id) as Task | undefined;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const id = parseInt(searchParams.get('id') || '', 10);
  const action = searchParams.get('action') || '';
  const token = searchParams.get('token') || '';

  if (!id || !['approve', 'reject', 'comment'].includes(action) || !token) {
    return html(htmlPage('Invalid Request', 'Missing or invalid parameters.', false), 400);
  }
  if (!verifyToken(id, action, token)) {
    return html(htmlPage('Unauthorized', 'Invalid token. This link may have expired.', false), 403);
  }

  const task = loadTask(id);
  if (!task) return html(htmlPage('Not Found', `Task #${id} not found.`, false), 404);
  if (task.status !== 'review' && task.status !== 'todo') {
    return html(htmlPage('Already Handled', `Task #${id} is currently "${task.status}".`, false));
  }

  // "comment" just renders the guidance form; the form POSTs the actual decision
  if (action === 'comment') {
    return html(htmlFormPage(task));
  }

  const result = applyDecision(getDb(), task, action as 'approve' | 'reject');
  return html(htmlPage(result.title, result.message, result.success, result.extra));
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const id = parseInt(String(form.get('id') || ''), 10);
  const action = String(form.get('action') || '');
  const comment = String(form.get('comment') || '').trim();
  const token = action === 'approve' ? String(form.get('approveToken') || '') : String(form.get('rejectToken') || '');

  if (!id || !['approve', 'reject'].includes(action)) {
    return html(htmlPage('Invalid Request', 'Missing or invalid parameters.', false), 400);
  }
  if (!verifyToken(id, action, token)) {
    return html(htmlPage('Unauthorized', 'Invalid token. This link may have expired.', false), 403);
  }

  const task = loadTask(id);
  if (!task) return html(htmlPage('Not Found', `Task #${id} not found.`, false), 404);
  if (task.status !== 'review' && task.status !== 'todo') {
    return html(htmlPage('Already Handled', `Task #${id} is currently "${task.status}".`, false));
  }

  const db = getDb();
  // Save Tommy's guidance FIRST so the agent reads it when it works the ticket
  if (comment) {
    db.prepare(`INSERT INTO task_comments (task_id, author, type, content) VALUES (?, 'tommy', 'note', ?)`).run(id, comment);
  }

  const result = applyDecision(db, task, action as 'approve' | 'reject');
  const noted = comment ? `${result.message}<br><br>📝 已附上你的引導，team 會照著做。` : result.message;
  return html(htmlPage(result.title, noted, result.success, result.extra));
}
