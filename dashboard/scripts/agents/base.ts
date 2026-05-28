/**
 * Agent Base Infrastructure — shared utilities for the multi-agent system.
 *
 * Provides: LLM calls, DB logging, memory management, Telegram notifications,
 * and prompt assembly for all agents (懶懶 PM, 小企 Planner, 小工 Engineer).
 */

// Allow self-signed certs for local dev server (https://localhost:3000)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { getDb } from '@/db';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';

// ── Constants ────────────────────────────────────────────────────────
const BASE_URL = process.env.DASHBOARD_URL || 'https://localhost:3000';
// Telegram Bot API credentials (read from ~/.hermes/.env if not in process.env)
function loadHermesEnv(): { botToken: string; chatId: string } {
  let botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  let chatId = process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_HOME_CHANNEL || '';
  if (!botToken || !chatId) {
    const envPath = path.join(process.env.HOME || '~', '.hermes', '.env');
    if (existsSync(envPath)) {
      const lines = readFileSync(envPath, 'utf-8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const eqIdx = trimmed.indexOf('=');
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (key === 'TELEGRAM_BOT_TOKEN' && !botToken) botToken = val;
        if ((key === 'TELEGRAM_HOME_CHANNEL' || key === 'TELEGRAM_CHAT_ID') && !chatId) chatId = val;
      }
    }
  }
  return { botToken, chatId };
}
const _telegramCreds = loadHermesEnv();
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DASHBOARD_DIR = path.resolve(__dirname, '..');

// ── Types ────────────────────────────────────────────────────────────
export interface AgentConfig {
  id: 'pm' | 'planner' | 'engineer';
  name: string;          // '懶懶' | '小企' | '小工'
  role: string;          // human-readable role description
  systemPrompt: string;  // static role definition + behavioral rules
}

export interface Task {
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

export interface TaskComment {
  id: number;
  task_id: number;
  author: string;
  type: string;
  content: string;
  metadata: string | null;
  created_at: string;
}

interface LLMResponse {
  content: string;
  tokenUsage: number;
  durationMs: number;
}

// ── Logging ──────────────────────────────────────────────────────────
export function log(level: string, msg: string, data?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  console.log(JSON.stringify({ ts, level, msg, ...data }));
}

// ── Session Management ───────────────────────────────────────────────
export function generateSessionId(): string {
  return randomUUID();
}

// ── LLM Call (via Claude Code CLI — uses Claude Max subscription) ─────
export async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  _options?: { model?: string; maxTokens?: number; temperature?: number }
): Promise<LLMResponse> {
  const start = Date.now();

  // Combine system + user prompt into a single prompt file
  // Claude CLI -p mode treats the entire input as the user message
  const tmpFile = path.join(DASHBOARD_DIR, 'data', `agent-prompt-${Date.now()}.txt`);
  const combined = `<instructions>\n${systemPrompt}\n</instructions>\n\n${userPrompt}`;
  writeFileSync(tmpFile, combined, 'utf-8');

  try {
    const output = execSync(
      `cat "${tmpFile}" | claude -p --output-format text --max-turns 1`,
      {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
        timeout: 180_000,  // 3 minutes
        env: {
          ...process.env,
          NODE_TLS_REJECT_UNAUTHORIZED: '0',
          CLAUDECODE: '',  // allow nested CLI invocation
        },
      }
    ).trim();

    return {
      content: output,
      tokenUsage: 0,  // CLI doesn't report token usage
      durationMs: Date.now() - start,
    };
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

// ── JSON Extraction (handles markdown code fences) ───────────────────
/** Extract JSON array or object from LLM response, stripping markdown fences */
export function extractJson(raw: string): string | null {
  let cleaned = raw;
  // Strip markdown code fences
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlockMatch) cleaned = codeBlockMatch[1];
  // Try array first, then object
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) return arrayMatch[0];
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) return objMatch[0];
  return null;
}

// ── DB Logging: agent_discussions ────────────────────────────────────
export function logDiscussion(
  agentId: string,
  sessionId: string,
  messageType: string,
  content: string,
  extra?: { taskId?: number; tokenUsage?: number; durationMs?: number }
): void {
  const db = getDb();
  const agentNames: Record<string, string> = { pm: '懶懶', planner: '小企', engineer: '小工' };

  db.prepare(`
    INSERT INTO agent_discussions (task_id, session_id, agent_id, agent_name, message_type, content, token_usage, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    extra?.taskId || null,
    sessionId,
    agentId,
    agentNames[agentId] || agentId,
    messageType,
    content,
    extra?.tokenUsage || null,
    extra?.durationMs || null,
  );
}

// ── DB Logging: agent_proposals ──────────────────────────────────────
export function createProposal(
  sessionId: string,
  proposedBy: string,
  proposalType: string,
  title: string,
  description: string,
  prioritySuggestion?: string
): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO agent_proposals (session_id, proposed_by, proposal_type, title, description, priority_suggestion)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sessionId, proposedBy, proposalType, title, description, prioritySuggestion || null);
  return Number(result.lastInsertRowid);
}

export function updateProposalDecision(
  proposalId: number,
  decision: string,
  reasoning: string,
  taskId?: number
): void {
  const db = getDb();
  db.prepare(`
    UPDATE agent_proposals SET pm_decision = ?, pm_reasoning = ?, task_id = ? WHERE id = ?
  `).run(decision, reasoning, taskId || null, proposalId);
}

// ── Alerts ───────────────────────────────────────────────────────────
export async function createAlert(
  sourceAgent: string,
  alertType: string,
  title: string,
  description: string,
  urgency: string = 'normal',
  related?: { taskId?: number; proposalId?: number }
): Promise<number> {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO alerts (source_agent, alert_type, title, description, urgency, related_task_id, related_proposal_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sourceAgent, alertType, title, description, urgency, related?.taskId || null, related?.proposalId || null);

  const alertId = Number(result.lastInsertRowid);

  // Also send Telegram for high/urgent alerts
  if (urgency === 'high' || urgency === 'urgent') {
    await sendTelegram(`🔔 <b>[${urgency.toUpperCase()}]</b> ${title}\n\n${description}`);
    db.prepare('UPDATE alerts SET telegram_sent = 1 WHERE id = ?').run(alertId);
  }

  return alertId;
}

// ── Telegram ─────────────────────────────────────────────────────────
export async function sendTelegram(message: string, _event?: string): Promise<void> {
  const { botToken, chatId } = _telegramCreds;
  if (!botToken || !chatId) {
    log('warn', 'Telegram credentials not found (TELEGRAM_BOT_TOKEN / TELEGRAM_HOME_CHANNEL)');
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      log('warn', `Telegram API error ${res.status}: ${body.slice(0, 200)}`);
    }
  } catch (e) {
    log('warn', `Failed to send Telegram: ${String(e)}`);
  }
}

// ── Task Board Helpers ───────────────────────────────────────────────
export async function apiFetch<T>(urlPath: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${init?.method || 'GET'} ${urlPath} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function getTaskBoardState(): Promise<{
  todo: Task[];
  in_progress: Task[];
  blocked: Task[];
  review: Task[];
}> {
  const [todo, inProgress, blocked, review] = await Promise.all([
    apiFetch<{ tasks: Task[] }>('/api/tasks?status=todo&limit=50').then(r => r.tasks),
    apiFetch<{ tasks: Task[] }>('/api/tasks?status=in_progress&limit=50').then(r => r.tasks),
    apiFetch<{ tasks: Task[] }>('/api/tasks?status=blocked&limit=50').then(r => r.tasks),
    apiFetch<{ tasks: Task[] }>('/api/tasks?status=review&limit=50').then(r => r.tasks),
  ]);
  return { todo, in_progress: inProgress, blocked, review };
}

export async function getRecentEpisodes(limit: number = 5): Promise<Array<{
  id: number;
  episode_number: number;
  segment_type: string;
  selected_title: string;
  status: string;
  created_at: string;
}>> {
  const db = getDb();
  return db.prepare(`
    SELECT id, episode_number, segment_type, selected_title, status, created_at
    FROM episodes ORDER BY id DESC LIMIT ?
  `).all(limit) as Array<{
    id: number;
    episode_number: number;
    segment_type: string;
    selected_title: string;
    status: string;
    created_at: string;
  }>;
}

const VALID_CATEGORIES = ['content', 'infra', 'social_media', 'youtube', 'ig', 'threads', 'research', 'ops', 'growth'];

export async function createTask(
  title: string,
  description: string,
  category: string,
  priority: string = 'medium',
  autoExecute: boolean = true,
  createdBy: string = 'agent'
): Promise<number> {
  // Ensure category is valid
  const safeCategory = VALID_CATEGORIES.includes(category) ? category : 'ops';
  const data = await apiFetch<{ id: number }>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title,
      description,
      category: safeCategory,
      priority,
      auto_execute: autoExecute ? 1 : 0,
      created_by: createdBy,
    }),
  });
  return data.id;
}

export async function updateTask(id: number, body: Record<string, unknown>): Promise<void> {
  await apiFetch(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function addComment(
  taskId: number,
  author: string,
  type: string,
  content: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await apiFetch(`/api/tasks/${taskId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ author, type, content, metadata }),
  });
}

// ── Memory System ────────────────────────────────────────────────────

/** Read Layer 1: Shared Memory — assembled from live data each run */
export async function buildSharedMemory(): Promise<string> {
  const sections: string[] = [];

  // 1. Project summary (from CLAUDE.md, truncated)
  const claudeMdPath = path.join(PROJECT_ROOT, 'CLAUDE.md');
  if (existsSync(claudeMdPath)) {
    const full = readFileSync(claudeMdPath, 'utf-8');
    // Extract just the overview + architecture sections (first ~2000 chars)
    const summary = full.slice(0, 2000);
    sections.push(`## 專案概覽\n${summary}`);
  }

  // 2. Brand voice (from hermes context)
  const brandPath = path.join(PROJECT_ROOT, 'hermes', 'context', 'brand-voice.md');
  if (existsSync(brandPath)) {
    const brand = readFileSync(brandPath, 'utf-8');
    sections.push(`## 品牌定位\n${brand.slice(0, 800)}`);
  }

  // 3. Task Board state
  try {
    const board = await getTaskBoardState();
    sections.push(`## Task Board 現況\n- Todo: ${board.todo.length} 張\n- In Progress: ${board.in_progress.length} 張\n- Blocked: ${board.blocked.length} 張\n- Review: ${board.review.length} 張`);
  } catch {
    sections.push('## Task Board 現況\n（無法連線 Dashboard）');
  }

  // 4. Recent episodes
  try {
    const eps = await getRecentEpisodes(5);
    if (eps.length > 0) {
      const epList = eps.map(e =>
        `- EP${e.episode_number} [${e.segment_type}] ${e.selected_title || '(untitled)'} — ${e.status}`
      ).join('\n');
      sections.push(`## 近期 Episodes\n${epList}`);
    }
  } catch { /* skip if DB not ready */ }

  // 5. Recent PM decisions
  const db = getDb();
  const recentDecisions = db.prepare(`
    SELECT title, pm_decision, pm_reasoning, created_at
    FROM agent_proposals
    WHERE pm_decision IS NOT NULL
    ORDER BY created_at DESC LIMIT 10
  `).all() as Array<{ title: string; pm_decision: string; pm_reasoning: string; created_at: string }>;

  if (recentDecisions.length > 0) {
    const decList = recentDecisions.map(d =>
      `- [${d.pm_decision}] ${d.title} — ${d.pm_reasoning || '(no reason)'}`
    ).join('\n');
    sections.push(`## 近期 PM 決策\n${decList}`);
  }

  // 6. Unresolved alerts
  const unresolvedAlerts = db.prepare(`
    SELECT title, urgency, source_agent, created_at
    FROM alerts WHERE status = 'unread' ORDER BY
      CASE urgency WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
      created_at DESC
    LIMIT 10
  `).all() as Array<{ title: string; urgency: string; source_agent: string; created_at: string }>;

  if (unresolvedAlerts.length > 0) {
    const alertList = unresolvedAlerts.map(a =>
      `- [${a.urgency}] ${a.title} (from ${a.source_agent})`
    ).join('\n');
    sections.push(`## 未處理 Alerts\n${alertList}`);
  }

  return sections.join('\n\n');
}

/** Read Layer 2: Agent Private Memory — from agent_memory table */
export function getAgentMemory(agentId: string, limit: number = 20): string {
  const db = getDb();
  const memories = db.prepare(`
    SELECT topic, memory_type, current_summary
    FROM agent_memory
    WHERE agent_id = ?
    ORDER BY last_updated DESC
    LIMIT ?
  `).all(agentId, limit) as Array<{ topic: string; memory_type: string; current_summary: string }>;

  if (memories.length === 0) return '（尚無記憶）';

  return memories.map(m => `- [${m.memory_type}:${m.topic}] ${m.current_summary}`).join('\n');
}

/** Update Layer 2: LSM-compact new lessons into agent memory */
export async function updateAgentMemory(
  agentId: string,
  lessons: Array<{ topic: string; memoryType: string; content: string }>
): Promise<void> {
  const db = getDb();

  for (const lesson of lessons) {
    const existing = db.prepare(
      'SELECT current_summary, summary_version FROM agent_memory WHERE agent_id = ? AND topic = ?'
    ).get(agentId, lesson.topic) as { current_summary: string; summary_version: number } | undefined;

    if (existing) {
      // LSM merge: old + new → compacted ≤500 chars
      const merged = await compactMemory(existing.current_summary, lesson.content);
      db.prepare(`
        UPDATE agent_memory
        SET current_summary = ?, summary_version = summary_version + 1, last_updated = datetime('now')
        WHERE agent_id = ? AND topic = ?
      `).run(merged, agentId, lesson.topic);
    } else {
      db.prepare(`
        INSERT INTO agent_memory (agent_id, memory_type, topic, current_summary)
        VALUES (?, ?, ?, ?)
      `).run(agentId, lesson.memoryType, lesson.topic, lesson.content.slice(0, 500));
    }
  }
}

/** LSM compaction: merge old summary + new info into ≤500 chars */
async function compactMemory(oldSummary: string, newInfo: string): Promise<string> {
  try {
    const result = await callClaude(
      'You are a memory compaction system. Merge the old summary with new information into a single concise summary (max 500 characters, Traditional Chinese preferred). Keep the most important and recent facts. Drop outdated or redundant info.',
      `Old summary:\n${oldSummary}\n\nNew information:\n${newInfo}`,
      { maxTokens: 256, temperature: 0.3 }
    );
    return result.content.slice(0, 500);
  } catch {
    // Fallback: just append and truncate
    return `${oldSummary} | ${newInfo}`.slice(0, 500);
  }
}

/** Post-execution reflection: extract lessons from agent's work */
export async function reflectAndLearn(
  agentId: string,
  workDescription: string,
  workResult: string
): Promise<void> {
  try {
    const result = await callClaude(
      `You are a reflection system for an AI agent. Analyze the work done and extract 0-3 lessons learned.
Return a JSON array of objects: [{"topic": "short key", "memoryType": "lesson|preference|pattern|context", "content": "what was learned"}]
Only include genuinely useful insights. Return [] if nothing notable.
Use Traditional Chinese for content.`,
      `Work description: ${workDescription}\n\nResult:\n${workResult.slice(0, 2000)}`,
      { maxTokens: 512, temperature: 0.3 }
    );

    // Parse JSON from response
    const jsonStr = extractJson(result.content);
    if (jsonStr) {
      const lessons = JSON.parse(jsonStr) as Array<{ topic: string; memoryType: string; content: string }>;
      if (Array.isArray(lessons) && lessons.length > 0) {
        await updateAgentMemory(agentId, lessons);
        log('info', `Agent ${agentId} learned ${lessons.length} lesson(s)`);
      }
    }
  } catch (e) {
    log('warn', `Reflection failed for agent ${agentId}`, { error: String(e) });
  }
}

// ── Prompt Assembly ──────────────────────────────────────────────────

/** Build the full system prompt for an agent, including all memory layers */
export async function buildAgentPrompt(
  config: AgentConfig,
  sessionContext?: string
): Promise<string> {
  const sharedMemory = await buildSharedMemory();
  const privateMemory = getAgentMemory(config.id);

  const parts = [
    `## 你是 ${config.name}（${config.role}）\n\n${config.systemPrompt}`,
    `## 專案共享記憶\n${sharedMemory}`,
    `## 你的個人記憶\n${privateMemory}`,
  ];

  if (sessionContext) {
    parts.push(`## 這輪的對話紀錄\n${sessionContext}`);
  }

  return parts.join('\n\n---\n\n');
}

// ── Session Context ──────────────────────────────────────────────────

/** Get all discussions in the current session */
export function getSessionDiscussions(sessionId: string): string {
  const db = getDb();
  const discussions = db.prepare(`
    SELECT agent_name, message_type, content, created_at
    FROM agent_discussions
    WHERE session_id = ?
    ORDER BY created_at ASC
  `).all(sessionId) as Array<{
    agent_name: string;
    message_type: string;
    content: string;
    created_at: string;
  }>;

  if (discussions.length === 0) return '（本輪尚無對話）';

  return discussions.map(d =>
    `[${d.agent_name}/${d.message_type}] ${d.content.slice(0, 500)}`
  ).join('\n\n');
}
