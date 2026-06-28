#!/usr/bin/env npx tsx
/**
 * 小工 (Engineer Agent) — Senior Engineer responsible for implementation.
 *
 * Receives tasks from 懶懶 (PM), executes via Claude Code CLI,
 * runs build verification, commits, and reports results back.
 * Can also propose improvements when technical debt or bugs are spotted.
 *
 * Usage (standalone test): cd dashboard && npx tsx scripts/agents/engineer.ts --task-id 42
 * Normally called by the orchestrator.
 */

import { execFile, spawn } from 'child_process';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';

import {
  type AgentConfig,
  type Task,
  type TaskComment,
  log,
  generateSessionId,
  logDiscussion,
  createProposal,
  apiFetch,
  updateTask,
  addComment,
  buildAgentPrompt,
  getSessionDiscussions,
  reflectAndLearn,
} from './base';

// ── Constants ────────────────────────────────────────────────────────
const MAX_TURNS_PER_TASK = 50;
const CLAUDE_TIMEOUT_MS = 50 * 60 * 1000; // 50 minutes
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DASHBOARD_DIR = path.resolve(__dirname, '..');

// ── Agent Config ─────────────────────────────────────────────────────
const ENGINEER_CONFIG: AgentConfig = {
  id: 'engineer',
  name: '小工',
  role: 'Senior Engineer',
  systemPrompt: `你是小工，AI 懶人報的 Senior Engineer。

## 核心職責
- 接收 懶懶 (PM) 分配的 ticket，建 branch、寫 code、跑 build、commit
- 完成後回報懶懶，附上工作摘要和 build 結果
- 發現 bug 或技術債時，主動提案給懶懶
- 做技術可行性評估

## 行為規範
1. **Honest Engineering** — 不確定的事情要說，不要編造答案
2. **Simplicity First** — 最少程式碼解決問題，不 over-engineer
3. **Surgical Changes** — 只改必要的部分，不「順便改善」
4. **Build Verification** — 每次開發完必須 npm run build 通過
5. **Clear Reporting** — 完成後要附上明確的測試證明

## 不做的事
- 不做內容策略（那是小企的事）
- 不做最終決策（那是懶懶的事）
- 不直接跟 Tommy 溝通（透過懶懶）

## 提案時機
- 發現重複 code 可以抽成共用
- 發現效能瓶頸或 cost 異常
- 發現安全性問題
- build 或 test 穩定性問題`,
};

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

  await execGit('stash', '--include-untracked').catch(() => {});

  const existingBranches = await execGit('branch', '--list', branchName);
  if (existingBranches.trim()) {
    log('info', `Branch ${branchName} already exists, reusing`);
    await execGit('checkout', branchName);
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
    return branchName;
  }

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
    const currentBranch = await execGit('branch', '--show-current');
    if (currentBranch !== branchName) {
      log('warn', `Expected branch ${branchName}, but on ${currentBranch}. Switching back.`);
      await execGit('checkout', branchName).catch(() => {});
    }

    const status = await execGit('status', '--porcelain');
    if (!status.trim()) {
      log('info', 'No changes to commit');
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

async function verifyChanges(branchName: string): Promise<{ hasCommits: boolean; hasChanges: boolean; summary: string }> {
  try {
    const commitCount = await execGit('rev-list', '--count', `main..${branchName}`);
    const diffStat = await execGit('diff', '--stat', `main..${branchName}`);
    const count = parseInt(commitCount, 10);
    return {
      hasCommits: count > 0,
      hasChanges: diffStat.trim().length > 0,
      summary: `${count} commit(s)${diffStat ? `\n${diffStat}` : ''}`,
    };
  } catch {
    return { hasCommits: false, hasChanges: false, summary: 'Could not verify changes' };
  }
}

// ── Claude Code CLI ─────────────────────────────────────────────────

function runClaudeCode(prompt: string): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const promptFile = path.join(tmpdir(), `claude-engineer-${Date.now()}.txt`);
    writeFileSync(promptFile, prompt, 'utf-8');

    const chunks: string[] = [];
    const errChunks: string[] = [];
    let killed = false;

    const proc = spawn('sh', [
      '-c',
      `cat "${promptFile}" | claude -p - --output-format text --max-turns ${MAX_TURNS_PER_TASK} --dangerously-skip-permissions`,
    ], {
      cwd: DASHBOARD_DIR,
      env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'engineer-agent' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout.on('data', (data: Buffer) => chunks.push(data.toString()));
    proc.stderr.on('data', (data: Buffer) => errChunks.push(data.toString()));

    const timer = setTimeout(() => {
      killed = true;
      log('warn', 'Claude Code timeout, killing process');
      proc.kill('SIGTERM');
    }, CLAUDE_TIMEOUT_MS);

    proc.on('close', (code) => {
      clearTimeout(timer);
      try { unlinkSync(promptFile); } catch {}

      const stdout = chunks.join('').trim();
      const stderr = errChunks.join('').trim();

      if (killed) {
        resolve({
          success: !!stdout,
          output: stdout ? stdout + '\n\n⚠️ (partial — execution timed out)' : `Timeout: exceeded ${CLAUDE_TIMEOUT_MS / 60000} min`,
        });
      } else if (code !== 0) {
        resolve({
          success: !!stdout,
          output: stdout ? stdout + `\n\n⚠️ (exited with code ${code})` : (stderr || `Process exited with code ${code}`).slice(0, 2000),
        });
      } else {
        resolve({ success: true, output: stdout });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      try { unlinkSync(promptFile); } catch {}
      resolve({ success: false, output: `Failed to spawn claude: ${err.message}` });
    });
  });
}

// ── Build Verification ──────────────────────────────────────────────

function runBuildVerification(): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile('npm', ['run', 'build'], {
      cwd: DASHBOARD_DIR,
      timeout: 120_000,
      maxBuffer: 5 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      const combined = [stdout, stderr].filter(Boolean).join('\n').slice(-3000);
      resolve({ success: !err, output: combined });
    });
  });
}

// ── Research File Helper ────────────────────────────────────────────

function saveResearchFile(taskId: number, title: string, content: string): string {
  const dir = path.join(DASHBOARD_DIR, 'data', 'research');
  if (!existsSync(dir)) {
    require('fs').mkdirSync(dir, { recursive: true });
  }
  const slug = slugify(title).slice(0, 60);
  const filename = `task-${taskId}-${slug}.md`;
  const filepath = path.join(dir, filename);
  require('fs').writeFileSync(filepath, content, 'utf-8');
  return filepath;
}

// ── Prompt Building ─────────────────────────────────────────────────

function buildTaskPrompt(task: Task, branchName: string, comments: TaskComment[]): string {
  const isResearch = task.category === 'research';

  let prompt = `You are 小工 (Senior Engineer) working on the AI 懶人報 Podcast Automation project.
You are on branch: ${branchName}
Working directory: ${DASHBOARD_DIR}

## Task #${task.id}
**Title**: ${task.title}
**Category**: ${task.category}
**Priority**: ${task.priority}
**Description**:
${task.description || '(no description provided)'}`;

  if (comments.length > 0) {
    const commentLog = comments
      .map(c => `[${c.created_at}] ${c.author} (${c.type}): ${c.content.slice(0, 500)}`)
      .join('\n\n');
    prompt += `\n\n## Previous Activity\n${commentLog}\n`;
  }

  prompt += `\n\n## Instructions
1. Read CLAUDE.md for coding guidelines
2. Implement the task as described
3. Follow existing code patterns — check similar files first
4. Make surgical changes — only modify what is necessary
5. Do NOT call the Task Board API — the executor handles status updates
`;

  if (isResearch) {
    prompt += `\n## Research Task Instructions
- **一律使用繁體中文撰寫**（標題、內容、分析、建議全部用中文）
- Conduct thorough research on the topic
- Provide a complete analysis with findings, sources, and recommendations
- Structure output clearly with sections and key takeaways
- Include actionable recommendations
`;
  } else {
    prompt += `\n## Development Task Instructions
- After implementation, verify: \`cd ${DASHBOARD_DIR} && npm run build\`
- If build fails, fix errors before finishing
- If you hit a blocker, clearly describe:
  - What is blocking you
  - What you've tried
  - Suggested next steps
`;
  }

  prompt += `\n## Output Format
**FIRST LINE**: One-sentence summary of what was done.
**What was done**: Bullet list of changes/findings.
**What to verify**: Specific things to check.
**Blockers** (if any): What couldn't be resolved.
Keep it concise.
`;

  return prompt;
}

function buildResumePrompt(task: Task, branchName: string, comments: TaskComment[], userReply: string): string {
  const commentLog = comments
    .map(c => `[${c.created_at}] ${c.author} (${c.type}): ${c.content}`)
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
${task.category !== 'research' ? `5. Verify: \`cd ${DASHBOARD_DIR} && npm run build\`` : ''}

## Output
- What you did to resolve the blocker
- Files changed and why
- Build/test verification result
- Any remaining blockers
`;
}

// ── Core Execution ──────────────────────────────────────────────────

export interface ExecutionResult {
  success: boolean;
  hitMaxTurns: boolean;
  status: 'review' | 'blocked' | 'error';
  summary: string;
  branchName?: string;
}

/** Execute a new task end-to-end. Called by the orchestrator. */
export async function executeTask(task: Task, sessionId: string): Promise<ExecutionResult> {
  log('info', `小工 starting task #${task.id}: ${task.title}`);

  // 1. Log start in agent_discussions
  logDiscussion('engineer', sessionId, 'execution', `開始執行 Task #${task.id}: ${task.title}`, {
    taskId: task.id,
  });

  // 2. Claim task (silent — progress is recorded on the board, boss only sees the morning brief)
  await updateTask(task.id, { status: 'in_progress' });

  // 3. Create feature branch
  let branchName: string;
  try {
    branchName = await createFeatureBranch(task.id, task.title);
  } catch (e) {
    const msg = `Branch creation failed: ${String(e)}`;
    log('error', msg);
    await updateTask(task.id, { status: 'blocked', result_notes: msg });
    return { success: false, hitMaxTurns: false, status: 'error', summary: msg };
  }

  await addComment(task.id, '小工', 'branch', `Branch: ${branchName}`, { branch: branchName });
  await addComment(task.id, '小工', 'action', '🔧 小工自動執行開始');

  // 4. Fetch comments for context
  const comments = await apiFetch<{ comments: TaskComment[] }>(`/api/tasks/${task.id}/comments`).then(r => r.comments).catch(() => []);

  // 5. Run Claude Code CLI
  const prompt = buildTaskPrompt(task, branchName, comments);
  const result = await runClaudeCode(prompt);

  // Verify branch position (Claude Code may have switched)
  try {
    const currentBranch = await execGit('branch', '--show-current');
    if (currentBranch !== branchName) {
      log('warn', `Branch shifted to ${currentBranch}, switching back to ${branchName}`);
      await execGit('checkout', branchName).catch(() => {});
    }
  } catch {}

  // Record work output
  const outputTruncated = result.output.slice(0, 4000);
  await addComment(task.id, '小工', 'action', `🔧 工作紀錄:\n${outputTruncated}`);

  if (!result.success) {
    const msg = `Claude Code execution failed: ${result.output.slice(0, 500)}`;
    await updateTask(task.id, { status: 'blocked', result_notes: msg });
    logDiscussion('engineer', sessionId, 'execution', `Task #${task.id} 執行失敗: ${msg}`, { taskId: task.id });
    await execGit('checkout', 'main').catch(() => {});
    return { success: false, hitMaxTurns: false, status: 'error', summary: msg, branchName };
  }

  // 6. Check for blockers or max turns
  const outputLower = result.output.toLowerCase();
  const hasBlocker = (outputLower.includes('blocker') || outputLower.includes('blocked') || outputLower.includes('cannot resolve'))
    && !outputLower.includes('resolved the blocker') && !outputLower.includes('blocker resolved');
  const hasMaxTurns = outputLower.includes('max turns') || outputLower.includes('reached max');

  if (hasMaxTurns) {
    await commitChanges(branchName, task.id, `partial: ${task.title}`);
    await updateTask(task.id, {
      status: 'blocked',
      result_notes: 'Hit max turns — 需要: confirm progress and decide next steps',
    });
    logDiscussion('engineer', sessionId, 'execution', `Task #${task.id} hit max turns`, { taskId: task.id });
    await execGit('checkout', 'main').catch(() => {});
    return { success: false, hitMaxTurns: true, status: 'blocked', summary: 'Hit max turns', branchName };
  }

  if (hasBlocker) {
    await commitChanges(branchName, task.id, `partial: ${task.title}`);
    await updateTask(task.id, { status: 'blocked', result_notes: 'See comments for blocker details' });
    logDiscussion('engineer', sessionId, 'execution', `Task #${task.id} blocked: ${outputTruncated.slice(0, 200)}`, { taskId: task.id });
    await execGit('checkout', 'main').catch(() => {});
    return { success: false, hitMaxTurns: false, status: 'blocked', summary: 'Blocked — see comments', branchName };
  }

  // 7. Build verification (dev tasks only)
  if (task.category !== 'research') {
    const build = await runBuildVerification();
    await addComment(task.id, '小工', 'test', `Build ${build.success ? '✅ PASSED' : '❌ FAILED'}:\n${build.output.slice(-1500)}`);

    if (!build.success) {
      await commitChanges(branchName, task.id, `partial: ${task.title} (build failed)`);
      await updateTask(task.id, { status: 'blocked', result_notes: 'Build failed — see test comment' });
      logDiscussion('engineer', sessionId, 'execution', `Task #${task.id} build failed`, { taskId: task.id });
      await execGit('checkout', 'main').catch(() => {});
      return { success: false, hitMaxTurns: false, status: 'blocked', summary: 'Build failed', branchName };
    }
  }

  // 8. Commit changes
  await commitChanges(branchName, task.id, task.title);

  // 9. Save research output if applicable
  if (task.category === 'research') {
    const filepath = saveResearchFile(task.id, task.title, result.output);
    await addComment(task.id, '小工', 'action', `📄 Research saved: ${path.basename(filepath)}`);
  }

  // 10. Verify actual changes exist
  const changes = await verifyChanges(branchName);
  if (!changes.hasCommits && !changes.hasChanges) {
    log('warn', `Task #${task.id}: no actual changes detected`);
    await updateTask(task.id, { status: 'blocked', result_notes: 'No code changes detected — may need re-examination' });
    await addComment(task.id, '小工', 'action', '⚠️ 沒有偵測到 code 變更');
    logDiscussion('engineer', sessionId, 'execution', `Task #${task.id} no changes detected`, { taskId: task.id });
    await execGit('checkout', 'main').catch(() => {});
    return { success: false, hitMaxTurns: false, status: 'blocked', summary: 'No changes detected', branchName };
  }

  // 11. Move to review
  const summary = `Branch: ${branchName}\n${changes.summary}\n\n${result.output.slice(0, 500)}`;
  await updateTask(task.id, {
    status: 'review',
    completed_by: '小工',
    result_notes: summary.slice(0, 1000),
  });

  logDiscussion('engineer', sessionId, 'execution',
    `Task #${task.id} 完成，已移至 review。\nBranch: ${branchName}\n${changes.summary}`,
    { taskId: task.id },
  );

  // 12. Reflect and learn
  await reflectAndLearn('engineer', `Executed task #${task.id}: ${task.title}`, result.output.slice(0, 2000));

  await execGit('checkout', 'main').catch(() => {});
  return { success: true, hitMaxTurns: false, status: 'review', summary, branchName };
}

/** Resume a blocked task after user provides input. */
export async function resumeTask(
  task: Task,
  userReply: string,
  branchName: string,
  sessionId: string,
): Promise<ExecutionResult> {
  log('info', `小工 resuming task #${task.id}: ${task.title}`);

  logDiscussion('engineer', sessionId, 'execution',
    `恢復執行 Task #${task.id} — blocker 已由 user 回覆`,
    { taskId: task.id },
  );

  // Checkout branch (silent — recorded on the board, not pushed to the boss)
  await execGit('stash', '--include-untracked').catch(() => {});
  try {
    await execGit('checkout', branchName);
  } catch (e) {
    const msg = `Cannot checkout ${branchName}: ${String(e)}`;
    await updateTask(task.id, { status: 'blocked', result_notes: msg });
    return { success: false, hitMaxTurns: false, status: 'error', summary: msg };
  }

  // Fetch comments
  const comments = await apiFetch<{ comments: TaskComment[] }>(`/api/tasks/${task.id}/comments`).then(r => r.comments).catch(() => []);

  // Run Claude Code
  const prompt = buildResumePrompt(task, branchName, comments, userReply);
  const result = await runClaudeCode(prompt);

  const outputTruncated = result.output.slice(0, 4000);
  await addComment(task.id, '小工', 'action', `🔧 恢復工作紀錄:\n${outputTruncated}`);

  if (!result.success) {
    await updateTask(task.id, { status: 'blocked', result_notes: `Resume failed: ${result.output.slice(0, 500)}` });
    await execGit('checkout', 'main').catch(() => {});
    return { success: false, hitMaxTurns: false, status: 'error', summary: 'Resume execution failed', branchName };
  }

  // Check max turns
  const outputLower = result.output.toLowerCase();
  if (outputLower.includes('max turns') || outputLower.includes('reached max')) {
    await commitChanges(branchName, task.id, `resume partial: ${task.title}`);
    await updateTask(task.id, { status: 'blocked', result_notes: 'Hit max turns on resume' });
    await execGit('checkout', 'main').catch(() => {});
    return { success: false, hitMaxTurns: true, status: 'blocked', summary: 'Hit max turns on resume', branchName };
  }

  // Build verification (dev tasks only)
  if (task.category !== 'research') {
    const build = await runBuildVerification();
    await addComment(task.id, '小工', 'test', `Build ${build.success ? '✅ PASSED' : '❌ FAILED'}:\n${build.output.slice(-1500)}`);

    if (!build.success) {
      await commitChanges(branchName, task.id, `resume partial: ${task.title} (build failed)`);
      await updateTask(task.id, { status: 'blocked', result_notes: 'Build failed on resume' });
      await execGit('checkout', 'main').catch(() => {});
      return { success: false, hitMaxTurns: false, status: 'blocked', summary: 'Build failed on resume', branchName };
    }
  }

  // Commit, verify, move to review
  await commitChanges(branchName, task.id, `resume: ${task.title}`);

  if (task.category === 'research') {
    saveResearchFile(task.id, task.title, result.output);
  }

  const changes = await verifyChanges(branchName);
  if (!changes.hasCommits && !changes.hasChanges) {
    await updateTask(task.id, { status: 'blocked', result_notes: 'No changes after resume' });
    await execGit('checkout', 'main').catch(() => {});
    return { success: false, hitMaxTurns: false, status: 'blocked', summary: 'No changes after resume', branchName };
  }

  const summary = `Branch: ${branchName}\n${changes.summary}`;
  await updateTask(task.id, { status: 'review', completed_by: '小工', result_notes: summary.slice(0, 1000) });

  logDiscussion('engineer', sessionId, 'execution',
    `Task #${task.id} resume 完成，已移至 review。\n${changes.summary}`,
    { taskId: task.id },
  );

  await reflectAndLearn('engineer', `Resumed task #${task.id}: ${task.title}`, result.output.slice(0, 2000));

  await execGit('checkout', 'main').catch(() => {});
  return { success: true, hitMaxTurns: false, status: 'review', summary, branchName };
}

/**
 * Propose an improvement to 懶懶 (PM). Returns proposal ID.
 * Silent by design: the proposal flows into 懶懶's next evaluation (auto_do / ask_boss / reject),
 * so the boss is never pinged directly — only via the morning brief if 懶懶 escalates it.
 */
export async function proposeImprovement(
  sessionId: string,
  proposalType: 'bugfix' | 'optimization' | 'feature',
  title: string,
  description: string,
  priority?: string,
): Promise<number> {
  log('info', `小工 proposing to 懶懶: ${title}`);

  const proposalId = createProposal(sessionId, 'engineer', proposalType, title, description, priority);

  logDiscussion('engineer', sessionId, 'proposal', `提案給懶懶: ${title}\n${description}`, {});

  return proposalId;
}

// ── Standalone CLI Entry Point ──────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const taskIdArg = args.find(a => a.startsWith('--task-id'));
  const taskId = taskIdArg ? parseInt(args[args.indexOf(taskIdArg) + 1] || args[0]?.split('=')[1], 10) : null;

  if (!taskId) {
    console.log('Usage: npx tsx scripts/agents/engineer.ts --task-id <id>');
    console.log('  Executes a single task via Claude Code CLI.');
    process.exit(1);
  }

  // Fetch task
  const { task } = await apiFetch<{ task: Task }>(`/api/tasks/${taskId}`);
  if (!task) {
    console.error(`Task #${taskId} not found`);
    process.exit(1);
  }

  const sessionId = generateSessionId();
  log('info', `Standalone engineer run for task #${taskId}, session ${sessionId}`);

  const result = await executeTask(task, sessionId);
  log('info', `Result: ${JSON.stringify(result)}`);
}

// Only run main() when invoked directly
if (require.main === module) {
  main().catch(e => {
    log('error', 'Engineer agent failed', { error: String(e) });
    process.exit(1);
  });
}
