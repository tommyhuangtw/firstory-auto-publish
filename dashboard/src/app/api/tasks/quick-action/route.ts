import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { createHmac } from 'crypto';
import { execSync } from 'child_process';
import path from 'path';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');

function getSecret(): string {
  // Use the same bot token as agents/base.ts for HMAC
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  const { readFileSync, existsSync } = require('fs');
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

function verifyToken(taskId: number, action: string, token: string): boolean {
  const secret = getSecret();
  const expected = createHmac('sha256', secret).update(`${taskId}:${action}`).digest('hex').slice(0, 16);
  return expected === token;
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

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const id = parseInt(searchParams.get('id') || '', 10);
  const action = searchParams.get('action') || '';
  const token = searchParams.get('token') || '';

  // Validate params
  if (!id || !['approve', 'reject'].includes(action) || !token) {
    return new NextResponse(
      htmlPage('Invalid Request', 'Missing or invalid parameters.', false),
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  // Verify HMAC token
  if (!verifyToken(id, action, token)) {
    return new NextResponse(
      htmlPage('Unauthorized', 'Invalid token. This link may have expired.', false),
      { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as { id: number; title: string; status: string } | undefined;

  if (!task) {
    return new NextResponse(
      htmlPage('Not Found', `Task #${id} not found.`, false),
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  // Two flows: "todo" tasks need approval to start, "review" tasks need approval to finish
  if (task.status !== 'review' && task.status !== 'todo') {
    return new NextResponse(
      htmlPage('Already Handled', `Task #${id} is currently "${task.status}".`, false),
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  // ── TODO task: approve = enable auto_execute so agent can pick it up ──
  if (task.status === 'todo') {
    if (action === 'approve') {
      db.prepare(`UPDATE tasks SET auto_execute = 1, updated_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), id);
      db.prepare(`INSERT INTO task_comments (task_id, author, type, content) VALUES (?, 'tommy', 'note', 'Tommy approved — 批准執行')`)
        .run(id);
      return new NextResponse(
        htmlPage('Approved!', `Task #${id}: ${task.title} — agent will pick it up`, true),
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    } else {
      db.prepare(`UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), id);
      db.prepare(`INSERT INTO task_comments (task_id, author, type, content) VALUES (?, 'tommy', 'note', 'Tommy rejected — 不需要做')`)
        .run(id);
      return new NextResponse(
        htmlPage('Cancelled', `Task #${id}: ${task.title} — removed`, true),
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }
  }

  // ── REVIEW task: approve = done + create PR, reject = send back ──
  if (action === 'approve') {
    db.prepare(`UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), new Date().toISOString(), id);
    db.prepare(`INSERT INTO task_comments (task_id, author, type, content) VALUES (?, 'tommy', 'review', 'Approved via Telegram')`)
      .run(id);

    // Find branch from comments and try to create PR
    const branchRow = db.prepare(`
      SELECT metadata, content FROM task_comments
      WHERE task_id = ? AND type = 'branch'
      ORDER BY id DESC LIMIT 1
    `).get(id) as { metadata: string | null; content: string } | undefined;

    let branch = '';
    if (branchRow?.metadata) {
      try { branch = JSON.parse(branchRow.metadata).branch; } catch {}
    }
    if (!branch && branchRow?.content) {
      branch = branchRow.content.replace(/^Branch:\s*/i, '').trim();
    }

    let prInfo = '';
    if (branch) {
      const result = tryCreatePR(id, task.title, branch);
      if (result.prUrl) {
        prInfo = `<br><br><a href="${result.prUrl}">View PR on GitHub</a>`;
        db.prepare(`INSERT INTO task_comments (task_id, author, type, content) VALUES (?, 'system', 'action', ?)`)
          .run(id, `PR created: ${result.prUrl}`);
      } else if (result.error) {
        prInfo = `<br><br>PR creation failed: ${result.error.slice(0, 100)}`;
      }
    }

    return new NextResponse(
      htmlPage('Approved!', `Task #${id}: ${task.title}`, true, prInfo),
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  } else {
    db.prepare(`UPDATE tasks SET status = 'in_progress', result_notes = 'Rejected via Telegram', updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), id);
    db.prepare(`INSERT INTO task_comments (task_id, author, type, content) VALUES (?, 'tommy', 'review', 'Rejected via Telegram — 退回 agent 重做')`)
      .run(id);

    return new NextResponse(
      htmlPage('Rejected', `Task #${id}: ${task.title} — sent back to agent`, true),
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}
