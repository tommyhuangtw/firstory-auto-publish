#!/usr/bin/env npx tsx
/**
 * 懶懶 (PM Agent) — Orchestrator / Project Manager.
 *
 * Phase A: Review functionality
 * - Reviews 小工's completed work (branch diff + build results + task description)
 * - Decides: pass → move to review | fail → send back to 小工 with feedback
 * - Creates alerts for Tommy on review outcomes
 *
 * Phase B will add: proposal evaluation, task assignment, daily summary.
 *
 * Usage (standalone): cd dashboard && npx tsx scripts/agents/pm.ts --review-task <id>
 * Normally called by the orchestrator.
 */

import { execFile } from 'child_process';
import path from 'path';
import { getDb } from '@/db';

import {
  type AgentConfig,
  type Task,
  type TaskComment,
  log,
  generateSessionId,
  callClaude,
  extractJson,
  logDiscussion,
  createProposal,
  updateProposalDecision,
  createAlert,
  sendTelegram,
  apiFetch,
  updateTask,
  addComment,
  createTask,
  getTaskBoardState,
  buildAgentPrompt,
  getAgentMemory,
  reflectAndLearn,
} from './base';

// ── Constants ────────────────────────────────────────────────────────
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// ── Agent Config ─────────────────────────────────────────────────────
const PM_CONFIG: AgentConfig = {
  id: 'pm',
  name: '懶懶',
  role: 'PM / Orchestrator',
  systemPrompt: `你是懶懶，AI 懶人報的 PM / Orchestrator。

## 核心職責
- 統籌所有提案、決定優先順序
- Review 小工完成的工作（看 diff、build 結果、是否符合需求）
- 需要 Tommy input 時建立 Alert + 發 Telegram
- 明確可做的事項自動建 ticket

## 行為規範
1. **不寫 code、不做 research** — 你是統籌者，不是執行者
2. **用數據說話** — 決策要有根據，不是憑感覺
3. **Tommy 的時間最寶貴** — 只在真正需要時打擾他
4. **品質 > 速度** — 寧可多花時間 review，不要放過有問題的 code
5. **記錄決策原因** — 每個 approve/reject 都要附理由

## Review 標準
- [ ] Code 是否完成了 ticket 描述的需求？
- [ ] 有沒有多改了不該改的東西？
- [ ] Build 是否通過？
- [ ] 有沒有安全性問題？
- [ ] 改動量是否合理（不要為了小需求改太多）？

## 不做的事
- 不寫 code（那是小工的事）
- 不做 content strategy（那是小企的事）
- 不代替 Tommy 做重大決策`,
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

// ── Review Logic ────────────────────────────────────────────────────

export interface ReviewResult {
  verdict: 'approved' | 'needs_changes' | 'needs_tommy';
  reasoning: string;
  feedback?: string; // detailed feedback for 小工 if needs_changes
}

/** Get the diff of a branch compared to main */
async function getBranchDiff(branchName: string): Promise<string> {
  try {
    const diff = await execGit('diff', '--stat', `main..${branchName}`);
    const detailedDiff = await execGit('diff', `main..${branchName}`, '--', '*.ts', '*.tsx', '*.sql', '*.json');
    // Truncate to avoid blowing up context
    const truncated = detailedDiff.length > 8000
      ? detailedDiff.slice(0, 8000) + '\n\n... (truncated, full diff too large)'
      : detailedDiff;
    return `## File Summary\n${diff}\n\n## Detailed Changes\n${truncated}`;
  } catch (e) {
    return `Could not get diff: ${String(e)}`;
  }
}

/** Get commit log for a branch */
async function getBranchCommits(branchName: string): Promise<string> {
  try {
    return await execGit('log', '--oneline', `main..${branchName}`);
  } catch {
    return '(no commits)';
  }
}

/** Review a task that 小工 has completed. */
export async function reviewTask(task: Task, sessionId: string): Promise<ReviewResult> {
  log('info', `懶懶 reviewing task #${task.id}: ${task.title}`);

  logDiscussion('pm', sessionId, 'review', `開始 review Task #${task.id}: ${task.title}`, {
    taskId: task.id,
  });

  // 1. Extract branch name from task comments
  const { comments } = await apiFetch<{ comments: TaskComment[] }>(`/api/tasks/${task.id}/comments`).catch(() => ({ comments: [] as TaskComment[] }));

  const branchComment = comments.find(c => c.type === 'branch');
  const branchName = branchComment?.metadata
    ? JSON.parse(branchComment.metadata).branch
    : comments.find(c => c.content.startsWith('Branch:'))?.content.replace('Branch: ', '').trim();

  if (!branchName) {
    const result: ReviewResult = {
      verdict: 'needs_changes',
      reasoning: 'Cannot find branch name in task comments',
      feedback: 'Branch name not recorded — cannot review. Please re-execute.',
    };
    logDiscussion('pm', sessionId, 'review', `Task #${task.id} review failed: no branch name`, { taskId: task.id });
    return result;
  }

  // 2. Gather review materials
  const [diff, commits] = await Promise.all([
    getBranchDiff(branchName),
    getBranchCommits(branchName),
  ]);

  // 3. Find build test result
  const buildComment = [...comments].reverse().find(c => c.type === 'test' && c.content.includes('Build'));
  const buildResult = buildComment?.content || '(no build result found)';

  // 4. Gather 小工's work log
  const workLogs = comments
    .filter(c => c.author === '小工' && c.type === 'action')
    .map(c => c.content.slice(0, 500))
    .join('\n\n');

  // 5. Build review prompt
  const agentPrompt = await buildAgentPrompt(PM_CONFIG);

  const reviewPrompt = `## Review Request

### Task #${task.id}
**Title**: ${task.title}
**Category**: ${task.category}
**Priority**: ${task.priority}
**Description**: ${task.description || '(none)'}

### Branch: ${branchName}
**Commits**:
${commits}

### Code Changes (Diff)
${diff}

### Build Result
${buildResult}

### 小工's Work Log
${workLogs || '(no work log)'}

---

## Your Job
Review this work against the task description. Evaluate:
1. Does the code fulfill the requirements?
2. Are changes surgical (no unnecessary modifications)?
3. Did the build pass?
4. Any security concerns?
5. Is the change scope reasonable?

## Response Format (STRICT JSON)
Respond with ONLY a JSON object:
{
  "verdict": "approved" | "needs_changes" | "needs_tommy",
  "reasoning": "1-3 sentence explanation",
  "feedback": "specific feedback for 小工 if needs_changes, or question for Tommy if needs_tommy"
}

- "approved": code is ready for Tommy's final review
- "needs_changes": send back to 小工 with specific feedback
- "needs_tommy": requires Tommy's decision (architectural, product, or policy question)`;

  // 6. Call LLM for review verdict
  const response = await callClaude(agentPrompt, reviewPrompt, {
    maxTokens: 1024,
    temperature: 0.3,
  });

  // 7. Parse verdict
  let result: ReviewResult;
  try {
    const jsonStr = extractJson(response.content);
    if (!jsonStr) throw new Error('No JSON found');
    result = JSON.parse(jsonStr) as ReviewResult;
    // Validate
    if (!['approved', 'needs_changes', 'needs_tommy'].includes(result.verdict)) {
      throw new Error(`Invalid verdict: ${result.verdict}`);
    }
  } catch (e) {
    log('warn', `Failed to parse review response: ${String(e)}`, { raw: response.content.slice(0, 500) });
    // Default to needs_tommy if we can't parse
    result = {
      verdict: 'needs_tommy',
      reasoning: 'Could not auto-review — forwarding to Tommy for manual review',
      feedback: response.content.slice(0, 500),
    };
  }

  // 8. Act on verdict
  const verdictEmoji = { approved: '✅', needs_changes: '🔄', needs_tommy: '🔔' };

  logDiscussion('pm', sessionId, 'decision',
    `Task #${task.id} review: ${verdictEmoji[result.verdict]} ${result.verdict}\n${result.reasoning}`,
    { taskId: task.id, tokenUsage: response.tokenUsage, durationMs: response.durationMs },
  );

  await addComment(task.id, '懶懶', 'review',
    `${verdictEmoji[result.verdict]} 懶懶 Review: **${result.verdict}**\n\n${result.reasoning}${result.feedback ? `\n\n**Feedback**: ${result.feedback}` : ''}`,
  );

  if (result.verdict === 'approved') {
    // Keep in review status — Tommy does final approve
    await createAlert('pm', 'review_ready', `Task #${task.id} 通過 review`,
      `${task.title}\nBranch: ${branchName}\n${result.reasoning}`, 'normal', { taskId: task.id });
    await sendTelegram(`✅ 懶懶 approved Task #${task.id}: ${task.title}\nBranch: ${branchName}\n等待 Tommy 最終 review`);

  } else if (result.verdict === 'needs_changes') {
    // Send back to 小工
    await updateTask(task.id, {
      status: 'in_progress',
      result_notes: `懶懶 review: needs changes — ${result.feedback?.slice(0, 200)}`,
    });
    await sendTelegram(`🔄 懶懶 sent Task #${task.id} back to 小工: ${result.feedback?.slice(0, 200)}`);

  } else {
    // needs_tommy — escalate
    await createAlert('pm', 'needs_decision', `Task #${task.id} 需要 Tommy 決策`,
      `${task.title}\n\n${result.feedback || result.reasoning}`, 'high', { taskId: task.id });
  }

  // 9. Reflect
  await reflectAndLearn('pm',
    `Reviewed task #${task.id}: ${task.title}`,
    `Verdict: ${result.verdict}. Reasoning: ${result.reasoning}`,
  );

  return result;
}

// ── Proposal Evaluation ─────────────────────────────────────────────

export interface ProposalDecision {
  proposalId: number;
  decision: 'approved' | 'rejected' | 'needs_tommy' | 'deferred';
  reasoning: string;
  taskId?: number; // if approved and ticket created
}

/** Evaluate pending proposals from 小企 or 小工. */
export async function evaluateProposals(sessionId: string): Promise<ProposalDecision[]> {
  const db = getDb();
  const pending = db.prepare(`
    SELECT id, proposed_by, proposal_type, title, description, priority_suggestion, created_at
    FROM agent_proposals
    WHERE pm_decision IS NULL
    ORDER BY created_at ASC
  `).all() as Array<{
    id: number;
    proposed_by: string;
    proposal_type: string;
    title: string;
    description: string;
    priority_suggestion: string | null;
    created_at: string;
  }>;

  if (pending.length === 0) {
    log('info', 'No pending proposals to evaluate');
    return [];
  }

  log('info', `懶懶 evaluating ${pending.length} proposal(s)`);

  // Get context for evaluation
  const agentPrompt = await buildAgentPrompt(PM_CONFIG);
  let taskBoard: string;
  try {
    const board = await getTaskBoardState();
    taskBoard = `Todo: ${board.todo.length}, In Progress: ${board.in_progress.length}, Blocked: ${board.blocked.length}, Review: ${board.review.length}`;
  } catch {
    taskBoard = '(無法連線)';
  }

  const proposalList = pending.map((p, i) =>
    `### Proposal ${i + 1} (ID: ${p.id})
- **From**: ${p.proposed_by}
- **Type**: ${p.proposal_type}
- **Title**: ${p.title}
- **Priority Suggestion**: ${p.priority_suggestion || 'none'}
- **Description**: ${p.description}`
  ).join('\n\n');

  const userPrompt = `## 提案評估
Task Board 現況: ${taskBoard}

${proposalList}

## 評估標準
1. 會影響聽眾體驗的 > 內部流程優化
2. 有數據支持的 > 憑感覺的
3. 小改動大效果的 > 大工程小效果的
4. research 類通常可以直接 approve
5. infra 改動要謹慎
6. 已有太多 in_progress 時應 defer 新工作
7. 不要跟 task board 上已有的工作重複

## Response Format (STRICT JSON)
回傳 JSON array，每個 proposal 一個 decision:
[
  {
    "proposalId": <number>,
    "decision": "approved" | "rejected" | "needs_tommy" | "deferred",
    "reasoning": "1-2 sentence explanation in 繁體中文",
    "createTicket": true | false,
    "ticketPriority": "low" | "medium" | "high"
  }
]

- approved + createTicket=true: 自動建 ticket 讓小工執行
- approved + createTicket=false: 記錄但不急著做
- rejected: 不適合現在做（附理由）
- needs_tommy: 需要 Tommy 決定（建築、產品、方向性問題）
- deferred: 好主意但現在不是時候`;

  const response = await callClaude(agentPrompt, userPrompt, {
    maxTokens: 2048,
    temperature: 0.3,
  });

  // Parse decisions
  let rawDecisions: Array<{
    proposalId: number;
    decision: string;
    reasoning: string;
    createTicket?: boolean;
    ticketPriority?: string;
  }> = [];

  try {
    const jsonStr = extractJson(response.content);
    if (!jsonStr) throw new Error('No JSON found');
    rawDecisions = JSON.parse(jsonStr);
  } catch (e) {
    log('warn', `Failed to parse proposal decisions: ${String(e)}`);
    // Mark all as needs_tommy
    rawDecisions = pending.map(p => ({
      proposalId: p.id,
      decision: 'needs_tommy',
      reasoning: '無法自動評估，轉交 Tommy',
    }));
  }

  const decisions: ProposalDecision[] = [];

  for (const raw of rawDecisions) {
    const proposal = pending.find(p => p.id === raw.proposalId);
    if (!proposal) continue;

    const decision: ProposalDecision = {
      proposalId: raw.proposalId,
      decision: raw.decision as ProposalDecision['decision'],
      reasoning: raw.reasoning,
    };

    // Create ticket if approved
    if (raw.decision === 'approved' && raw.createTicket) {
      try {
        const taskId = await createTask(
          proposal.title,
          proposal.description,
          proposal.proposal_type === 'research' ? 'research' : proposal.proposal_type === 'content' ? 'content' : 'infra',
          raw.ticketPriority || proposal.priority_suggestion || 'medium',
          true, // auto_execute
          '懶懶',
        );
        decision.taskId = taskId;
        log('info', `Created ticket #${taskId} from proposal #${raw.proposalId}`);
      } catch (e) {
        log('warn', `Failed to create ticket for proposal #${raw.proposalId}: ${String(e)}`);
      }
    }

    // Update proposal in DB
    updateProposalDecision(raw.proposalId, raw.decision, raw.reasoning, decision.taskId);

    // Log discussion
    const emoji = { approved: '✅', rejected: '❌', needs_tommy: '🔔', deferred: '⏸️' };
    logDiscussion('pm', sessionId, 'decision',
      `提案 #${raw.proposalId} "${proposal.title}": ${emoji[raw.decision as keyof typeof emoji] || '?'} ${raw.decision}\n${raw.reasoning}${decision.taskId ? `\n→ Created ticket #${decision.taskId}` : ''}`,
      { tokenUsage: response.tokenUsage, durationMs: response.durationMs },
    );

    // Alert for needs_tommy
    if (raw.decision === 'needs_tommy') {
      await createAlert('pm', 'needs_decision', `提案需要 Tommy 決策: ${proposal.title}`,
        `${proposal.description}\n\n懶懶: ${raw.reasoning}`, 'high', { proposalId: raw.proposalId });
    }

    decisions.push(decision);
  }

  // Reflect
  await reflectAndLearn('pm',
    `Evaluated ${decisions.length} proposals`,
    decisions.map(d => `#${d.proposalId}: ${d.decision} — ${d.reasoning}`).join('\n'),
  );

  return decisions;
}

// ── Daily Summary ───────────────────────────────────────────────────

/** Generate a daily summary for Tommy via Telegram. */
export async function dailySummary(sessionId: string): Promise<string> {
  log('info', '懶懶 generating daily summary');

  let taskBoard: string;
  try {
    const board = await getTaskBoardState();
    taskBoard = `📋 Task Board:\n- Todo: ${board.todo.length}\n- In Progress: ${board.in_progress.length}\n- Blocked: ${board.blocked.length}\n- Review: ${board.review.length}`;
  } catch {
    taskBoard = '📋 Task Board: (無法連線)';
  }

  const db = getDb();

  // Today's proposals
  const todayProposals = db.prepare(`
    SELECT title, pm_decision FROM agent_proposals
    WHERE date(created_at) = date('now')
  `).all() as Array<{ title: string; pm_decision: string | null }>;

  // Today's discussions count
  const todayDiscussions = (db.prepare(`
    SELECT COUNT(*) as c FROM agent_discussions WHERE date(created_at) = date('now')
  `).get() as { c: number }).c;

  // Unresolved alerts
  const unresolved = (db.prepare(`
    SELECT COUNT(*) as c FROM alerts WHERE status = 'unread'
  `).get() as { c: number }).c;

  const proposalSummary = todayProposals.length > 0
    ? todayProposals.map(p => `  - ${p.pm_decision || '⏳'} ${p.title}`).join('\n')
    : '  (今天沒有新提案)';

  const summary = `📊 懶懶日報

${taskBoard}

📝 今日提案 (${todayProposals.length}):
${proposalSummary}

💬 今日 Agent 對話: ${todayDiscussions} 則
🔔 未處理 Alerts: ${unresolved} 則`;

  await sendTelegram(summary);

  logDiscussion('pm', sessionId, 'report', `日報已發送:\n${summary}`, {});

  return summary;
}

/** Review all tasks in 'review' status that were completed by 小工. */
export async function reviewPendingTasks(sessionId: string): Promise<ReviewResult[]> {
  const { tasks } = await apiFetch<{ tasks: Task[] }>('/api/tasks?status=review&limit=20');

  // Filter to tasks completed by 小工 (not yet reviewed by 懶懶)
  const toReview: Task[] = [];
  for (const task of tasks) {
    if (task.completed_by !== '小工') continue;

    // Check if 懶懶 already reviewed this
    const { comments } = await apiFetch<{ comments: TaskComment[] }>(`/api/tasks/${task.id}/comments`).catch(() => ({ comments: [] as TaskComment[] }));
    const alreadyReviewed = comments.some(c => c.author === '懶懶' && c.type === 'review');
    if (!alreadyReviewed) {
      toReview.push(task);
    }
  }

  if (toReview.length === 0) {
    log('info', 'No pending tasks to review');
    return [];
  }

  log('info', `Found ${toReview.length} task(s) to review`);
  const results: ReviewResult[] = [];

  for (const task of toReview) {
    try {
      const result = await reviewTask(task, sessionId);
      results.push(result);
    } catch (e) {
      log('error', `Review failed for task #${task.id}`, { error: String(e) });
      results.push({
        verdict: 'needs_tommy',
        reasoning: `Review errored: ${String(e)}`,
      });
    }
  }

  return results;
}

// ── Standalone CLI Entry Point ──────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const sessionId = generateSessionId();

  if (args.includes('--review-task')) {
    const taskId = parseInt(args[args.indexOf('--review-task') + 1], 10);
    if (!taskId) {
      console.error('Usage: --review-task <id>');
      process.exit(1);
    }
    const { task } = await apiFetch<{ task: Task }>(`/api/tasks/${taskId}`);
    if (!task) {
      console.error(`Task #${taskId} not found`);
      process.exit(1);
    }
    const result = await reviewTask(task, sessionId);
    console.log(JSON.stringify(result, null, 2));

  } else if (args.includes('--review-all')) {
    const results = await reviewPendingTasks(sessionId);
    console.log(`Reviewed ${results.length} task(s):`);
    results.forEach((r, i) => console.log(`  ${i + 1}. ${r.verdict}: ${r.reasoning}`));

  } else if (args.includes('--evaluate-proposals')) {
    const decisions = await evaluateProposals(sessionId);
    console.log(`Evaluated ${decisions.length} proposal(s):`);
    decisions.forEach((d, i) => console.log(`  ${i + 1}. #${d.proposalId}: ${d.decision} — ${d.reasoning}`));

  } else if (args.includes('--daily-summary')) {
    const summary = await dailySummary(sessionId);
    console.log(summary);

  } else {
    console.log('Usage:');
    console.log('  npx tsx scripts/agents/pm.ts --review-task <id>       Review a specific task');
    console.log('  npx tsx scripts/agents/pm.ts --review-all             Review all pending tasks');
    console.log('  npx tsx scripts/agents/pm.ts --evaluate-proposals     Evaluate pending proposals');
    console.log('  npx tsx scripts/agents/pm.ts --daily-summary          Generate daily summary');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(e => {
    log('error', 'PM agent failed', { error: String(e) });
    process.exit(1);
  });
}
