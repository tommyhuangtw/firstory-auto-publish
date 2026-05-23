/**
 * Digest Service — Episode-level memory for cross-episode narrative continuity.
 *
 * Two layers:
 *   Layer A: Episode Digests — LLM-compiled summaries with milestone detection
 *   Layer B: Theme Tracker — Recurring themes with LSM-tree compacted summaries
 *
 * Temporal decay: per-segment rolling windows (2-3 months) with milestone preservation.
 */

import { getDb } from '@/db';
import { getLLMService } from '@/services/llmService';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('memory:digest');

const DIGEST_MODEL = 'google/gemini-3.1-flash-lite-preview';
const MAX_THEME_SUMMARY_LENGTH = 500;
const THEME_COMPACTION_THRESHOLD = 3;

// ── Segment Memory Configuration ──

export interface SegmentMemoryConfig {
  ownWindowMonths: number;
  crossSegments: { type: string; limit: number }[];
  themeFilter?: string; // null = all themes
}

export const SEGMENT_MEMORY_CONFIG: Record<string, SegmentMemoryConfig> = {
  daily:     { ownWindowMonths: 2, crossSegments: [{ type: 'weekly', limit: 2 }, { type: 'quickchat', limit: 1 }] },
  weekly:    { ownWindowMonths: 2, crossSegments: [{ type: 'daily', limit: 5 }, { type: 'quickchat', limit: 1 }] },
  quickchat: { ownWindowMonths: 2, crossSegments: [{ type: 'daily', limit: 3 }, { type: 'weekly', limit: 1 }] },
  robot:     { ownWindowMonths: 2, crossSegments: [{ type: 'daily', limit: 2 }], themeFilter: 'Robotics' },
  sysdesign: { ownWindowMonths: 3, crossSegments: [], themeFilter: 'System Design' },
};

// ── Types ──

export interface EpisodeDigest {
  id: number;
  episode_id: number;
  segment_type: string;
  thesis: string;
  key_insights: string; // JSON array
  tools_covered: string; // JSON array
  open_threads: string; // JSON array
  digest_text: string;
  aired_date: string;
  is_milestone: number;
  milestone_label: string | null;
}

export interface ThemeRecord {
  id: number;
  theme_name: string;
  category: string | null;
  current_summary: string | null;
  summary_version: number;
  episode_count: number;
  first_episode_id: number | null;
  latest_episode_id: number | null;
  first_seen_date: string | null;
  latest_seen_date: string | null;
  is_evergreen: number;
}

// ── Layer A: Episode Digest Generation ──

interface DigestLLMResponse {
  thesis: string;
  key_insights: string[];
  tools_covered: string[];
  open_threads: string[];
  is_milestone: boolean;
  milestone_label: string | null;
}

/**
 * Generate and store an episode digest from the English script.
 * Called after tool extraction in the pipeline.
 */
export async function generateEpisodeDigest(
  episodeId: number,
  segmentType: string,
  scriptEn: string,
  airedDate?: string,
): Promise<EpisodeDigest | null> {
  if (!scriptEn || scriptEn.length < 100) {
    log.warn({ episodeId }, 'Script too short for digest generation');
    return null;
  }

  const db = getDb();
  const dateStr = airedDate || new Date().toISOString().slice(0, 10);

  // Skip if digest already exists for this episode
  const existing = db.prepare(
    'SELECT id FROM episode_digests WHERE episode_id = ?'
  ).get(episodeId) as { id: number } | undefined;
  if (existing) {
    log.info({ episodeId }, 'Digest already exists, skipping');
    return db.prepare('SELECT * FROM episode_digests WHERE episode_id = ?').get(episodeId) as EpisodeDigest;
  }

  const llm = getLLMService();
  const scriptChunk = scriptEn.slice(0, 6000);

  const prompt = `Analyze this podcast episode script and generate a structured digest.

Script:
${scriptChunk}

Return JSON with these fields:
- thesis: 1-2 sentence summary of the episode's core argument or main topic (max 200 chars)
- key_insights: Array of 3-5 key insights or takeaways (each max 100 chars)
- tools_covered: Array of AI tools/products/companies discussed (just names)
- open_threads: Array of 1-3 unresolved questions or emerging trends mentioned (each max 100 chars). These are threads future episodes might pick up.
- is_milestone: true ONLY if this episode covers a truly landmark event:
  * A major product LAUNCH (not an update) — e.g., "Claude Code first released", "GPT-3.0 announced"
  * A paradigm shift — e.g., "first open-source model beating GPT-4", "AI regulation law passed"
  * A major acquisition or shutdown — e.g., "Google acquires X", "major service shuts down"
  * An industry-defining moment — e.g., "AI passes bar exam", "1 billion users milestone"
  Most episodes are NOT milestones. Only mark true for genuinely historic events.
- milestone_label: If is_milestone is true, a short label (max 80 chars) like "Claude Code launched". null if not a milestone.

Return JSON: { "thesis": "...", "key_insights": [...], "tools_covered": [...], "open_threads": [...], "is_milestone": false, "milestone_label": null }`;

  const result = await llm.generateJSON<DigestLLMResponse>(
    prompt,
    'episode_digest',
    {
      episodeId,
      preferredModel: DIGEST_MODEL,
      maxTokens: 1024,
      temperature: 0.2,
    }
  );

  if (!result.success || !result.data) {
    log.error({ episodeId, error: result.error }, 'Digest generation failed');
    return null;
  }

  const d = result.data;
  const digestText = [
    d.thesis,
    `Key: ${d.key_insights.join('; ')}`,
    d.open_threads.length > 0 ? `Open: ${d.open_threads.join('; ')}` : '',
  ].filter(Boolean).join(' | ').slice(0, 400);

  const stmt = db.prepare(`
    INSERT INTO episode_digests (episode_id, segment_type, thesis, key_insights, tools_covered, open_threads, digest_text, aired_date, is_milestone, milestone_label)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    episodeId,
    segmentType,
    d.thesis.slice(0, 200),
    JSON.stringify(d.key_insights),
    JSON.stringify(d.tools_covered),
    JSON.stringify(d.open_threads),
    digestText,
    dateStr,
    d.is_milestone ? 1 : 0,
    d.milestone_label?.slice(0, 80) || null,
  );

  log.info(
    { episodeId, segmentType, isMilestone: d.is_milestone, milestone: d.milestone_label },
    'Episode digest generated',
  );

  return db.prepare('SELECT * FROM episode_digests WHERE episode_id = ?').get(episodeId) as EpisodeDigest;
}

// ── Layer B: Theme Extraction & Tracking ──

interface ThemeLLMResponse {
  themes: Array<{
    name: string;
    category: string;
    context: string; // how this episode relates to the theme
    relevance: number; // 0.0-1.0
  }>;
}

/**
 * Extract themes from the episode script, match against existing themes,
 * and upsert. Triggers compaction for themes with many mentions.
 */
export async function extractAndUpsertThemes(
  episodeId: number,
  scriptEn: string,
  airedDate?: string,
): Promise<void> {
  if (!scriptEn || scriptEn.length < 100) return;

  const db = getDb();
  const dateStr = airedDate || new Date().toISOString().slice(0, 10);

  // Get existing themes for matching
  const existingThemes = db.prepare(
    'SELECT theme_name, category FROM themes ORDER BY episode_count DESC LIMIT 50'
  ).all() as Array<{ theme_name: string; category: string | null }>;

  const existingList = existingThemes.length > 0
    ? `\n\nExisting themes (reuse these names when applicable, don't create duplicates):\n${existingThemes.map((t) => `- ${t.theme_name} (${t.category || 'uncategorized'})`).join('\n')}`
    : '';

  const llm = getLLMService();
  const scriptChunk = scriptEn.slice(0, 5000);

  const prompt = `Identify 2-5 recurring themes or topics in this podcast episode script. Themes should be broad enough to appear across multiple episodes (e.g., "AI Coding Assistants", "Open Source vs Closed AI", "AI Video Generation") — NOT specific tool names.
${existingList}

Script:
${scriptChunk}

For each theme, provide:
- name: Short theme name (2-5 words, title case). Reuse an existing theme name if it matches.
- category: One of: "AI Coding", "LLM Models", "AI Media", "Robotics", "System Design", "AI Business", "AI Ethics", "Developer Tools", "AI Research", "Other"
- context: 1 sentence describing how THIS episode relates to the theme (max 120 chars)
- relevance: 0.0-1.0 how central this theme is to the episode (1.0 = main topic, 0.3 = briefly mentioned)

Return JSON: { "themes": [{ "name": "...", "category": "...", "context": "...", "relevance": 0.8 }] }`;

  const result = await llm.generateJSON<ThemeLLMResponse>(
    prompt,
    'theme_extraction',
    {
      episodeId,
      preferredModel: DIGEST_MODEL,
      maxTokens: 1024,
      temperature: 0.2,
    }
  );

  if (!result.success || !result.data?.themes) {
    log.error({ episodeId, error: result.error }, 'Theme extraction failed');
    return;
  }

  const themes = result.data.themes.filter(
    (t) => t.name && t.name.length > 1 && t.category
  );

  const upsertTheme = db.prepare(`
    INSERT INTO themes (theme_name, category, current_summary, first_episode_id, latest_episode_id, first_seen_date, latest_seen_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(theme_name) DO UPDATE SET
      category = COALESCE(excluded.category, themes.category),
      episode_count = themes.episode_count + 1,
      latest_episode_id = excluded.latest_episode_id,
      latest_seen_date = excluded.latest_seen_date
  `);

  const insertEpisodeTheme = db.prepare(`
    INSERT OR IGNORE INTO episode_themes (episode_id, theme_id, relevance, context_snippet)
    VALUES (?, ?, ?, ?)
  `);

  const getThemeRow = db.prepare('SELECT id, episode_count, current_summary FROM themes WHERE theme_name = ?');

  const themesNeedingCompaction: Array<{ name: string; oldSummary: string; newContext: string }> = [];

  const transaction = db.transaction(() => {
    for (const theme of themes) {
      const existing = getThemeRow.get(theme.name) as { id: number; episode_count: number; current_summary: string | null } | undefined;

      upsertTheme.run(
        theme.name,
        theme.category,
        theme.context, // initial summary = first context snippet
        episodeId,
        episodeId,
        dateStr,
        dateStr,
      );

      const row = getThemeRow.get(theme.name) as { id: number; episode_count: number; current_summary: string | null } | undefined;
      if (row) {
        insertEpisodeTheme.run(episodeId, row.id, theme.relevance, theme.context);

        // Queue for compaction if threshold met
        if (existing && existing.episode_count >= THEME_COMPACTION_THRESHOLD && existing.current_summary) {
          themesNeedingCompaction.push({
            name: theme.name,
            oldSummary: existing.current_summary,
            newContext: theme.context,
          });
        }

        // Auto-promote to evergreen: > 6 months span AND > 8 episodes
        if (row.episode_count > 8) {
          const themeDetails = db.prepare('SELECT first_seen_date, latest_seen_date FROM themes WHERE id = ?').get(row.id) as { first_seen_date: string | null; latest_seen_date: string | null } | undefined;
          if (themeDetails?.first_seen_date && themeDetails?.latest_seen_date) {
            const spanDays = Math.floor(
              (new Date(themeDetails.latest_seen_date).getTime() - new Date(themeDetails.first_seen_date).getTime()) / 86400000
            );
            if (spanDays > 180) {
              db.prepare('UPDATE themes SET is_evergreen = 1 WHERE id = ? AND is_evergreen = 0').run(row.id);
              log.info({ theme: theme.name, spanDays, episodes: row.episode_count }, 'Theme auto-promoted to evergreen');
            }
          }
        }
      }
    }
  });

  transaction();
  log.info({ episodeId, count: themes.length }, 'Themes upserted');

  // Async compaction (outside transaction)
  for (const item of themesNeedingCompaction) {
    try {
      await compactThemeSummary(item.name, item.oldSummary, item.newContext);
    } catch (error) {
      log.warn({ theme: item.name, error: (error as Error).message }, 'Theme compaction failed');
    }
  }
}

/**
 * Compact a theme's summary — merge old + new into ≤500 chars.
 * Same LSM-tree pattern as tool summary compaction.
 */
async function compactThemeSummary(themeName: string, oldSummary: string, newContext: string): Promise<void> {
  const llm = getLLMService();

  const prompt = `Merge these two descriptions of the recurring podcast theme "${themeName}" into ONE concise narrative.

Previous summary: ${oldSummary}

New episode context: ${newContext}

Requirements:
- Maximum ${MAX_THEME_SUMMARY_LENGTH} characters
- Track the EVOLUTION: how has this theme developed over time?
- Keep: earliest context, key turning points, latest development
- Write as a narrative arc, not a list (e.g., "Started as X, evolved through Y, now Z")
- English, factual tone

Return JSON: { "summary": "..." }`;

  const result = await llm.generateJSON<{ summary: string }>(
    prompt,
    'theme_compaction',
    {
      preferredModel: DIGEST_MODEL,
      maxTokens: 384,
      temperature: 0.2,
    }
  );

  if (result.success && result.data?.summary) {
    const compacted = result.data.summary.slice(0, MAX_THEME_SUMMARY_LENGTH);
    const db = getDb();
    db.prepare(
      'UPDATE themes SET current_summary = ?, summary_version = summary_version + 1 WHERE theme_name = ?'
    ).run(compacted, themeName);

    log.info({ theme: themeName, length: compacted.length }, 'Theme summary compacted');
  }
}

// ── Context Building for Script Generation ──

/**
 * Build digest context: recent episode digests within the segment's memory window.
 */
export function buildDigestContext(segmentType: string): string {
  const config = SEGMENT_MEMORY_CONFIG[segmentType];
  if (!config) return '';

  const db = getDb();
  const parts: string[] = [];

  // Own segment digests within window
  const ownDigests = db.prepare(`
    SELECT d.thesis, d.open_threads, d.aired_date, e.episode_number, d.segment_type
    FROM episode_digests d
    JOIN episodes e ON e.id = d.episode_id
    WHERE d.segment_type = ?
      AND d.aired_date >= date('now', '-' || ? || ' months')
    ORDER BY d.aired_date DESC
    LIMIT 10
  `).all(segmentType, config.ownWindowMonths) as Array<{
    thesis: string; open_threads: string; aired_date: string; episode_number: number; segment_type: string;
  }>;

  if (ownDigests.length > 0) {
    for (const d of ownDigests) {
      let line = `[EP${d.episode_number}, ${d.aired_date}] ${d.thesis}`;
      try {
        const threads = JSON.parse(d.open_threads) as string[];
        if (threads.length > 0) {
          line += `\n  Open threads: ${threads.join('; ')}`;
        }
      } catch { /* ignore parse error */ }
      parts.push(line);
    }
  }

  // Cross-segment digests
  for (const cross of config.crossSegments) {
    const crossDigests = db.prepare(`
      SELECT d.thesis, d.aired_date, e.episode_number, d.segment_type
      FROM episode_digests d
      JOIN episodes e ON e.id = d.episode_id
      WHERE d.segment_type = ?
        AND d.aired_date >= date('now', '-' || ? || ' months')
      ORDER BY d.aired_date DESC
      LIMIT ?
    `).all(cross.type, config.ownWindowMonths, cross.limit) as Array<{
      thesis: string; aired_date: string; episode_number: number; segment_type: string;
    }>;

    for (const d of crossDigests) {
      parts.push(`[${d.segment_type} EP${d.episode_number}, ${d.aired_date}] ${d.thesis}`);
    }
  }

  if (parts.length === 0) return '';

  return `EPISODE CONTINUITY CONTEXT — Recent episodes your audience has heard:

${parts.join('\n\n')}

INSTRUCTIONS:
- Reference these themes naturally: "We've been tracking...", "As we discussed recently..."
- Build on open threads when relevant: "Remember the question about X? Well..."
- Do NOT reference episode numbers. Use natural temporal references ("last week", "a few episodes ago")
- Cross-pollinate across segments when relevant`;
}

/**
 * Build theme context: active themes within the segment's memory window.
 */
export function buildThemeContext(segmentType: string): string {
  const config = SEGMENT_MEMORY_CONFIG[segmentType];
  if (!config) return '';

  const db = getDb();

  let themeQuery = `
    SELECT t.theme_name, t.current_summary, t.episode_count, t.category, t.is_evergreen
    FROM themes t
    WHERE (
      t.latest_seen_date >= date('now', '-' || ? || ' months')
      OR t.is_evergreen = 1
    )
  `;
  const params: unknown[] = [config.ownWindowMonths];

  if (config.themeFilter) {
    themeQuery += ' AND t.category = ?';
    params.push(config.themeFilter);
  }

  themeQuery += ' ORDER BY t.episode_count DESC LIMIT 8';

  const themes = db.prepare(themeQuery).all(...params) as Array<{
    theme_name: string; current_summary: string | null; episode_count: number; category: string | null; is_evergreen: number;
  }>;

  if (themes.length === 0) return '';

  const lines = themes.map((t) => {
    let line = `- ${t.theme_name} (${t.episode_count} episodes${t.is_evergreen ? ', evergreen' : ''})`;
    if (t.current_summary) {
      line += `: ${t.current_summary}`;
    }
    return line;
  });

  return `RECURRING THEMES the audience has been following:

${lines.join('\n')}`;
}

/**
 * Build milestone context: historical landmarks across all time.
 */
export function buildMilestoneContext(): string {
  const db = getDb();

  const milestones = db.prepare(`
    SELECT milestone_label, aired_date
    FROM episode_digests
    WHERE is_milestone = 1
    ORDER BY aired_date ASC
  `).all() as Array<{ milestone_label: string; aired_date: string }>;

  if (milestones.length === 0) return '';

  const lines = milestones.map((m) => {
    const dateLabel = m.aired_date.slice(0, 7); // YYYY-MM
    return `- [${dateLabel}] ${m.milestone_label}`;
  });

  return `HISTORICAL MILESTONES (for audience perspective):

${lines.join('\n')}

Use these for historical perspective: "It's been X months since Y happened, and already..."`;
}
