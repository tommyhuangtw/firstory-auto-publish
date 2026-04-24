/**
 * Memory Service — manages the tool knowledge base in SQLite.
 *
 * Handles tool upsert, history queries, recall statement generation,
 * and browsing queries for the dashboard UI.
 */

import { getDb } from '@/db';
import { getLLMService } from '@/services/llmService';
import { createChildLogger } from '@/lib/logger';
import type { ExtractedTool } from './toolExtractor';

const log = createChildLogger('memory:service');

const RECALL_MODEL = 'google/gemini-2.5-flash-lite';

// ── Types ──

export interface ToolRecord {
  id: number;
  canonical_name: string;
  aliases: string | null;
  category: string | null;
  first_episode: number | null;
  latest_episode: number | null;
  mention_count: number;
  evolving_summary: string | null;
}

export interface ToolMentionRecord {
  id: number;
  episode_number: number;
  tool_id: number;
  mention_type: string | null;
  context_snippet: string | null;
  created_at: string;
}

// ── Upsert ──

/**
 * Save extracted tools to DB. Updates existing tools, creates new ones.
 */
export function upsertTools(episodeNumber: number, tools: ExtractedTool[]): void {
  const db = getDb();

  const upsertTool = db.prepare(`
    INSERT INTO tools (canonical_name, aliases, category, first_episode, latest_episode, mention_count, evolving_summary)
    VALUES (?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(canonical_name) DO UPDATE SET
      aliases = CASE
        WHEN excluded.aliases IS NOT NULL AND excluded.aliases != '[]'
        THEN excluded.aliases
        ELSE tools.aliases
      END,
      latest_episode = excluded.latest_episode,
      mention_count = tools.mention_count + 1,
      evolving_summary = CASE
        WHEN excluded.evolving_summary IS NOT NULL AND excluded.evolving_summary != ''
        THEN tools.evolving_summary || ' | EP' || excluded.latest_episode || ': ' || excluded.evolving_summary
        ELSE tools.evolving_summary
      END
  `);

  const insertMention = db.prepare(`
    INSERT INTO episode_tool_mentions (episode_number, tool_id, mention_type, context_snippet)
    VALUES (?, ?, ?, ?)
  `);

  const getToolId = db.prepare('SELECT id FROM tools WHERE canonical_name = ?');

  const transaction = db.transaction(() => {
    for (const tool of tools) {
      upsertTool.run(
        tool.name,
        JSON.stringify(tool.aliases),
        tool.category,
        episodeNumber,
        episodeNumber,
        tool.contextSnippet
      );

      const row = getToolId.get(tool.name) as { id: number } | undefined;
      if (row) {
        insertMention.run(episodeNumber, row.id, tool.mentionType, tool.contextSnippet);
      }
    }
  });

  transaction();
  log.info({ episodeNumber, count: tools.length }, 'Tools upserted');
}

// ── Queries ──

/**
 * Get all tools with optional search/filter.
 */
export function getAllTools(options?: {
  search?: string;
  category?: string;
  sortBy?: 'mention_count' | 'latest_episode' | 'canonical_name';
  limit?: number;
}): ToolRecord[] {
  const db = getDb();
  const { search, category, sortBy = 'mention_count', limit = 100 } = options || {};

  let query = 'SELECT * FROM tools WHERE 1=1';
  const params: unknown[] = [];

  if (search) {
    query += ' AND (canonical_name LIKE ? OR aliases LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }

  query += ` ORDER BY ${sortBy} DESC LIMIT ?`;
  params.push(limit);

  return db.prepare(query).all(...params) as ToolRecord[];
}

/**
 * Get a single tool by canonical name.
 */
export function getToolByName(name: string): ToolRecord | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM tools WHERE canonical_name = ?').get(name) as ToolRecord | undefined;
}

/**
 * Get all mentions of a tool across episodes.
 */
export function getToolMentions(toolId: number): (ToolMentionRecord & { segment_type?: string })[] {
  const db = getDb();
  return db.prepare(`
    SELECT m.*, e.segment_type
    FROM episode_tool_mentions m
    LEFT JOIN episodes e ON e.episode_number = m.episode_number
    ORDER BY m.episode_number DESC
  `).all() as (ToolMentionRecord & { segment_type?: string })[];
}

/**
 * Get tools that were mentioned in previous episodes (for recall generation).
 * Returns tools that appear in the current extraction AND have past mentions.
 */
export function findReturningTools(
  currentEpisode: number,
  toolNames: string[]
): (ToolRecord & { pastMentionCount: number })[] {
  if (toolNames.length === 0) return [];

  const db = getDb();
  const placeholders = toolNames.map(() => '?').join(',');

  return db.prepare(`
    SELECT *, (mention_count - 1) as pastMentionCount
    FROM tools
    WHERE canonical_name IN (${placeholders})
      AND first_episode < ?
      AND mention_count > 1
    ORDER BY mention_count DESC
  `).all(...toolNames, currentEpisode) as (ToolRecord & { pastMentionCount: number })[];
}

// ── Recall Generation ──

/**
 * Generate recall statements for tools that appeared in previous episodes.
 * Example: "我們在第 280 集也聊過 ChatGPT，當時還是 GPT-4 版本"
 */
export async function generateRecallStatements(
  episodeNumber: number,
  toolNames: string[]
): Promise<string[]> {
  const returningTools = findReturningTools(episodeNumber, toolNames);

  if (returningTools.length === 0) {
    log.info('No returning tools found, skipping recall generation');
    return [];
  }

  const llm = getLLMService();

  const toolSummaries = returningTools.map((t) => {
    const summary = t.evolving_summary?.slice(0, 200) || '';
    return `- ${t.canonical_name}: 首次出現 EP${t.first_episode}，共出現 ${t.mention_count} 次。${summary}`;
  }).join('\n');

  const prompt = `你是一個 AI Podcast 主持人。以下工具在之前的集數已經介紹過。
請為每個工具生成一句自然的「回顧語句」，可以在新集數中提到。

工具列表：
${toolSummaries}

要求：
- 用台灣繁體中文，口語化
- 每句話要自然融入對話，像是順口提一下
- 包含之前出現的集數號碼
- 如果工具出現很多次，可以說「老朋友了」
- 最多 5 句

Return JSON: { "recalls": ["句子1", "句子2", ...] }`;

  const result = await llm.generateJSON<{ recalls: string[] }>(
    prompt,
    'recall_generation',
    {
      episodeNumber,
      preferredModel: RECALL_MODEL,
      maxTokens: 512,
      temperature: 0.7,
    }
  );

  if (!result.success || !result.data?.recalls) {
    log.warn('Recall generation failed');
    return [];
  }

  log.info({ count: result.data.recalls.length }, 'Recall statements generated');
  return result.data.recalls;
}

/**
 * Get distinct tool categories for filtering.
 */
export function getToolCategories(): string[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT DISTINCT category FROM tools WHERE category IS NOT NULL ORDER BY category'
  ).all() as { category: string }[];
  return rows.map((r) => r.category);
}
