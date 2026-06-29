#!/usr/bin/env npx tsx
/**
 * 小企 (Planner Agent) — Content Strategist.
 *
 * Proactively proposes content ideas, optimization directions, and research plans.
 * Reads task board state, recent episodes, knowledge base, and uses AI trend awareness.
 * Outputs proposals to agent_proposals for 懶懶 to evaluate.
 *
 * Usage (standalone): cd dashboard && npx tsx scripts/agents/planner.ts [--propose | --research <topic>]
 * Normally called by the orchestrator.
 */

import { getDb } from '@/db';
import path from 'path';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { mkdirSync, writeFileSync } from 'fs';

import {
  type AgentConfig,
  type Task,
  log,
  generateSessionId,
  callClaude,
  extractJson,
  logDiscussion,
  createProposal,
  createAlert,
  sendTelegram,
  apiFetch,
  getTaskBoardState,
  getRecentEpisodes,
  buildAgentPrompt,
  getAgentSystemPrompt,
  getAgentMemory,
  reflectAndLearn,
} from './base';

// ── Constants ────────────────────────────────────────────────────────
const DASHBOARD_DIR = path.resolve(__dirname, '..');

// ── Agent Config ─────────────────────────────────────────────────────
const PLANNER_CONFIG: AgentConfig = {
  id: 'planner',
  name: '小企',
  role: 'Content Strategist',
  systemPrompt: getAgentSystemPrompt('planner', "你是小企，AI 懶人報的 Content Strategist。"),
};

// ── Data Gathering ──────────────────────────────────────────────────

/** Get recent knowledge base entries for context */
function getRecentKnowledge(limit: number = 10): string {
  const db = getDb();
  try {
    const docs = db.prepare(`
      SELECT title, summary, category, created_at
      FROM knowledge_docs
      ORDER BY created_at DESC LIMIT ?
    `).all(limit) as Array<{ title: string; summary: string; category: string; created_at: string }>;

    if (docs.length === 0) return '（尚無 knowledge base 資料）';
    return docs.map(d => `- [${d.category}] ${d.title}: ${d.summary?.slice(0, 150) || '(no summary)'}`).join('\n');
  } catch {
    return '（knowledge_docs table not available）';
  }
}

/** Get recent content summaries for context */
function getRecentSummaries(limit: number = 5): string {
  const db = getDb();
  try {
    const summaries = db.prepare(`
      SELECT title, source_type, insights, created_at
      FROM content_summaries
      ORDER BY created_at DESC LIMIT ?
    `).all(limit) as Array<{ title: string; source_type: string; insights: string; created_at: string }>;

    if (summaries.length === 0) return '（尚無 content summaries）';
    return summaries.map(s => `- [${s.source_type}] ${s.title}`).join('\n');
  } catch {
    return '（content_summaries table not available）';
  }
}

/** Get existing proposals to avoid duplication */
function getRecentProposals(limit: number = 20): string {
  const db = getDb();
  const proposals = db.prepare(`
    SELECT title, proposal_type, pm_decision, created_at
    FROM agent_proposals
    ORDER BY created_at DESC LIMIT ?
  `).all(limit) as Array<{ title: string; proposal_type: string; pm_decision: string | null; created_at: string }>;

  if (proposals.length === 0) return '（尚無提案紀錄）';
  return proposals.map(p =>
    `- [${p.proposal_type}] ${p.title} → ${p.pm_decision || 'pending'}`
  ).join('\n');
}

/** Get existing research files */
function getResearchFiles(): string {
  const dir = path.join(DASHBOARD_DIR, 'data', 'research');
  if (!existsSync(dir)) return '（尚無 research 檔案）';
  const files = readdirSync(dir).filter(f => f.endsWith('.md'));
  if (files.length === 0) return '（尚無 research 檔案）';
  return files.map(f => `- ${f}`).join('\n');
}

/** Load trend briefing file if available */
function getTrendBriefing(): string {
  const briefingPath = path.join(__dirname, 'trend-briefing.md');
  if (!existsSync(briefingPath)) return '';
  try {
    return readFileSync(briefingPath, 'utf-8');
  } catch {
    return '';
  }
}

/** Build full context for the planner */
async function buildPlannerContext(): Promise<string> {
  const sections: string[] = [];

  // Current date awareness
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  sections.push(`## 現在時間\n${year} 年 ${month} 月 — 所有提案必須基於此時間點，不要提出已過時的話題`);

  // Trend briefing
  const briefing = getTrendBriefing();
  if (briefing) {
    sections.push(briefing);
  }

  // Task board state
  try {
    const board = await getTaskBoardState();
    const todoTitles = board.todo.slice(0, 10).map(t => `  - [${t.priority}] ${t.title}`).join('\n');
    const inProgressTitles = board.in_progress.slice(0, 5).map(t => `  - ${t.title}`).join('\n');
    sections.push(`## Task Board\n- Todo (${board.todo.length}):\n${todoTitles || '  (none)'}\n- In Progress (${board.in_progress.length}):\n${inProgressTitles || '  (none)'}\n- Review: ${board.review.length}\n- Blocked: ${board.blocked.length}`);
  } catch {
    sections.push('## Task Board\n（無法連線）');
  }

  // Recent episodes
  try {
    const eps = await getRecentEpisodes(10);
    if (eps.length > 0) {
      const epList = eps.map(e =>
        `- EP${e.episode_number} [${e.segment_type}] ${e.selected_title || '(untitled)'} — ${e.status}`
      ).join('\n');
      sections.push(`## 近期 Episodes (最新 10 集)\n${epList}`);
    }
  } catch {}

  // Knowledge base
  sections.push(`## Knowledge Base\n${getRecentKnowledge()}`);

  // Content summaries
  sections.push(`## 近期 Content Summaries\n${getRecentSummaries()}`);

  // Existing proposals (avoid duplicates)
  sections.push(`## 近期提案紀錄（避免重複提案）\n${getRecentProposals()}`);

  // Research files
  sections.push(`## 已有 Research\n${getResearchFiles()}`);

  return sections.join('\n\n');
}

// ── Core Functions ──────────────────────────────────────────────────

export interface Proposal {
  type: 'content' | 'optimization' | 'research' | 'feature';
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  rationale: string;
}

/** Generate proposals based on current project state and trends. */
export async function generateProposals(sessionId: string): Promise<Proposal[]> {
  log('info', '小企 generating proposals');

  logDiscussion('planner', sessionId, 'report', '開始分析專案狀態，生成提案...', {});

  // Build full context
  const agentPrompt = await buildAgentPrompt(PLANNER_CONFIG);
  const context = await buildPlannerContext();

  const userPrompt = `## 目前狀態
${context}

## 你的任務
根據以上資訊，提出 **0-2 個**真正高槓桿的提案 — 寧缺勿濫。
**如果今天沒有真正值得做的事，就回傳空陣列 []。** 不要為了交差硬擠提案。

每個提案必須：
1. 有明確的問題陳述（為什麼值得做、不做會錯過什麼）
2. 有具體的解決方案（不只是「改善 XX」）
3. 說清楚**預期影響與衡量方式**（成長 / 受眾 / 營運上看得到的改變）
4. 可以用 1-2 張 ticket 完成

衡量「值不值得提」的標準（過不了就別提）：
- 小投入、大影響？還是大工程、小效果？
- 是現在正熱、有 timing 的機會，還是隨時都能做的例行優化？
- 對懶人報 / podcast / 社群的成長，有沒有實際幫助？

⚠️ 重要限制：
- 現在是 ${new Date().getFullYear()} 年 ${new Date().getMonth() + 1} 月，不要提出已過時的話題
- 避免提出已經在 task board 上的事情或跟近期提案重複的內容
- 如果上方有提供「趨勢簡報」，務必參考其中的方向和避免清單

## Response Format (STRICT JSON)
回傳 JSON array（可以是空陣列 []）：
[
  {
    "type": "content" | "optimization" | "research" | "feature",
    "title": "簡潔標題（繁體中文）",
    "description": "具體描述，包含 what / why / how / 預期影響與衡量方式",
    "priority": "low" | "medium" | "high",
    "rationale": "為什麼現在值得做、槓桿在哪（1-2 句）"
  }
]`;

  const response = await callClaude(agentPrompt, userPrompt, {
    maxTokens: 2048,
    temperature: 0.7,
  });

  // Parse proposals
  let proposals: Proposal[] = [];
  try {
    const jsonStr = extractJson(response.content);
    if (!jsonStr) throw new Error(`No JSON found in response: ${response.content.slice(0, 200)}`);
    proposals = JSON.parse(jsonStr) as Proposal[];
    if (!Array.isArray(proposals)) throw new Error('Not an array');
  } catch (e) {
    log('warn', `Failed to parse proposals: ${String(e)}`);
    logDiscussion('planner', sessionId, 'report', `提案生成失敗: ${String(e)}\nRaw: ${response.content.slice(0, 500)}`, {
      tokenUsage: response.tokenUsage,
      durationMs: response.durationMs,
    });
    return [];
  }

  // Save proposals to DB
  for (const p of proposals) {
    const proposalId = createProposal(sessionId, 'planner', p.type, p.title, p.description, p.priority);

    logDiscussion('planner', sessionId, 'proposal',
      `提案: ${p.title}\n類型: ${p.type} | 優先: ${p.priority}\n${p.description}\n理由: ${p.rationale}`,
      { tokenUsage: response.tokenUsage, durationMs: response.durationMs },
    );

    log('info', `小企 proposed: [${p.type}] ${p.title} (proposal #${proposalId})`);
  }

  logDiscussion('planner', sessionId, 'report',
    `共提出 ${proposals.length} 個提案`,
    { tokenUsage: response.tokenUsage, durationMs: response.durationMs },
  );

  // Reflect
  await reflectAndLearn('planner',
    `Generated ${proposals.length} proposals`,
    proposals.map(p => `[${p.type}] ${p.title}: ${p.rationale}`).join('\n'),
  );

  return proposals;
}

/** Conduct research on a specific topic and save to knowledge base. */
export async function conductResearch(sessionId: string, topic: string): Promise<string> {
  log('info', `小企 researching: ${topic}`);

  logDiscussion('planner', sessionId, 'report', `開始 research: ${topic}`, {});

  const agentPrompt = await buildAgentPrompt(PLANNER_CONFIG);

  const userPrompt = `## Research 任務
**主題**: ${topic}

## 要求
1. 一律使用繁體中文撰寫
2. 深入分析這個主題
3. 提供具體的 findings 和 recommendations
4. 結構清晰：背景 → 分析 → 發現 → 建議 → 下一步
5. 如果跟 AI 懶人報的內容方向有關，說明可以怎麼用

## 輸出格式
直接輸出完整的 research report（Markdown 格式）。`;

  const response = await callClaude(agentPrompt, userPrompt, {
    maxTokens: 4096,
    temperature: 0.5,
  });

  // Save research to file
  const dir = path.join(DASHBOARD_DIR, 'data', 'research');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const slug = topic
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  const filename = `planner-${slug}-${Date.now()}.md`;
  const filepath = path.join(dir, filename);
  writeFileSync(filepath, response.content, 'utf-8');

  logDiscussion('planner', sessionId, 'report',
    `Research 完成: ${topic}\n存檔: ${filename}\n摘要: ${response.content.slice(0, 300)}...`,
    { tokenUsage: response.tokenUsage, durationMs: response.durationMs },
  );

  // Reflect
  await reflectAndLearn('planner', `Researched: ${topic}`, response.content.slice(0, 2000));

  return response.content;
}

/** Check and propose — the main entry point for orchestrator. */
export async function checkAndPropose(sessionId: string): Promise<Proposal[]> {
  return generateProposals(sessionId);
}

// ── Standalone CLI Entry Point ──────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const sessionId = generateSessionId();

  if (args.includes('--propose')) {
    const proposals = await generateProposals(sessionId);
    console.log(`\n小企 generated ${proposals.length} proposal(s):`);
    proposals.forEach((p, i) => {
      console.log(`\n${i + 1}. [${p.type}/${p.priority}] ${p.title}`);
      console.log(`   ${p.description.slice(0, 200)}`);
      console.log(`   理由: ${p.rationale}`);
    });

  } else if (args.includes('--research')) {
    const topicIdx = args.indexOf('--research') + 1;
    const topic = args.slice(topicIdx).join(' ');
    if (!topic) {
      console.error('Usage: --research <topic>');
      process.exit(1);
    }
    const result = await conductResearch(sessionId, topic);
    console.log(result);

  } else {
    console.log('Usage:');
    console.log('  npx tsx scripts/agents/planner.ts --propose              Generate proposals');
    console.log('  npx tsx scripts/agents/planner.ts --research <topic>     Research a topic');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(e => {
    log('error', 'Planner agent failed', { error: String(e) });
    process.exit(1);
  });
}
