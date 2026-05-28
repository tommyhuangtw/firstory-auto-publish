#!/usr/bin/env npx tsx
/**
 * Auto Task Executor — picks up tasks assigned to 懶懶 (auto_execute=1)
 * from the Task Board and executes them via Claude Code CLI.
 *
 * Triggered every 3 hours by macOS launchd.
 * Usage: cd dashboard && npx tsx scripts/auto-task-executor.ts
 */

import { execFile, spawn } from 'child_process';
import { existsSync, writeFileSync, unlinkSync, readFileSync } from 'fs';
import { mkdirSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

// ── Constants ────────────────────────────────────────────────────────
const BASE_URL = 'http://localhost:3000';
const MAX_TASKS_PER_RUN = 3;
const MAX_TURNS_PER_TASK = 30;
const CLAUDE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes per task
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DASHBOARD_DIR = path.resolve(__dirname, '..');
const LOCKFILE = path.join(DASHBOARD_DIR, 'data', 'auto-task-executor.lock');
const LOG_DIR = path.join(DASHBOARD_DIR, 'data', 'logs');
const HERMES_WEBHOOK_URL = process.env.HERMES_WEBHOOK_URL || 'http://localhost:8644/webhooks/podcast-events';

// ── Types ────────────────────────────────────────────────────────────
interface Task {
  id: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  category: string;
  auto_execute: number;
  result_notes: string | null;
  completed_by: string | null;
  created_at: string;
}

interface TaskComment {
  id: number;
  task_id: number;
  author: string;
  type: string;
  content: string;
  metadata: string | null;
  created_at: string;
}

// ── Logging ──────────────────────────────────────────────────────────
function log(level: string, msg: string, data?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const entry = JSON.stringify({ ts, level, msg, ...data });
  console.log(entry);
}

// ── API Helpers ──────────────────────────────────────────────────────
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${init?.method || 'GET'} ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

async function fetchTasks(status: string): Promise<Task[]> {
  const data = await apiFetch<{ tasks: Task[] }>(
    `/api/tasks?status=${status}&auto_execute=1&limit=20`
  );
  return data.tasks;
}

async function updateTask(id: number, body: Record<string, unknown>): Promise<void> {
  await apiFetch(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

async function addComment(
  taskId: number,
  type: string,
  content: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await apiFetch(`/api/tasks/${taskId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ author: 'claude-code', type, content, metadata }),
  });
}

const RESEARCH_DIR = path.join(DASHBOARD_DIR, 'data', 'research');

function saveResearchFile(taskId: number, title: string, content: string): string {
  mkdirSync(RESEARCH_DIR, { recursive: true });
  const filename = `task-${taskId}-${slugify(title)}.md`;
  const filePath = path.join(RESEARCH_DIR, filename);
  writeFileSync(filePath, content, 'utf-8');
  log('info', `Research saved to ${filePath}`);
  return filename;
}

async function postResearchWithLink(
  taskId: number,
  title: string,
  output: string
): Promise<void> {
  const filename = saveResearchFile(taskId, title, output);
  const link = `${BASE_URL}/knowledge/${filename}`;
  await addComment(
    taskId,
    'research',
    `研究完成，完整報告：\n\n📄 [${filename}](${link})\n\n---\n\n${output.length > 3000 ? output.slice(0, 3000) + '\n\n... (完整內容請開啟上方連結)' : output}`
  );
}

async function getComments(taskId: number): Promise<TaskComment[]> {
  const data = await apiFetch<{ comments: TaskComment[] }>(`/api/tasks/${taskId}/comments`);
  return data.comments;
}

// ── Telegram Notification ────────────────────────────────────────────
async function notifyTelegram(task: Task, status: string, detail: string): Promise<void> {
  try {
    const emoji = status === 'review' ? '✅' : status === 'in_progress' ? '🔄' : '⚠️';
    const message = `${emoji} <b>Task #${task.id}</b> → ${status}\n<b>${task.title}</b>\n\n${detail}`;

    await fetch(HERMES_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        event: `task.${status}`,
        data: { taskId: task.id, status, title: task.title, timestamp: new Date().toISOString() },
      }),
    }).catch(() => {});
  } catch {
    // Non-blocking — don't fail task execution if notification fails
    log('warn', `Failed to send Telegram notification for task #${task.id}`);
  }
}

// ── Git Helpers ──────────────────────────────────────────────────────
function execGit(...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) {
        const detail = [stderr, stdout, err.message].filter(Boolean).join(' | ');
        reject(new Error(`git ${args[0]} failed: ${detail}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

async function createFeatureBranch(taskId: number, title: string): Promise<string> {
  const branchName = `feat/task-${taskId}-${slugify(title)}`;

  // Stash any uncommitted changes
  await execGit('stash', '--include-untracked').catch(() => {});

  // Check if branch already exists
  const existingBranches = await execGit('branch', '--list', branchName);
  if (existingBranches.trim()) {
    // Branch exists — reuse it (e.g. retry after previous failure)
    log('info', `Branch ${branchName} already exists, switching to it`);
    await execGit('checkout', branchName);
    // Rebase on latest main to pick up any new changes
    await execGit('checkout', 'main');
    await execGit('pull', '--ff-only').catch(() => {
      log('warn', 'git pull failed, continuing with local main');
    });
    await execGit('checkout', branchName);
    try {
      await execGit('rebase', 'main');
    } catch {
      log('warn', 'Rebase failed, aborting and continuing with existing branch state');
      await execGit('rebase', '--abort').catch(() => {});
    }
    log('info', `Reusing existing branch: ${branchName}`);
    return branchName;
  }

  // Create new branch from latest main
  await execGit('checkout', 'main');
  await execGit('pull', '--ff-only').catch(() => {
    log('warn', 'git pull failed, continuing with local main');
  });
  await execGit('checkout', '-b', branchName);

  log('info', `Created branch: ${branchName}`);
  return branchName;
}

async function commitChanges(branchName: string, taskId: number, message: string): Promise<boolean> {
  try {
    // Ensure we're on the expected branch (Claude Code may have switched)
    const currentBranch = await execGit('branch', '--show-current');
    if (currentBranch !== branchName) {
      log('warn', `Expected branch ${branchName}, but on ${currentBranch}. Switching back.`);
      await execGit('checkout', branchName).catch(() => {
        log('warn', `Could not switch to ${branchName}, committing on ${currentBranch}`);
      });
    }

    const status = await execGit('status', '--porcelain');
    if (!status.trim()) {
      log('info', 'No changes to commit (Claude Code may have already committed)');
      return false;
    }
    await execGit('add', '-A');
    await execGit('commit', '-m', `feat(task-${taskId}): ${message}`);
    log('info', `Committed on ${branchName}`);
    return true;
  } catch (e) {
    log('error', 'Commit failed', { error: String(e) });
    return false;
  }
}

// ── Sort Tasks ───────────────────────────────────────────────────────
function sortTasks(tasks: Task[]): Task[] {
  const categoryOrder = (c: string) => (c === 'research' ? 0 : 1);
  const priorityOrder = (p: string) => {
    switch (p) {
      case 'urgent': return 0;
      case 'high': return 1;
      case 'low': return 2;
      default: return 3; // medium
    }
  };

  return [...tasks].sort((a, b) => {
    // Research first
    const catDiff = categoryOrder(a.category) - categoryOrder(b.category);
    if (catDiff !== 0) return catDiff;
    // Then high/urgent priority
    const priDiff = priorityOrder(a.priority) - priorityOrder(b.priority);
    if (priDiff !== 0) return priDiff;
    // Then by created_at ASC (older first)
    return a.created_at.localeCompare(b.created_at);
  });
}

// ── Claude Code Execution ────────────────────────────────────────────
function buildPrompt(task: Task, branchName: string, comments: TaskComment[] = []): string {
  const isResearch = task.category === 'research';

  let prompt = `You are an automated agent (懶懶) working on the AI 懶人報 Podcast Automation project.
You are on branch: ${branchName}
Working directory: ${DASHBOARD_DIR}

## Task #${task.id}
**Title**: ${task.title}
**Category**: ${task.category}
**Priority**: ${task.priority}
**Description**:
${task.description || '(no description provided)'}`;

  // Include previous activity if any (so agent knows what happened before)
  if (comments.length > 0) {
    const commentLog = comments
      .map((c) => `[${c.created_at}] ${c.author} (${c.type}): ${c.content.slice(0, 500)}`)
      .join('\n\n');
    prompt += `

## Previous Activity on This Ticket
The following activity has already happened on this ticket. Read it carefully to avoid repeating mistakes or duplicating work.

${commentLog}
`;
  }

  prompt += `

## Instructions
1. Read CLAUDE.md for coding guidelines
2. Implement the task as described
3. Follow existing code patterns — check similar files first
4. Make surgical changes — only modify what is necessary
5. Do NOT call the Task Board API (localhost:3000/api/tasks) — the executor script handles status updates and comments automatically
`;

  if (isResearch) {
    prompt += `
## Research Task Instructions
- **一律使用繁體中文撰寫**（標題、內容、分析、建議全部用中文）
- Conduct thorough research on the topic
- Provide a complete analysis with findings, sources, and recommendations
- Structure your output clearly with sections and key takeaways
- Include actionable recommendations
`;
  } else {
    prompt += `
## Development Task Instructions
- After implementation, verify: \`cd ${DASHBOARD_DIR} && npm run build\`
- If build fails, fix errors before finishing
- If you hit a blocker you cannot resolve, clearly describe:
  - What is blocking you
  - What you've tried
  - Suggested next steps
  - Relevant file paths and line numbers
`;
  }

  prompt += `
## Output Format (IMPORTANT)
Your output will be shown to the project owner for review. Structure it as an executive briefing:

**FIRST LINE**: One-sentence summary of what was done (this becomes the ticket headline).

**Decisions needed** (if any): List specific questions or choices the owner needs to make. Be concrete — "Option A: X, Option B: Y" not vague.

**What was done**: Bullet list of changes/findings.

**What to verify**: Specific things the owner should check (branch name, files to review, endpoints to test).

**Blockers** (if any): What you couldn't resolve and what the owner needs to do.

Keep it concise — the owner should be able to review in under 2 minutes.
`;

  return prompt;
}

function buildPickupPrompt(task: Task, branchName: string, comments: TaskComment[], userReply: string): string {
  const commentLog = comments
    .map((c) => `[${c.created_at}] ${c.author} (${c.type}): ${c.content}`)
    .join('\n\n');

  return `You are resuming work on a previously blocked task.

## Task #${task.id}
**Title**: ${task.title}
**Branch**: ${branchName}
**Category**: ${task.category}
Working directory: ${DASHBOARD_DIR}

## Previous Work & Blocker
${commentLog}

## User's Response
${userReply}

## Instructions
1. Switch to branch ${branchName}: \`git checkout ${branchName}\`
2. Read the blocker context above carefully
3. Continue implementation based on user's response
4. Read CLAUDE.md for coding guidelines
5. Follow existing code patterns
${task.category !== 'research' ? `6. Verify: \`cd ${DASHBOARD_DIR} && npm run build\`` : ''}

## Output
Provide a structured summary:
- What you did to resolve the blocker
- Files changed and why
- Build/test verification result
- Any remaining blockers or concerns
`;
}

function runClaudeCode(prompt: string): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    // Write prompt to temp file to avoid CLI arg length/encoding issues
    const promptFile = path.join(tmpdir(), `claude-task-${Date.now()}.txt`);
    writeFileSync(promptFile, prompt, 'utf-8');

    const chunks: string[] = [];
    const errChunks: string[] = [];
    let killed = false;

    // Use shell to pipe prompt file via stdin to avoid CLI arg length issues
    const proc = spawn('sh', [
      '-c',
      `cat "${promptFile}" | claude -p - --output-format text --max-turns ${MAX_TURNS_PER_TASK} --dangerously-skip-permissions`,
    ], {
      cwd: DASHBOARD_DIR,
      env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'auto-task-executor' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout.on('data', (data: Buffer) => chunks.push(data.toString()));
    proc.stderr.on('data', (data: Buffer) => errChunks.push(data.toString()));

    // Timeout handler — kill but preserve partial output
    const timer = setTimeout(() => {
      killed = true;
      log('warn', 'Claude Code timeout, killing process');
      proc.kill('SIGTERM');
    }, CLAUDE_TIMEOUT_MS);

    proc.on('close', (code) => {
      clearTimeout(timer);
      // Clean up temp file
      try { unlinkSync(promptFile); } catch {}

      const stdout = chunks.join('').trim();
      const stderr = errChunks.join('').trim();

      if (killed) {
        const msg = `Timeout: task exceeded ${CLAUDE_TIMEOUT_MS / 60000} minutes`;
        log('error', 'Claude Code timed out', { partialOutputLength: stdout.length });
        if (stdout) {
          resolve({ success: true, output: stdout + '\n\n⚠️ (partial output — execution timed out)' });
        } else {
          resolve({ success: false, output: msg });
        }
      } else if (code !== 0) {
        const errMsg = stderr || `Process exited with code ${code}`;
        log('error', 'Claude Code failed', { code, stderr: errMsg.slice(0, 500) });
        // Still return partial output if available
        if (stdout) {
          resolve({ success: true, output: stdout + `\n\n⚠️ (process exited with code ${code})` });
        } else {
          resolve({ success: false, output: errMsg.slice(0, 2000) });
        }
      } else {
        resolve({ success: true, output: stdout });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      try { unlinkSync(promptFile); } catch {}
      log('error', 'Failed to spawn claude', { error: err.message });
      resolve({ success: false, output: `Failed to spawn claude: ${err.message}` });
    });
  });
}

// ── Build Verification ───────────────────────────────────────────────
function runBuildVerification(): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile('npm', ['run', 'build'], {
      cwd: DASHBOARD_DIR,
      encoding: 'utf-8',
      timeout: 120_000,
      maxBuffer: 5 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      const output = (stdout + '\n' + stderr).trim();
      const truncated = output.length > 3000
        ? '...(truncated)\n' + output.slice(-3000)
        : output;
      resolve({ success: !error, output: truncated });
    });
  });
}

// ── Blocked Task Pickup ──────────────────────────────────────────────
async function findResumableTasks(): Promise<Array<{ task: Task; userReply: string; branch: string }>> {
  // No longer needed — blocked tasks now use status='blocked'.
  // User moves ticket back to 'todo' after providing input,
  // and the normal todo flow picks it up with full history context.
  // This function is kept for backwards compat with any old in_progress+BLOCKED tasks.
  const inProgressTasks = await fetchTasks('in_progress');
  const resumable: Array<{ task: Task; userReply: string; branch: string }> = [];

  for (const task of inProgressTasks) {
    if (!task.result_notes?.startsWith('BLOCKED:')) continue;

    const comments = await getComments(task.id);

    // Find the last claude-code comment
    const lastAgentIdx = comments.reduce(
      (idx, c, i) => (c.author === 'claude-code' ? i : idx),
      -1
    );

    // Find user reply after the last agent comment
    const userReply = comments
      .slice(lastAgentIdx + 1)
      .filter((c) => c.author === 'tommy')
      .map((c) => c.content)
      .join('\n');

    if (!userReply.trim()) continue; // No user reply yet, skip

    // Find branch from comments
    const branchComment = comments.find((c) => c.type === 'branch');
    const branch = branchComment?.metadata
      ? JSON.parse(branchComment.metadata).branch || ''
      : '';

    if (branch) {
      resumable.push({ task, userReply, branch });
      log('info', `Found resumable blocked task #${task.id}`);
    }
  }

  return resumable;
}

// ── Process Single Task ──────────────────────────────────────────────
async function processNewTask(task: Task): Promise<void> {
  log('info', `Processing task #${task.id}: ${task.title}`, {
    category: task.category,
    priority: task.priority,
  });

  // 1. Fetch previous activity (so agent knows history)
  const previousComments = await getComments(task.id);

  // 2. Claim task
  // Re-fetch to confirm still todo (race condition guard)
  const fresh = await apiFetch<Task>(`/api/tasks/${task.id}`);
  if (fresh.status !== 'todo') {
    log('info', `Task #${task.id} no longer todo (now: ${fresh.status}), skipping`);
    return;
  }
  await updateTask(task.id, { status: 'in_progress' });
  await notifyTelegram(task, 'in_progress', `🤖 懶懶開始執行\nCategory: ${task.category} | Priority: ${task.priority}`);

  // 3. Create feature branch
  let branchName: string;
  try {
    branchName = await createFeatureBranch(task.id, task.title);
  } catch (e) {
    log('error', `Failed to create branch for task #${task.id}`, { error: String(e) });
    await addComment(task.id, 'note', `Failed to create feature branch: ${e}`);
    return;
  }

  // 4. Record branch + start
  await addComment(task.id, 'branch', `Branch: ${branchName}`, { branch: branchName });
  await addComment(task.id, 'action', '🤖 自動執行開始');

  // 5. Run Claude Code (with history context)
  const prompt = buildPrompt(task, branchName, previousComments);
  const result = await runClaudeCode(prompt);

  // Truncate output for comment (max ~4000 chars)
  const outputForComment = result.output.length > 4000
    ? result.output.slice(0, 2000) + '\n\n...(truncated)...\n\n' + result.output.slice(-1500)
    : result.output;

  if (!result.success) {
    // Claude Code failed
    await addComment(task.id, 'action', `❌ Claude Code execution failed:\n\`\`\`\n${outputForComment}\n\`\`\``);
    await updateTask(task.id, {
      status: 'blocked',
      result_notes: `Claude Code execution failed — 需要: check error log`,
    });
    await notifyTelegram(task, 'blocked', `❌ Claude Code 執行失敗\n請檢查 ticket comments`);
    // Switch back to main
    await execGit('checkout', 'main').catch(() => {});
    return;
  }

  // 5a. Ensure we're back on the feature branch (Claude Code may have switched)
  const currentBranch = await execGit('branch', '--show-current').catch(() => 'unknown');
  if (currentBranch !== branchName) {
    log('warn', `After Claude Code: on branch ${currentBranch}, expected ${branchName}. Switching back.`);
    await execGit('checkout', branchName).catch(() => {
      log('warn', `Could not switch back to ${branchName}`);
    });
  }

  // 5. Record work log
  await addComment(task.id, 'action', `工作紀錄:\n${outputForComment}`);

  // 6. Check if output indicates a blocker or max turns
  const outputLower = result.output.toLowerCase();
  const hitMaxTurns = outputLower.includes('max turns') || outputLower.includes('reached max');
  const isBlocked = outputLower.includes('blocker') || outputLower.includes('blocked') || outputLower.includes('cannot resolve');

  if (hitMaxTurns) {
    log('warn', `Task #${task.id}: hit max turns limit`);
    await addComment(task.id, 'note', `⚠️ Claude Code 達到最大回合數 (${MAX_TURNS_PER_TASK} turns)，任務可能未完成。\n\n## Pickup Context\n- Branch: ${branchName}\n- 恢復方式: git checkout ${branchName}\n- 查看上方工作紀錄了解進度`);
    await commitChanges(branchName, task.id, 'partial progress (max turns)');
    await updateTask(task.id, {
      status: 'blocked',
      result_notes: `Hit max turns (${MAX_TURNS_PER_TASK}) — 需要: 確認進度並決定是否繼續`,
    });
    await notifyTelegram(task, 'blocked', `⚠️ 達到最大回合數，任務可能未完成\nBranch: ${branchName}`);
    await execGit('checkout', 'main').catch(() => {});
    return;
  }

  if (isBlocked && !outputLower.includes('resolved')) {
    // Extract blocker context from output
    await addComment(task.id, 'note', `## ⛔ Blocker\n\nClaude Code indicated a blocker in the output. Review the work log above for details.\n\n## Pickup Context（給下一個 agent）\n- Branch: ${branchName}\n- 恢復方式: git checkout ${branchName}\n- 查看上方工作紀錄了解進度和卡關原因`);
    await updateTask(task.id, {
      status: 'blocked',
      result_notes: `See comments for details — 需要: human review`,
    });
    await notifyTelegram(task, 'blocked', `⛔ 遇到 Blocker，需要你的 input\n請檢查 ticket comments`);
    await commitChanges(branchName, task.id, 'partial progress (blocked)');
    await execGit('checkout', 'main').catch(() => {});
    return;
  }

  // 7. For dev tasks: verify build
  if (task.category !== 'research') {
    const build = await runBuildVerification();
    await addComment(task.id, 'test', `Build verification (npm run build):\n\`\`\`\n${build.output}\n\`\`\`\n\nResult: ${build.success ? '✅ PASS' : '❌ FAIL'}`);

    if (!build.success) {
      await addComment(task.id, 'note', `Build failed. Keeping task in progress for review.\n\n## Pickup Context\n- Branch: ${branchName}\n- 恢復方式: git checkout ${branchName}, fix build errors`);
      await updateTask(task.id, {
        status: 'blocked',
        result_notes: `Build verification failed — 需要: fix build errors`,
      });
      await notifyTelegram(task, 'blocked', `❌ Build 失敗\nBranch: ${branchName}\n請檢查 ticket comments`);
      await commitChanges(branchName, task.id, 'implementation (build failing)');
      await execGit('checkout', 'main').catch(() => {});
      return;
    }
  }

  // 8. Commit changes
  await commitChanges(branchName, task.id, task.title);

  // 9. For research: save .md file and post link
  if (task.category === 'research') {
    await postResearchWithLink(task.id, task.title, result.output);
  }

  // 10. Verify actual work was produced before moving to review
  if (task.category !== 'research') {
    // Dev tasks: check if branch has any commits ahead of main
    const commitsAhead = await execGit('rev-list', '--count', `main..${branchName}`).catch(() => '0');
    const hasCommits = parseInt(commitsAhead) > 0;

    // Also check if there are any file changes vs main
    const diffStat = await execGit('diff', '--stat', `main..${branchName}`).catch(() => '');
    const hasChanges = diffStat.trim().length > 0;

    if (!hasCommits && !hasChanges) {
      log('warn', `Task #${task.id}: no commits or changes on branch ${branchName}. Not moving to review.`);
      await addComment(task.id, 'note', `⚠️ Branch ${branchName} 沒有任何 commits 或程式碼變更。Claude Code 可能未實際執行修改。\n\n請檢查上方工作紀錄，決定是否需要重新執行。`);
      await updateTask(task.id, {
        status: 'blocked',
        result_notes: `No code changes produced — 需要: 確認是否需要重跑`,
      });
      await notifyTelegram(task, 'blocked', `⚠️ 沒有產出程式碼變更\nBranch: ${branchName}\n請檢查 ticket`);
      await execGit('checkout', 'main').catch(() => {});
      return;
    }
  }

  // 11. Move to review
  const summary = result.output.length > 500 ? result.output.slice(0, 500) + '...' : result.output;
  await updateTask(task.id, {
    status: 'review',
    completed_by: 'claude-code',
    result_notes: summary,
  });

  const reviewSummary = summary.length > 200 ? summary.slice(0, 200) + '...' : summary;
  await notifyTelegram(task, 'review', `完成！等待 review\nBranch: ${branchName}\n\n${reviewSummary}`);
  log('info', `Task #${task.id} completed and moved to review`);
  await execGit('checkout', 'main').catch(() => {});
}

async function processResumedTask(
  task: Task,
  userReply: string,
  branchName: string
): Promise<void> {
  log('info', `Resuming blocked task #${task.id}: ${task.title}`);

  const comments = await getComments(task.id);
  await addComment(task.id, 'action', '🤖 自動執行恢復 — user 已回覆 blocker');
  await notifyTelegram(task, 'in_progress', `🔄 恢復執行 — blocker 已由 user 回覆\nBranch: ${branchName}`);

  // Checkout existing branch
  try {
    await execGit('stash', '--include-untracked').catch(() => {});
    await execGit('checkout', branchName);
  } catch (e) {
    log('error', `Failed to checkout ${branchName}`, { error: String(e) });
    await addComment(task.id, 'note', `Failed to checkout branch ${branchName}: ${e}`);
    return;
  }

  // Build pickup prompt and run
  const prompt = buildPickupPrompt(task, branchName, comments, userReply);
  const result = await runClaudeCode(prompt);

  const outputForComment = result.output.length > 4000
    ? result.output.slice(0, 2000) + '\n\n...(truncated)...\n\n' + result.output.slice(-1500)
    : result.output;

  if (!result.success) {
    await addComment(task.id, 'action', `❌ Resumed execution failed:\n\`\`\`\n${outputForComment}\n\`\`\``);
    await execGit('checkout', 'main').catch(() => {});
    return;
  }

  await addComment(task.id, 'action', `工作紀錄 (恢復):\n${outputForComment}`);

  // Build verification for dev tasks
  if (task.category !== 'research') {
    const build = await runBuildVerification();
    await addComment(task.id, 'test', `Build verification:\n\`\`\`\n${build.output}\n\`\`\`\n\nResult: ${build.success ? '✅ PASS' : '❌ FAIL'}`);

    if (!build.success) {
      await updateTask(task.id, {
        status: 'blocked',
        result_notes: `Build still failing after resume — 需要: manual fix`,
      });
      await commitChanges(branchName, task.id, 'resumed work (build failing)');
      await execGit('checkout', 'main').catch(() => {});
      return;
    }
  }

  await commitChanges(branchName, task.id, `resume: ${task.title}`);

  if (task.category === 'research') {
    await postResearchWithLink(task.id, task.title, result.output);
  }

  // Verify actual work was produced before moving to review
  if (task.category !== 'research') {
    const commitsAhead = await execGit('rev-list', '--count', `main..${branchName}`).catch(() => '0');
    const diffStat = await execGit('diff', '--stat', `main..${branchName}`).catch(() => '');
    if (parseInt(commitsAhead) === 0 && !diffStat.trim()) {
      log('warn', `Resumed task #${task.id}: no commits or changes. Not moving to review.`);
      await addComment(task.id, 'note', `⚠️ 恢復執行後仍無程式碼變更。請檢查工作紀錄。`);
      await updateTask(task.id, {
        status: 'blocked',
        result_notes: `No code changes after resume — 需要: 確認是否需要重跑`,
      });
      await execGit('checkout', 'main').catch(() => {});
      return;
    }
  }

  const summary = result.output.length > 500 ? result.output.slice(0, 500) + '...' : result.output;
  await updateTask(task.id, {
    status: 'review',
    completed_by: 'claude-code',
    result_notes: summary,
  });

  const reviewSummary = summary.length > 200 ? summary.slice(0, 200) + '...' : summary;
  await notifyTelegram(task, 'review', `恢復完成！等待 review\nBranch: ${branchName}\n\n${reviewSummary}`);
  log('info', `Resumed task #${task.id} completed and moved to review`);
  await execGit('checkout', 'main').catch(() => {});
}

// ── Lockfile ─────────────────────────────────────────────────────────
function acquireLock(): boolean {
  if (existsSync(LOCKFILE)) {
    try {
      const pid = parseInt(readFileSync(LOCKFILE, 'utf-8').trim());
      // Check if process is still running
      try {
        process.kill(pid, 0);
        log('warn', 'Another instance is still running', { pid });
        return false;
      } catch {
        // Process not running, stale lock
        log('info', 'Removing stale lockfile', { pid });
        unlinkSync(LOCKFILE);
      }
    } catch {
      unlinkSync(LOCKFILE);
    }
  }
  writeFileSync(LOCKFILE, String(process.pid));
  return true;
}

function releaseLock() {
  try {
    unlinkSync(LOCKFILE);
  } catch {}
}

// ── Health Check ─────────────────────────────────────────────────────
async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/tasks?limit=1`);
    return res.ok;
  } catch {
    return false;
  }
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  // Ensure log directory exists
  mkdirSync(LOG_DIR, { recursive: true });

  log('info', '=== Auto Task Executor started ===');

  // Acquire lock
  if (!acquireLock()) {
    log('warn', 'Exiting: another instance is running');
    process.exit(0);
  }

  try {
    // Health check
    if (!(await healthCheck())) {
      log('error', 'Dashboard not reachable at ' + BASE_URL);
      process.exit(1);
    }

    // Fetch new todo tasks
    const todoTasks = await fetchTasks('todo');
    log('info', `Found ${todoTasks.length} todo tasks with auto_execute=1`);

    // Find resumable blocked tasks
    const resumable = await findResumableTasks();
    log('info', `Found ${resumable.length} resumable blocked tasks`);

    // Sort new tasks
    const sorted = sortTasks(todoTasks);

    // Process tasks (resumable first, then new, up to MAX_TASKS_PER_RUN total)
    let processed = 0;

    for (const { task, userReply, branch } of resumable) {
      if (processed >= MAX_TASKS_PER_RUN) break;
      try {
        await processResumedTask(task, userReply, branch);
        processed++;
      } catch (e) {
        log('error', `Error processing resumed task #${task.id}`, { error: String(e) });
        await addComment(task.id, 'note', `Executor error: ${e}`).catch(() => {});
        await execGit('checkout', 'main').catch(() => {});
      }
    }

    for (const task of sorted) {
      if (processed >= MAX_TASKS_PER_RUN) {
        log('info', `Reached max tasks per run (${MAX_TASKS_PER_RUN}), skipping remaining`);
        break;
      }
      try {
        await processNewTask(task);
        processed++;
      } catch (e) {
        log('error', `Error processing task #${task.id}`, { error: String(e) });
        await addComment(task.id, 'note', `Executor error: ${e}`).catch(() => {});
        await execGit('checkout', 'main').catch(() => {});
      }
    }

    log('info', `=== Auto Task Executor finished. Processed ${processed} tasks ===`);
  } finally {
    releaseLock();
    // Always return to main branch
    await execGit('checkout', 'main').catch(() => {});
  }
}

main().catch((e) => {
  log('error', 'Fatal error', { error: String(e) });
  releaseLock();
  process.exit(1);
});
