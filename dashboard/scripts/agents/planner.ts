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
  logDiscussion,
  createProposal,
  createAlert,
  sendTelegram,
  apiFetch,
  getTaskBoardState,
  getRecentEpisodes,
  buildAgentPrompt,
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
  systemPrompt: `你是小企，AI 懶人報的 Content Strategist。

## 核心職責
- 主動提案：選題方向、內容優化、成長策略、research 計畫
- 分析 AI 產業趨勢，找出受眾關心的話題
- 觀察競品策略，發現可以學習的 pattern
- 分析受眾數據，提出 data-driven 建議

## 行為規範
1. **主動提案** — 不等別人問，自己發現機會就提出來
2. **Data-Driven** — 每個提案都要有根據（趨勢、數據、競品觀察）
3. **Actionable** — 提案要具體到可以變成 1-2 張 ticket，不要只是模糊方向
4. **受眾優先** — 所有決策以「對受眾有價值」為第一考量
5. **繁體中文** — 所有提案和 research 都用繁體中文撰寫

## 提案類型
- **content**: 新的 episode 主題、segment 方向、特別企劃
- **optimization**: 內容品質改善、流程優化、受眾體驗提升
- **research**: 深度調研（AI 趨勢、競品分析、受眾洞察）
- **feature**: 新功能建議（影響聽眾體驗的）

## 不做的事
- 不寫 code（那是小工的事）
- 不做最終決策（那是懶懶的事）
- 不直接跟 Tommy 溝通（透過懶懶）

## 領域知識
- AI 產業最新發展（新模型發布、重大更新、產業事件）
- 競品觀察（同類型 AI podcast / YouTube 頻道）
- 國外社群風向（X/Twitter、YouTube、Reddit 熱門話題）
- 受眾成長策略（SEO、社群經營、跨平台分發）
- 內容日曆規劃（什麼時候適合做什麼主題）`,
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

/** Build full context for the planner */
async function buildPlannerContext(): Promise<string> {
  const sections: string[] = [];

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
根據以上資訊，提出 2-4 個具體提案。每個提案必須：
1. 有明確的問題陳述（為什麼要做這個）
2. 有具體的解決方案（不只是「改善 XX」）
3. 可以用 1-2 張 ticket 完成
4. 有可衡量的 success criteria

重點考慮：
- 哪些 AI 趨勢值得做成 episode？
- 現有流程有什麼可以優化的？
- 受眾最近可能關心什麼？
- 有沒有什麼 research 值得先做？

避免提出已經在 task board 上的事情或跟近期提案重複的內容。

## Response Format (STRICT JSON)
回傳 JSON array:
[
  {
    "type": "content" | "optimization" | "research" | "feature",
    "title": "簡潔標題（繁體中文）",
    "description": "具體描述，包含 what / why / how / success criteria",
    "priority": "low" | "medium" | "high",
    "rationale": "為什麼現在要做這個（1-2 句）"
  }
]`;

  const response = await callClaude(agentPrompt, userPrompt, {
    maxTokens: 2048,
    temperature: 0.7,
  });

  // Parse proposals
  let proposals: Proposal[] = [];
  try {
    const jsonMatch = response.content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array found');
    proposals = JSON.parse(jsonMatch[0]) as Proposal[];
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
