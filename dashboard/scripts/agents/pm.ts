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
  updateProposalDecision,
  createAlert,
  sendTelegram,
  sendTelegramWithButtons,
  buildQuickActionUrl,
  apiFetch,
  updateTask,
  addComment,
  createTask,
  getTaskBoardState,
  buildAgentPrompt,
  getAgentSystemPrompt,
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
  systemPrompt: getAgentSystemPrompt('pm', "你是懶懶，AI 懶人報的營運長 (COO)。"),
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
  confidence: 'high' | 'medium' | 'low';
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
      confidence: 'low',
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
  "confidence": "high" | "medium" | "low",
  "reasoning": "1-3 sentence explanation",
  "feedback": "specific feedback for 小工 if needs_changes, or question for Tommy if needs_tommy"
}

Verdict:
- "approved": code is ready for Tommy's final review
- "needs_changes": send back to 小工 with specific feedback
- "needs_tommy": requires Tommy's decision (architectural, product, or policy question)

Confidence (how sure are you about this verdict):
- "high": clearly fulfills requirements, build passes, changes are surgical and scoped
- "medium": looks correct but has some ambiguity or edge cases
- "low": uncertain, complex changes, or borderline quality`;

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
    const parsed = JSON.parse(jsonStr);
    result = {
      ...parsed,
      confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low',
    } as ReviewResult;
    // Validate
    if (!['approved', 'needs_changes', 'needs_tommy'].includes(result.verdict)) {
      throw new Error(`Invalid verdict: ${result.verdict}`);
    }
  } catch (e) {
    log('warn', `Failed to parse review response: ${String(e)}`, { raw: response.content.slice(0, 500) });
    // Default to needs_tommy if we can't parse
    result = {
      verdict: 'needs_tommy',
      confidence: 'low',
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
    `${verdictEmoji[result.verdict]} 懶懶 Review: **${result.verdict}** (confidence: ${result.confidence})\n\n${result.reasoning}${result.feedback ? `\n\n**Feedback**: ${result.feedback}` : ''}`,
  );

  // NOTE: All boss-facing notifications are batched into the morning 老闆快報 (sendBossBrief).
  // Here we only update status + leave a trail on the board — NO immediate Telegram pings.
  if (result.verdict === 'approved') {
    const isResearch = task.category === 'research';
    const canAutoApprove = isResearch && result.confidence === 'high';

    if (canAutoApprove) {
      // Low-risk research + high confidence → 懶懶 自己拍板完成，不打擾老闆（快報 FYI 帶過）
      await updateTask(task.id, { status: 'done', completed_by: '懶懶' });
      await addComment(task.id, '懶懶', 'review',
        `懶懶自己拍板完成（research + 高信心，低風險）\n${result.reasoning}`);
      log('info', `Task #${task.id} auto-approved by 懶懶 (research + high confidence)`);
    } else {
      // 成品通過 review → 留在 review，等早上快報讓老闆決定要不要上線（已有 review comment 留痕）
      log('info', `Task #${task.id} approved by 懶懶 — queued for morning boss brief`);
    }

  } else if (result.verdict === 'needs_changes') {
    // 退回小工，靜默處理（board 已有 review comment 記錄 feedback）
    await updateTask(task.id, {
      status: 'in_progress',
      result_notes: `懶懶 review: needs changes — ${result.feedback?.slice(0, 200)}`,
    });

  } else {
    // needs_tommy — 懶懶 判斷不了，需要老闆方向。留在 review，由早上快報端上去（不即時 ping）。
    await createAlert('pm', 'needs_decision', `Task #${task.id} 需要老闆拍板`,
      `${task.title}\n\n${result.feedback || result.reasoning}`, 'normal', { taskId: task.id });
  }

  // 9. Reflect
  await reflectAndLearn('pm',
    `Reviewed task #${task.id}: ${task.title}`,
    `Verdict: ${result.verdict}. Reasoning: ${result.reasoning}`,
  );

  return result;
}

// ── Proposal Evaluation ─────────────────────────────────────────────

export interface BossDecision {
  question: string;
  options: Array<{ label: string; pros: string; cons: string }>;
  recommendation: string;
}

export interface ProposalDecision {
  proposalId: number;
  decision: 'auto_do' | 'ask_boss' | 'rejected' | 'deferred';
  reasoning: string;
  taskId?: number; // if a ticket was created (auto_do / ask_boss)
}

/** Map a proposal type to a valid task category. */
function proposalCategory(proposalType: string): string {
  switch (proposalType) {
    case 'research': return 'research';
    case 'content': return 'content';
    case 'feature': return 'infra';
    default: return 'ops'; // optimization / misc
  }
}

/** Map a proposer id to a valid comment author. */
function proposerAuthor(proposedBy: string): string {
  if (proposedBy === 'planner') return '小企';
  if (proposedBy === 'engineer') return '小工';
  return '懶懶';
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

## 你的角色
你是營運長，幫老闆守門。你的目標**不是放行越多越好，而是只放行「合理且很有潛力」的**，
其餘擋掉。放行的低風險項目你自己拍板讓小工做；高風險的整理成決策留給老闆。

## 先判斷「值不值得做」（門檻要高，寧缺勿濫）
- 小投入大影響 / 有 timing 的 > 例行小優化
- 會影響聽眾體驗或成長的 > 純內部流程
- 有數據或趨勢支撐的 > 憑感覺的
- 平庸、重複、低槓桿、已在 board 上的 → rejected / deferred

## 再判斷「風險」決定誰拍板
- **low（你自己拍板，直接做）**：可逆、不花錢、不碰對外發布、不改品牌方向。
  例：research / 調研、內容企劃選題、社群貼文草稿、UI 與內容品質優化。
- **high（要先問老闆）**：infra 架構、實際對外發布、要花錢、品牌定位 / 內容方向決定。

## Response Format (STRICT JSON)
回傳 JSON array，每個 proposal 一個 decision:
[
  {
    "proposalId": <number>,
    "decision": "auto_do" | "ask_boss" | "rejected" | "deferred",
    "risk": "low" | "high",
    "reasoning": "1-2 句繁體中文，說明為什麼這樣判斷",
    "ticketPriority": "low" | "medium" | "high",
    "bossDecision": {
      "question": "要問老闆的一句話決策（只有 ask_boss 才填）",
      "options": [ { "label": "選項", "pros": "好處", "cons": "代價/風險" } ],
      "recommendation": "你的建議與理由（一句話）"
    }
  }
]

- **auto_do**（低風險 + 值得做）：你自己拍板，自動建 ticket 讓小工立刻執行，不打擾老闆。
- **ask_boss**（高風險 / 需方向，但值得做）：建 ticket 但不執行，填好 bossDecision（選項 + pros/cons + 你的建議），留給早上快報讓老闆拍板。
- **rejected**：不值得做（附理由）。
- **deferred**：好主意但現在不是時候。
- ⚠️ bossDecision 只在 decision="ask_boss" 時才需要；其餘可省略或給 null。`;

  const response = await callClaude(agentPrompt, userPrompt, {
    maxTokens: 2048,
    temperature: 0.3,
  });

  // Parse decisions
  let rawDecisions: Array<{
    proposalId: number;
    decision: string;
    risk?: string;
    reasoning: string;
    ticketPriority?: string;
    bossDecision?: BossDecision | null;
  }> = [];

  try {
    const jsonStr = extractJson(response.content);
    if (!jsonStr) throw new Error('No JSON found');
    rawDecisions = JSON.parse(jsonStr);
  } catch (e) {
    log('warn', `Failed to parse proposal decisions: ${String(e)}`);
    // Can't evaluate → defer (don't spam the boss; he'll see nothing rather than noise)
    rawDecisions = pending.map(p => ({
      proposalId: p.id,
      decision: 'deferred',
      reasoning: '無法自動評估，暫緩',
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

    const isAutoDo = raw.decision === 'auto_do';
    const isAskBoss = raw.decision === 'ask_boss';

    // Create a ticket for auto_do (runs now) and ask_boss (waits for boss in the morning brief)
    if (isAutoDo || isAskBoss) {
      try {
        const taskId = await createTask(
          proposal.title,
          proposal.description,
          proposalCategory(proposal.proposal_type),
          raw.ticketPriority || proposal.priority_suggestion || 'medium',
          isAutoDo,   // auto_execute ON for low-risk auto_do; OFF for high-risk ask_boss
          '懶懶',
        );
        decision.taskId = taskId;

        // ── Mirror the agent discussion onto the board (so Tommy can drill in from the card) ──
        await addComment(taskId, proposerAuthor(proposal.proposed_by), 'discussion',
          `💡 ${proposal.proposed_by === 'planner' ? '小企' : proposal.proposed_by === 'engineer' ? '小工' : ''}提案：${proposal.title}\n\n${proposal.description}`);

        if (isAutoDo) {
          await addComment(taskId, '懶懶', 'discussion',
            `✅ 懶懶評估：低風險、值得做 → 自己拍板，交給小工執行（不打擾老闆）。\n理由：${raw.reasoning}`);
          log('info', `auto_do ticket #${taskId} from proposal #${raw.proposalId} (executing without boss approval)`);
        } else {
          // ask_boss: store the boss decision payload so the morning brief can render it
          const bd = raw.bossDecision;
          const optionsText = bd?.options?.length
            ? bd.options.map(o => `• ${o.label}\n   優點：${o.pros}\n   代價：${o.cons}`).join('\n')
            : '（無明確選項，需老闆裁示）';
          await addComment(taskId, '懶懶', 'discussion',
            `🤔 需要老闆拍板（高風險）\n問題：${bd?.question || proposal.title}\n${optionsText}\n\n懶懶建議：${bd?.recommendation || raw.reasoning}`,
            { bossDecision: bd || null, reasoning: raw.reasoning });
          log('info', `ask_boss ticket #${taskId} from proposal #${raw.proposalId} (queued for morning brief)`);
        }
      } catch (e) {
        log('warn', `Failed to create ticket for proposal #${raw.proposalId}: ${String(e)}`);
      }
    }

    // Update proposal in DB
    updateProposalDecision(raw.proposalId, raw.decision, raw.reasoning, decision.taskId);

    // Log discussion (session log + agent_discussions, linked to ticket if any)
    const emoji: Record<string, string> = { auto_do: '🟢', ask_boss: '🤔', rejected: '❌', deferred: '⏸️' };
    logDiscussion('pm', sessionId, 'decision',
      `提案 #${raw.proposalId} "${proposal.title}": ${emoji[raw.decision] || '?'} ${raw.decision}\n${raw.reasoning}${decision.taskId ? `\n→ ticket #${decision.taskId}` : ''}`,
      { taskId: decision.taskId, tokenUsage: response.tokenUsage, durationMs: response.durationMs },
    );

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

/**
 * 老闆快報 (Boss Brief) — the ONE daily Telegram report Tommy reads.
 * Decision-first: only surfaces what needs his call, framed for a 3-second decision.
 *   1. 需要你拍板：成品等上線 (review tasks) + 高風險待決 (ask_boss todo tasks)
 *   2. 團隊自己處理了：低風險自動完成的，標題一行帶過 (FYI, no decision)
 * Each decision item is its own message so it can carry approve/reject buttons.
 */
export async function sendBossBrief(sessionId: string): Promise<void> {
  // 1. Finished work awaiting 上線 (Tommy decides ship-or-not)
  const { tasks: reviewTasks } = await apiFetch<{ tasks: Task[] }>('/api/tasks?status=review&limit=20')
    .catch(() => ({ tasks: [] as Task[] }));

  // 2. High-risk proposals 懶懶 wants the boss to decide before doing
  const { tasks: todoTasks } = await apiFetch<{ tasks: Task[] }>('/api/tasks?status=todo&limit=50')
    .catch(() => ({ tasks: [] as Task[] }));
  const askBossTasks = todoTasks.filter(t => t.auto_execute === 0 && t.completed_by !== 'tommy');

  const decisionCount = reviewTasks.length + askBossTasks.length;

  // 3. FYI — what the team handled on its own today
  const db = getDb();
  const fyiDone = db.prepare(`
    SELECT id, title FROM tasks
    WHERE status = 'done' AND date(completed_at) = date('now')
    ORDER BY completed_at DESC LIMIT 8
  `).all() as Array<{ id: number; title: string }>;
  const inFlight = db.prepare(`
    SELECT COUNT(*) as c FROM tasks WHERE status = 'in_progress' AND auto_execute = 1
  `).get() as { c: number };

  const today = new Date();
  const dateStr = `${today.getMonth() + 1}/${today.getDate()}`;

  if (decisionCount === 0 && fyiDone.length === 0 && inFlight.c === 0) {
    log('info', 'Boss brief: nothing to report — skipping');
    return;
  }

  // ── iPhone push (parallel to Telegram) — only when something needs a decision ──
  if (decisionCount > 0) {
    await sendBossBriefPush(
      `☀️ 老闆快報 ${dateStr}`,
      `有 ${decisionCount} 件需要你拍板（${reviewTasks.length} 件等上線 / ${askBossTasks.length} 件高風險）`,
    );
  }

  // ── Header ──
  await sendTelegram(
    `☀️ <b>老闆快報 ${dateStr}</b>\n` +
    (decisionCount > 0
      ? `有 <b>${decisionCount}</b> 件需要你拍板，點按鈕就好 👇`
      : `今天沒有需要你拍板的事，以下是團隊自己處理的進度。`)
  );

  // ── Section 1a: 成品等上線 (review tasks) ──
  for (const task of reviewTasks) {
    const { comments } = await apiFetch<{ comments: TaskComment[] }>(`/api/tasks/${task.id}/comments`)
      .catch(() => ({ comments: [] as TaskComment[] }));

    const reviewComment = [...comments].reverse().find(c => c.author === '懶懶' && c.type === 'review');
    const confMatch = reviewComment?.content.match(/confidence: (high|medium|low)/);
    const confidence = confMatch ? confMatch[1] : '';
    const confEmoji = confidence === 'high' ? '🟢' : confidence === 'medium' ? '🟡' : confidence === 'low' ? '🔴' : '⚪';

    const lines: string[] = [];
    lines.push(`✅ <b>等你上線</b> · #${task.id} ${task.title}`);

    // What was done — one tight blurb
    const workSummary = task.result_notes
      || [...comments].reverse().find(c => c.type === 'action' && c.content.includes('工作紀錄'))?.content
      || '';
    if (workSummary) {
      const clean = workSummary
        .replace(/<[^>]+>/g, '').replace(/\*\*/g, '')
        .replace(/^Branch:.*\n?/m, '').replace(/^\d+ commit.*\n?/m, '')
        .trim().slice(0, 180);
      if (clean) lines.push(`做了什麼：${clean}`);
    }
    if (reviewComment) {
      const reasoning = reviewComment.content
        .replace(/<[^>]+>/g, '').replace(/\*\*/g, '')
        .replace(/^.*?(approved|needs_changes|needs_tommy).*?\n/i, '')
        .trim().slice(0, 160);
      if (reasoning) lines.push(`懶懶：${confEmoji} ${reasoning}`);
    }

    // Research report link if applicable
    if (task.category === 'research') {
      const publicUrl = process.env.DASHBOARD_PUBLIC_URL || '';
      if (publicUrl) {
        const knowledgeDoc = db.prepare(
          `SELECT filename FROM knowledge_docs WHERE filename LIKE ? ORDER BY id DESC LIMIT 1`
        ).get(`task-${task.id}-%`) as { filename: string } | undefined;
        if (knowledgeDoc) {
          lines.push(`📄 <a href="${publicUrl}/knowledge/${encodeURIComponent(knowledgeDoc.filename)}">看研究報告</a>`);
        }
      }
    }

    await sendDecisionMessage(task.id, lines.join('\n'), '✅ 上線+開PR', '❌ 不要');
  }

  // ── Section 1b: 高風險待決 (ask_boss tasks) ──
  for (const task of askBossTasks) {
    const { comments } = await apiFetch<{ comments: TaskComment[] }>(`/api/tasks/${task.id}/comments`)
      .catch(() => ({ comments: [] as TaskComment[] }));

    // Find the boss-decision discussion comment 懶懶 left
    const bdComment = [...comments].reverse().find(c => {
      if (c.author !== '懶懶' || c.type !== 'discussion') return false;
      try { return c.metadata ? 'bossDecision' in JSON.parse(c.metadata) : false; } catch { return false; }
    });

    const lines: string[] = [`🤔 <b>要不要做</b> · #${task.id} ${task.title}`];
    if (bdComment) {
      // The comment content is already human-readable (question + options pros/cons + recommendation)
      lines.push(bdComment.content.replace(/<[^>]+>/g, '').replace(/\*\*/g, '').replace(/^🤔[^\n]*\n/, '').trim().slice(0, 500));
    } else if (task.description) {
      lines.push(task.description.replace(/<[^>]+>/g, '').slice(0, 300));
    }

    await sendDecisionMessage(task.id, lines.join('\n'), '✅ 批准執行', '❌ 不做');
  }

  // ── Section 2: FYI — 團隊自己處理了 ──
  if (fyiDone.length > 0 || inFlight.c > 0) {
    const fyiLines: string[] = [`\n🤖 <b>團隊自己處理了</b>`];
    for (const t of fyiDone) fyiLines.push(`• #${t.id} ${t.title}`);
    if (inFlight.c > 0) fyiLines.push(`• （還有 ${inFlight.c} 件低風險的小工正在做）`);
    fyiLines.push(`\n詳情都在 board，點 ticket 看完整討論。`);
    await sendTelegram(fyiLines.join('\n'));
  }

  logDiscussion('pm', sessionId, 'report',
    `老闆快報已發送：${decisionCount} 件待拍板（${reviewTasks.length} 上線 / ${askBossTasks.length} 高風險）, ${fyiDone.length} 件自動完成`, {});
}

/**
 * Fire an iPhone push for the 老闆快報 (parallel to Telegram). Best-effort:
 * posts to the dashboard's internal push endpoint; silently no-ops if push
 * isn't configured or the server is unreachable.
 */
async function sendBossBriefPush(title: string, body: string): Promise<void> {
  const baseUrl = process.env.DASHBOARD_URL || 'http://localhost:3000';
  try {
    await fetch(`${baseUrl}/api/push/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-push-secret': process.env.PUSH_INTERNAL_SECRET || '',
      },
      body: JSON.stringify({ title, body, url: '/tasks', tag: 'boss-brief' }),
    });
  } catch (err) {
    log('warn', `Boss brief push failed (non-fatal): ${(err as Error).message}`);
  }
}

/**
 * Send one decision item with approve/reject buttons + a "comment first" option
 * (opens a small form where Tommy can attach guidance before deciding).
 * Falls back to plain text if no public URL is configured.
 */
async function sendDecisionMessage(taskId: number, msg: string, approveLabel: string, rejectLabel: string): Promise<void> {
  const approveUrl = buildQuickActionUrl(taskId, 'approve');
  const rejectUrl = buildQuickActionUrl(taskId, 'reject');
  const commentUrl = buildQuickActionUrl(taskId, 'comment');
  if (approveUrl && rejectUrl && commentUrl) {
    await sendTelegramWithButtons(msg, [
      [
        { text: approveLabel, url: approveUrl },
        { text: rejectLabel, url: rejectUrl },
      ],
      [
        { text: '💬 加註再決定', url: commentUrl },
      ],
    ]);
  } else {
    await sendTelegram(msg);
  }
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
        confidence: 'low',
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

  } else if (args.includes('--boss-brief')) {
    await sendBossBrief(sessionId);
    console.log('老闆快報 sent.');

  } else {
    console.log('Usage:');
    console.log('  npx tsx scripts/agents/pm.ts --review-task <id>       Review a specific task');
    console.log('  npx tsx scripts/agents/pm.ts --review-all             Review all pending tasks');
    console.log('  npx tsx scripts/agents/pm.ts --evaluate-proposals     Evaluate pending proposals');
    console.log('  npx tsx scripts/agents/pm.ts --daily-summary          Generate daily summary');
    console.log('  npx tsx scripts/agents/pm.ts --boss-brief             Send the morning 老闆快報');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(e => {
    log('error', 'PM agent failed', { error: String(e) });
    process.exit(1);
  });
}
