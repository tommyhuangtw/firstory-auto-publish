#!/usr/bin/env npx tsx
/**
 * Orchestrator — runs the full 3-agent loop.
 *
 * Replaces auto-task-executor as the main entry point for automated work.
 * Coordinates: 小企 (propose) → 懶懶 (evaluate + assign) → 小工 (execute) → 懶懶 (review)
 *
 * Triggered by cron (launchd) or manually.
 * Usage: cd dashboard && npx tsx scripts/agents/orchestrator.ts [--morning | --evening | --full]
 */

import { existsSync, writeFileSync, unlinkSync, readFileSync } from 'fs';
import { mkdirSync } from 'fs';
import path from 'path';

import { execFileSync } from 'child_process';
import {
  type Task,
  type TaskComment,
  log,
  generateSessionId,
  logDiscussion,
  sendTelegram,
  apiFetch,
  updateTask,
  getTaskBoardState,
  reflectAndLearn,
} from './base';

import { checkAndPropose } from './planner';
import { evaluateProposals, reviewPendingTasks, reviewTask, dailySummary } from './pm';
import { executeTask, resumeTask, type ExecutionResult } from './engineer';

// ── Constants ────────────────────────────────────────────────────────
const MAX_TASKS_PER_RUN = 3;
const DASHBOARD_DIR = path.resolve(__dirname, '..');
const LOCKFILE = path.join(DASHBOARD_DIR, 'data', 'orchestrator.lock');
const LOG_DIR = path.join(DASHBOARD_DIR, 'data', 'logs');

// ── Locking ─────────────────────────────────────────────────────────

function acquireLock(): boolean {
  if (existsSync(LOCKFILE)) {
    const content = readFileSync(LOCKFILE, 'utf-8').trim();
    const pid = parseInt(content, 10);
    // Check if the process is still running
    try {
      process.kill(pid, 0); // signal 0 = just check existence
      log('warn', `Orchestrator already running (PID ${pid})`);
      return false;
    } catch {
      log('warn', `Stale lockfile (PID ${pid} not running), removing`);
      unlinkSync(LOCKFILE);
    }
  }

  if (!existsSync(path.dirname(LOCKFILE))) {
    mkdirSync(path.dirname(LOCKFILE), { recursive: true });
  }
  writeFileSync(LOCKFILE, String(process.pid), 'utf-8');
  return true;
}

function releaseLock(): void {
  try { unlinkSync(LOCKFILE); } catch {}
}

// ── Health Check ────────────────────────────────────────────────────

async function healthCheck(): Promise<boolean> {
  try {
    await apiFetch<unknown>('/api/tasks?limit=1');
    return true;
  } catch {
    log('error', 'Dashboard not reachable');
    return false;
  }
}

// ── Task Sorting ────────────────────────────────────────────────────

function sortTasks(tasks: Task[]): Task[] {
  const categoryOrder = (c: string) => (c === 'research' ? 0 : 1);
  const priorityOrder = (p: string) => {
    switch (p) {
      case 'urgent': return 0;
      case 'high': return 1;
      case 'low': return 3;
      default: return 2; // medium
    }
  };
  return [...tasks].sort((a, b) => {
    const catDiff = categoryOrder(a.category) - categoryOrder(b.category);
    if (catDiff !== 0) return catDiff;
    const priDiff = priorityOrder(a.priority) - priorityOrder(b.priority);
    if (priDiff !== 0) return priDiff;
    return a.created_at.localeCompare(b.created_at);
  });
}

// ── Find Resumable Tasks ────────────────────────────────────────────

async function findResumableTasks(): Promise<Array<{ task: Task; userReply: string; branch: string }>> {
  const { tasks } = await apiFetch<{ tasks: Task[] }>('/api/tasks?status=in_progress&limit=20');
  const resumable: Array<{ task: Task; userReply: string; branch: string }> = [];

  for (const task of tasks) {
    if (!task.auto_execute) continue;
    if (!task.result_notes?.includes('BLOCKED:') && !task.result_notes?.includes('needs changes')) continue;

    const { comments } = await apiFetch<{ comments: TaskComment[] }>(`/api/tasks/${task.id}/comments`).catch(() => ({ comments: [] as TaskComment[] }));

    // Find last agent comment index
    const lastAgentIdx = comments.reduce((max, c, i) =>
      (c.author === '小工' || c.author === 'claude-code') ? i : max, -1);

    // Find user reply after that
    const userReplyComment = comments.slice(lastAgentIdx + 1).find(c => c.author === 'tommy');
    if (!userReplyComment) continue;

    // Find branch
    const branchComment = comments.find(c => c.type === 'branch');
    const branch = branchComment?.metadata
      ? JSON.parse(branchComment.metadata).branch
      : undefined;
    if (!branch) continue;

    resumable.push({ task, userReply: userReplyComment.content, branch });
  }

  return resumable;
}

// ── Run Modes ───────────────────────────────────────────────────────

/**
 * Morning run: 小企 proposes → 懶懶 evaluates → 小工 executes available tasks
 */
async function morningRun(sessionId: string): Promise<void> {
  log('info', '=== Morning Run: propose + evaluate + execute ===');
  logDiscussion('pm', sessionId, 'report', '🌅 Morning orchestrator run started', {});

  // Step 1: 小企 proposes
  log('info', 'Step 1: 小企 generating proposals...');
  try {
    const proposals = await checkAndPropose(sessionId);
    log('info', `小企 generated ${proposals.length} proposal(s)`);
  } catch (e) {
    log('error', `小企 proposal generation failed: ${String(e)}`);
  }

  // Step 2: 懶懶 evaluates proposals
  log('info', 'Step 2: 懶懶 evaluating proposals...');
  try {
    const decisions = await evaluateProposals(sessionId);
    log('info', `懶懶 evaluated ${decisions.length} proposal(s)`);
    const approved = decisions.filter(d => d.decision === 'approved' && d.taskId);
    if (approved.length > 0) {
      log('info', `Created ${approved.length} new ticket(s)`);
    }
  } catch (e) {
    log('error', `懶懶 proposal evaluation failed: ${String(e)}`);
  }

  // Step 3: 小工 executes tasks
  await executeAvailableTasks(sessionId);
}

/**
 * Evening run: 小工 executes remaining → 懶懶 reviews → daily summary
 */
async function eveningRun(sessionId: string): Promise<void> {
  log('info', '=== Evening Run: execute + review + summary ===');
  logDiscussion('pm', sessionId, 'report', '🌙 Evening orchestrator run started', {});

  // Step 1: 小工 executes any remaining tasks
  await executeAvailableTasks(sessionId);

  // Step 2: 懶懶 reviews completed work
  log('info', 'Step 2: 懶懶 reviewing completed work...');
  try {
    const reviews = await reviewPendingTasks(sessionId);
    log('info', `懶懶 reviewed ${reviews.length} task(s)`);
  } catch (e) {
    log('error', `懶懶 review failed: ${String(e)}`);
  }

  // Step 3: Daily summary
  log('info', 'Step 3: 懶懶 generating daily summary...');
  try {
    await dailySummary(sessionId);
    log('info', 'Daily summary sent');
  } catch (e) {
    log('error', `Daily summary failed: ${String(e)}`);
  }
}

/**
 * Full run: propose + evaluate + execute + review + summary
 */
async function fullRun(sessionId: string): Promise<void> {
  log('info', '=== Full Run: all steps ===');
  logDiscussion('pm', sessionId, 'report', '🔄 Full orchestrator run started', {});

  // Step 1: 小企 proposes
  log('info', 'Step 1: 小企 generating proposals...');
  try {
    const proposals = await checkAndPropose(sessionId);
    log('info', `小企 generated ${proposals.length} proposal(s)`);
  } catch (e) {
    log('error', `小企 proposal generation failed: ${String(e)}`);
  }

  // Step 2: 懶懶 evaluates proposals
  log('info', 'Step 2: 懶懶 evaluating proposals...');
  try {
    const decisions = await evaluateProposals(sessionId);
    log('info', `懶懶 evaluated ${decisions.length} proposal(s)`);
  } catch (e) {
    log('error', `懶懶 proposal evaluation failed: ${String(e)}`);
  }

  // Step 3: 小工 executes tasks
  await executeAvailableTasks(sessionId);

  // Step 4: 懶懶 reviews
  log('info', 'Step 4: 懶懶 reviewing completed work...');
  try {
    const reviews = await reviewPendingTasks(sessionId);
    log('info', `懶懶 reviewed ${reviews.length} task(s)`);
  } catch (e) {
    log('error', `懶懶 review failed: ${String(e)}`);
  }

  // Step 5: Daily summary
  log('info', 'Step 5: Daily summary...');
  try {
    await dailySummary(sessionId);
  } catch (e) {
    log('error', `Daily summary failed: ${String(e)}`);
  }
}

/**
 * Execute available tasks (resumable first, then new todos).
 * Shared logic used by morning, evening, and full runs.
 */
async function executeAvailableTasks(sessionId: string): Promise<void> {
  log('info', '小工 looking for tasks to execute...');

  let processed = 0;
  let stopEarly = false;

  // Resumable tasks first
  let resumable: Array<{ task: Task; userReply: string; branch: string }> = [];
  try {
    resumable = await findResumableTasks();
    if (resumable.length > 0) {
      log('info', `Found ${resumable.length} resumable task(s)`);
    }
  } catch (e) {
    log('warn', `Failed to find resumable tasks: ${String(e)}`);
  }

  for (const { task, userReply, branch } of resumable) {
    if (processed >= MAX_TASKS_PER_RUN || stopEarly) break;
    try {
      log('info', `小工 resuming task #${task.id}...`);
      const result = await resumeTask(task, userReply, branch, sessionId);
      processed++;
      if (result.hitMaxTurns) {
        log('info', `Task #${task.id} hit max turns — stopping early`);
        stopEarly = true;
      }
    } catch (e) {
      log('error', `Resume task #${task.id} failed: ${String(e)}`);
      try {
        await updateTask(task.id, { status: 'blocked', result_notes: `Orchestrator error: ${String(e)}` });
      } catch {}
    }
  }

  // New tasks
  if (processed < MAX_TASKS_PER_RUN && !stopEarly) {
    const { tasks: todoTasks } = await apiFetch<{ tasks: Task[] }>('/api/tasks?status=todo&limit=20');
    const autoTasks = todoTasks.filter(t => t.auto_execute);
    const sorted = sortTasks(autoTasks);

    if (sorted.length > 0) {
      log('info', `Found ${sorted.length} new task(s) to execute`);
    }

    for (const task of sorted) {
      if (processed >= MAX_TASKS_PER_RUN || stopEarly) {
        log('info', `Stopping: processed=${processed}, stopEarly=${stopEarly}`);
        break;
      }
      try {
        log('info', `小工 executing task #${task.id}: ${task.title}...`);
        const result = await executeTask(task, sessionId);
        processed++;
        if (result.hitMaxTurns) {
          log('info', `Task #${task.id} hit max turns — stopping early`);
          stopEarly = true;
        }
      } catch (e) {
        log('error', `Execute task #${task.id} failed: ${String(e)}`);
        try {
          await updateTask(task.id, { status: 'blocked', result_notes: `Orchestrator error: ${String(e)}` });
        } catch {}
      }
    }
  }

  log('info', `小工 processed ${processed} task(s) total`);
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const args = process.argv.slice(2);
  const mode = args.includes('--morning') ? 'morning'
    : args.includes('--evening') ? 'evening'
    : args.includes('--full') ? 'full'
    : args.includes('--execute-only') ? 'execute'
    : null;

  if (!mode) {
    console.log('Usage:');
    console.log('  npx tsx scripts/agents/orchestrator.ts --morning        Propose + evaluate + execute');
    console.log('  npx tsx scripts/agents/orchestrator.ts --evening        Execute + review + summary');
    console.log('  npx tsx scripts/agents/orchestrator.ts --full           All steps');
    console.log('  npx tsx scripts/agents/orchestrator.ts --execute-only   Just execute tasks');
    process.exit(1);
  }

  log('info', `=== Orchestrator started (mode: ${mode}) ===`);

  // Acquire lock
  if (!acquireLock()) {
    log('warn', 'Another orchestrator is already running, exiting');
    process.exit(0);
  }

  // Remember original branch so we can restore it when done
  const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
  let originalBranch: string | null = null;
  try {
    originalBranch = execFileSync('git', ['branch', '--show-current'], {
      cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 10_000,
    }).trim() || null;
    log('info', `Original branch: ${originalBranch}`);
  } catch {
    log('warn', 'Could not determine original branch');
  }

  try {
    // Health check
    if (!await healthCheck()) {
      log('error', 'Dashboard not reachable, aborting');
      process.exit(1);
    }

    const sessionId = generateSessionId();

    switch (mode) {
      case 'morning':
        await morningRun(sessionId);
        break;
      case 'evening':
        await eveningRun(sessionId);
        break;
      case 'full':
        await fullRun(sessionId);
        break;
      case 'execute':
        await executeAvailableTasks(sessionId);
        break;
    }

    log('info', `=== Orchestrator finished (mode: ${mode}) ===`);
  } finally {
    // Restore original branch
    if (originalBranch) {
      try {
        const currentBranch = execFileSync('git', ['branch', '--show-current'], {
          cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 10_000,
        }).trim();
        if (currentBranch !== originalBranch) {
          log('info', `Restoring branch from ${currentBranch} to ${originalBranch}`);
          execFileSync('git', ['checkout', originalBranch], {
            cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30_000,
          });
        }
      } catch (e) {
        log('warn', `Failed to restore branch to ${originalBranch}: ${String(e)}`);
      }
    }
    releaseLock();
  }
}

main().catch(e => {
  log('error', 'Orchestrator failed', { error: String(e) });
  releaseLock();
  process.exit(1);
});
