/**
 * Memory Service — Layer 2 of the three-layer memory system.
 *
 * Handles:
 *   - Tool upsert with family-aware canonical names
 *   - Summary compaction (LSM-tree inspired: fixed-size ≤300 char summaries)
 *   - Significance-scored contextual recall generation (delta-aware)
 *   - Dashboard browsing queries
 */

import { getDb } from '@/db';
import { getLLMService } from '@/services/llmService';
import { createChildLogger } from '@/lib/logger';
import type { ResolvedTool } from './toolExtractor';
import {
  buildDigestContext,
  buildThemeContext,
  buildMilestoneContext,
  SEGMENT_MEMORY_CONFIG,
} from './digestService';

const log = createChildLogger('memory:service');

const COMPACTION_MODEL = 'google/gemini-3.1-flash-lite-preview';
const COMPACTION_THRESHOLD = 3; // Trigger compaction after this many mentions
const MAX_SUMMARY_LENGTH = 300;

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
  current_summary: string | null;
  summary_version: number;
  latest_version_detail: string | null;
  family_id: number | null;
  first_seen_date: string | null;
  latest_seen_date: string | null;
}

export interface ToolMentionRecord {
  id: number;
  episode_number: number;
  tool_id: number;
  mention_type: string | null;
  context_snippet: string | null;
  significance: number;
  version_detail: string | null;
  aired_date: string | null;
  created_at: string;
}

// ── Upsert with Compaction ──

/**
 * Save resolved tools to DB with family-aware canonical names.
 * Triggers summary compaction for tools that have been seen many times.
 */
export async function upsertTools(episodeId: number, tools: ResolvedTool[], airedDate?: string): Promise<void> {
  const db = getDb();
  const dateStr = airedDate || new Date().toISOString().slice(0, 10);

  const upsertTool = db.prepare(`
    INSERT INTO tools (canonical_name, aliases, category, first_episode, latest_episode, mention_count, current_summary, latest_version_detail, family_id, first_seen_date, latest_seen_date)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_name) DO UPDATE SET
      aliases = CASE
        WHEN excluded.aliases IS NOT NULL AND excluded.aliases != '[]'
        THEN excluded.aliases
        ELSE tools.aliases
      END,
      category = COALESCE(excluded.category, tools.category),
      latest_episode = excluded.latest_episode,
      mention_count = tools.mention_count + 1,
      latest_version_detail = COALESCE(excluded.latest_version_detail, tools.latest_version_detail),
      latest_seen_date = excluded.latest_seen_date
  `);

  const insertMention = db.prepare(`
    INSERT INTO episode_tool_mentions (episode_number, episode_id, tool_id, mention_type, context_snippet, significance, version_detail, aired_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getToolRow = db.prepare('SELECT id, mention_count, current_summary, aliases FROM tools WHERE canonical_name = ?');
  const getFamilyId = db.prepare('SELECT id FROM tool_families WHERE family_name = ?');
  const getEpisodeNumber = db.prepare('SELECT episode_number FROM episodes WHERE id = ?');
  const epRow = getEpisodeNumber.get(episodeId) as { episode_number: number | null } | undefined;
  const episodeNumber = epRow?.episode_number ?? null;

  // Phase 1: Upsert all tools in a transaction
  const toolsNeedingCompaction: Array<{ name: string; oldSummary: string; newContext: string }> = [];

  const transaction = db.transaction(() => {
    for (const tool of tools) {
      // Look up family_id
      const familyRow = getFamilyId.get(tool.canonicalName) as { id: number } | undefined;
      const familyId = familyRow?.id || null;

      // Check existing record before upsert
      const existing = getToolRow.get(tool.canonicalName) as { id: number; mention_count: number; current_summary: string | null; aliases: string | null } | undefined;

      // Merge aliases: combine existing + new, deduplicate
      let mergedAliases = tool.aliases;
      if (existing?.aliases) {
        try {
          const oldAliases: string[] = JSON.parse(existing.aliases);
          const combined = new Set([...oldAliases, ...tool.aliases]);
          mergedAliases = [...combined];
        } catch { /* keep new aliases if parse fails */ }
      }

      upsertTool.run(
        tool.canonicalName,
        JSON.stringify(mergedAliases),
        tool.category,
        episodeNumber,
        episodeNumber,
        tool.contextSnippet,
        tool.versionDetail || null,
        familyId,
        dateStr,
        dateStr
      );

      // Insert mention record
      const row = getToolRow.get(tool.canonicalName) as { id: number; mention_count: number } | undefined;
      if (row) {
        insertMention.run(
          episodeNumber ?? 0,
          episodeId,
          row.id,
          tool.mentionType,
          tool.contextSnippet,
          tool.significanceScore,
          tool.versionDetail || null,
          dateStr
        );
      }

      // Queue for compaction if threshold met
      if (existing && existing.mention_count >= COMPACTION_THRESHOLD && existing.current_summary) {
        toolsNeedingCompaction.push({
          name: tool.canonicalName,
          oldSummary: existing.current_summary,
          newContext: tool.contextSnippet,
        });
      }
    }
  });

  transaction();
  log.info({ episodeId, count: tools.length }, 'Tools upserted');

  // Phase 2: Async summary compaction (outside transaction)
  for (const item of toolsNeedingCompaction) {
    try {
      await compactSummary(item.name, item.oldSummary, item.newContext);
    } catch (error) {
      log.warn({ tool: item.name, error: (error as Error).message }, 'Summary compaction failed');
    }
  }
}

/**
 * Compact a tool's summary using LLM — merge old + new into ≤300 chars.
 * Inspired by LSM-tree compaction: accumulate then merge to fixed size.
 */
async function compactSummary(toolName: string, oldSummary: string, newContext: string): Promise<void> {
  const llm = getLLMService();

  const prompt = `Merge these two summaries about the AI tool "${toolName}" into ONE concise paragraph.

Previous summary: ${oldSummary}

New information: ${newContext}

Requirements:
- Maximum ${MAX_SUMMARY_LENGTH} characters
- Keep: first appearance context, most significant capability, latest update
- Drop: redundant info, old version details superseded by newer ones
- Write in English, factual tone

Return JSON: { "summary": "..." }`;

  const result = await llm.generateJSON<{ summary: string }>(
    prompt,
    'summary_compaction',
    {
      preferredModel: COMPACTION_MODEL,
      maxTokens: 256,
      temperature: 0.2,
    }
  );

  if (result.success && result.data?.summary) {
    const compacted = result.data.summary.slice(0, MAX_SUMMARY_LENGTH);
    const db = getDb();
    db.prepare(
      'UPDATE tools SET current_summary = ?, summary_version = summary_version + 1 WHERE canonical_name = ?'
    ).run(compacted, toolName);

    log.info({ tool: toolName, length: compacted.length }, 'Summary compacted');
  }
}

// ── Memory Context for Script Generation ──

export interface MemoryContext {
  /** Context brief injected into script generation prompts */
  briefForScriptGen: string;
  /** Context brief injected into quality scoring prompts */
  briefForQualityCheck: string;
  /** List of well-known tool names (for quick reference) */
  knownToolNames: string[];
  /** Recent episode digests for narrative continuity */
  recentDigests: string;
  /** Active recurring theme summaries */
  activeThemes: string;
  /** Historical milestones (persist indefinitely) */
  historicalMilestones: string;
}

/**
 * Build memory context from video titles/transcripts by matching against known tools in DB.
 *
 * Called BEFORE script generation to provide the LLM with audience familiarity context.
 * Uses a lightweight DB scan (no LLM cost) — matches tool canonical names against video text.
 *
 * Now also includes episode digest context, theme context, and milestone context
 * for cross-episode narrative continuity.
 *
 * Temporal decay: tools not seen within the segment's memory window are excluded,
 * except "very well-known" tools (10+ mentions) which keep a minimal entry.
 */
export function buildMemoryContext(
  videoTexts: string[],
  episodeId: number,
  segmentType?: string
): MemoryContext {
  const db = getDb();
  const empty: MemoryContext = {
    briefForScriptGen: '', briefForQualityCheck: '', knownToolNames: [],
    recentDigests: '', activeThemes: '', historicalMilestones: '',
  };

  // Digest/theme/milestone context (statically imported — no circular dep exists)
  let recentDigests = '';
  let activeThemes = '';
  let historicalMilestones = '';
  if (segmentType) {
    try {
      recentDigests = buildDigestContext(segmentType);
      activeThemes = buildThemeContext(segmentType);
      historicalMilestones = buildMilestoneContext();
    } catch (err) {
      log.warn({ error: (err as Error).message }, 'Failed to load digest context');
    }
  }

  // Determine tool memory window (months) based on segment type
  const toolWindowMonths = segmentType && SEGMENT_MEMORY_CONFIG[segmentType]
    ? SEGMENT_MEMORY_CONFIG[segmentType].ownWindowMonths
    : 2; // default 2 months

  // Get all tracked tools from DB (lightweight — typically <200 rows)
  const allTools = db.prepare(
    'SELECT canonical_name, category, mention_count, latest_seen_date, current_summary, latest_version_detail FROM tools ORDER BY mention_count DESC'
  ).all() as Array<{
    canonical_name: string;
    category: string | null;
    mention_count: number;
    latest_seen_date: string | null;
    current_summary: string | null;
    latest_version_detail: string | null;
  }>;

  if (allTools.length === 0) {
    return { ...empty, recentDigests, activeThemes, historicalMilestones };
  }

  // Combine all video text for matching
  const combinedText = videoTexts.join(' ').toLowerCase();

  const today = new Date();
  const windowCutoffMs = toolWindowMonths * 30 * 86400000; // approximate months to ms

  // Find tools mentioned in today's videos, applying temporal decay
  const matchedTools = allTools.filter((tool) => {
    const name = tool.canonical_name.toLowerCase();
    if (!combinedText.includes(name)) return false;

    // Temporal decay: exclude tools outside the memory window
    // Exception: "very well-known" tools (10+ mentions) always included with minimal context
    if (tool.latest_seen_date) {
      const daysSinceLast = Math.floor((today.getTime() - new Date(tool.latest_seen_date).getTime()) / 86400000);
      if (daysSinceLast > toolWindowMonths * 30 && tool.mention_count < 10) {
        return false; // decayed — outside window and not very well-known
      }
    }

    return true;
  });

  if (matchedTools.length === 0) {
    return { ...empty, recentDigests, activeThemes, historicalMilestones };
  }

  log.info({ matched: matchedTools.length }, 'Memory context: tools matched from video text');

  // Build brief for script generation
  const toolBriefs = matchedTools.map((t) => {
    const daysSinceLast = t.latest_seen_date
      ? Math.floor((today.getTime() - new Date(t.latest_seen_date).getTime()) / 86400000)
      : 999;
    const familiarity = t.mention_count >= 10 ? 'very well-known' :
      t.mention_count >= 5 ? 'well-known' :
      t.mention_count >= 2 ? 'mentioned before' : 'new to audience';

    let brief = `- ${t.canonical_name} (${familiarity}, ${t.mention_count}x in past episodes)`;
    if (t.latest_version_detail) {
      brief += ` — last version discussed: ${t.latest_version_detail}`;
    }
    if (t.current_summary) {
      brief += ` — previous coverage: ${t.current_summary}`;
    }
    if (daysSinceLast > 30) {
      brief += ` [not mentioned for ${daysSinceLast} days — worth a brief refresher]`;
    }
    return brief;
  });

  const briefForScriptGen = `AUDIENCE MEMORY CONTEXT — The following tools/companies have been covered in previous episodes. Your audience already knows them.

${toolBriefs.join('\n')}

INSTRUCTIONS based on this context:
- For very well-known tools (5+ mentions): Do NOT explain what they are. Jump straight to what's NEW. Compare with previous versions or capabilities when relevant.
- For tools mentioned before: Brief context is fine, but don't explain from scratch.
- For tools not mentioned for 30+ days: A quick refresher is appropriate since the audience may have forgotten.
- When a tool ships a new version (a newer release supersedes an older one): Highlight what changed compared to the previous version. Only name a version if the source actually states it.
- NEVER say "we discussed this in episode X" or reference previous episodes by number.`;

  const briefForQualityCheck = `KNOWN TOOLS CHECK — These tools are well-known to the audience:
${matchedTools.filter((t) => t.mention_count >= 3).map((t) => `${t.canonical_name} (${t.mention_count}x mentioned)`).join(', ')}

SCORING RULE: Deduct points if the script explains these well-known tools as if the audience is hearing about them for the first time. The audience is experienced — they know what ChatGPT, Claude, Midjourney etc. are.`;

  return {
    briefForScriptGen,
    briefForQualityCheck,
    knownToolNames: matchedTools.map((t) => t.canonical_name),
    recentDigests,
    activeThemes,
    historicalMilestones,
  };
}

// ── Query Helpers ──

// ── Public Query Functions (for UI) ──

export function getAllTools(options?: {
  search?: string;
  category?: string;
  sortBy?: 'mention_count' | 'latest_seen_date' | 'canonical_name';
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

export function getToolByName(name: string): ToolRecord | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM tools WHERE canonical_name = ?').get(name) as ToolRecord | undefined;
}

export function getToolMentions(toolId: number): (ToolMentionRecord & { segment_type?: string })[] {
  const db = getDb();
  return db.prepare(`
    SELECT m.*, e.segment_type
    FROM episode_tool_mentions m
    LEFT JOIN episodes e ON e.id = m.episode_id OR (m.episode_id IS NULL AND e.episode_number = m.episode_number)
    WHERE m.tool_id = ?
    ORDER BY m.aired_date DESC, m.id DESC
  `).all(toolId) as (ToolMentionRecord & { segment_type?: string })[];
}

export function getToolCategories(): string[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT DISTINCT category FROM tools WHERE category IS NOT NULL ORDER BY category'
  ).all() as { category: string }[];
  return rows.map((r) => r.category);
}
