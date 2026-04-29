/**
 * Tool Extraction — Layer 1 of the three-layer memory system.
 *
 * Pipeline: LLM extraction → blocklist filter → family resolution → significance scoring.
 *
 * Uses a gazetteer approach for entity resolution (regex-based tool family matching)
 * and IDF-inspired significance scoring to prioritize high-value tool mentions.
 */

import { getDb } from '@/db';
import { getLLMService } from '@/services/llmService';
import { createChildLogger } from '@/lib/logger';
import { isBlocked, resolveCanonicalName } from './toolFamilies';

const log = createChildLogger('memory:extractor');

const EXTRACTION_MODEL = 'google/gemini-3.1-flash-lite-preview';

// ── Types ──

export interface ExtractedTool {
  name: string;
  category: string;
  aliases: string[];
  contextSnippet: string;
  mentionType: 'new' | 'update' | 'deep_dive' | 'brief';
  isStandaloneProduct: boolean; // LLM decides: true = distinct product, false = version of parent
}

export interface ResolvedTool extends ExtractedTool {
  canonicalName: string;      // resolved family name (e.g., "Claude")
  rawName: string;            // original LLM-extracted name (e.g., "Claude Opus 4.6")
  versionDetail: string;      // version info (e.g., "Opus 4.6")
  significanceScore: number;  // 0.0-1.0, rule-based
}

// ── Main Extraction Function ──

export async function extractToolsFromScript(
  scriptEn: string,
  episodeId: number
): Promise<ResolvedTool[]> {
  if (!scriptEn || scriptEn.length < 100) {
    log.warn('Script too short for tool extraction');
    return [];
  }

  const llm = getLLMService();
  const scriptChunk = scriptEn.slice(0, 8000);

  // Step 1: LLM extraction with hardened prompt
  const prompt = `Extract AI tools, companies, and their latest developments mentioned in this podcast script.

For each entity, provide:
- name: The canonical/official name (e.g., "ChatGPT" not "chat gpt", "OpenAI" not "open ai")
- category: One of: LLM, DevTool, Image, Audio, Video, Productivity, Automation, Search, Robotics, Company, Platform, Other
- aliases: Array of alternative names used in the script (empty array if none)
- contextSnippet: A 1-2 sentence summary of what the script says — focus on WHAT'S NEW (new release, update, partnership, funding, controversy)
- mentionType: "deep_dive" if discussed in detail (>2 paragraphs), "update" if discussing a new version/feature/announcement, "new" if introducing for the first time, "brief" if just mentioned in passing
- isStandaloneProduct: true if this is a distinct product with its own purpose/category (e.g., "Claude Code" is a CLI dev tool, separate from "Claude" the LLM chatbot). false if this is just a version/update of an existing product (e.g., "Claude 3.5 Sonnet" is a version of Claude, "GPT-4o" is a version of ChatGPT).

PRODUCT vs VERSION — use these examples to guide your judgment:
- "Claude Code" → isStandaloneProduct: true (CLI dev tool, different from Claude chatbot)
- "Claude Design" → isStandaloneProduct: true (design tool, different product line)
- "Claude Opus 4.6" → isStandaloneProduct: false (model version of Claude)
- "ChatGPT Search" → isStandaloneProduct: true (search product, not a chatbot version)
- "GPT-4o" → isStandaloneProduct: false (model version of ChatGPT)
- "Codex CLI" → isStandaloneProduct: true (coding agent, separate from ChatGPT)
- "GitHub Copilot" → isStandaloneProduct: true (not a version of GitHub)
- "Gemini 2.0 Flash" → isStandaloneProduct: false (model version of Gemini)

EXTRACT these types of entities:
1. AI/ML software products and services (ChatGPT, Midjourney, Cursor, n8n)
2. AI models with version info (GPT-4o, Claude 3.5 Sonnet, Gemini 2.0)
3. Developer tools for AI (LangChain, Hugging Face, Ollama, ComfyUI)
4. AI companies making news (OpenAI, Google, Anthropic, Meta, NVIDIA) — capture their latest moves, partnerships, releases, strategy shifts
5. AI platforms with significant updates (GitHub Copilot, Replit)

For companies: the contextSnippet should focus on WHAT HAPPENED (e.g., "OpenAI announced GPT-5 with native multimodal capabilities" NOT just "OpenAI is an AI company")

DO NOT extract:
- Individual people or creators (Sam Altman, Andrej Karpathy, Fireship)
- YouTube channels or media outlets
- Programming languages (Python, JavaScript, Rust)
- Generic concepts (AI, machine learning, neural network, open source, RAG)
- Non-AI hardware (Apple M4, Intel CPU)

Script:
${scriptChunk}

Return JSON: { "tools": [ { "name": "...", "category": "...", "aliases": [], "contextSnippet": "...", "mentionType": "...", "isStandaloneProduct": true/false } ] }

Maximum 12 entities. Focus on entities with actual news or developments discussed, not just name-dropped.`;

  const result = await llm.generateJSON<{ tools: ExtractedTool[] }>(
    prompt,
    'tool_extraction',
    {
      episodeId,
      preferredModel: EXTRACTION_MODEL,
      maxTokens: 2048,
      temperature: 0.2,
    }
  );

  if (!result.success || !result.data?.tools) {
    log.error({ error: result.error }, 'Tool extraction failed');
    return [];
  }

  const rawTools = result.data.tools.filter(
    (t) => t.name && t.name.length > 1 && t.category
  );

  log.info({ rawCount: rawTools.length }, 'Raw tools extracted');

  // Step 2: Post-processing pipeline
  const resolved = postProcess(rawTools, episodeId);

  log.info(
    { rawCount: rawTools.length, resolvedCount: resolved.length, episodeId },
    'Tools extracted and resolved'
  );

  return resolved;
}

// ── Post-Processing Pipeline ──

function postProcess(tools: ExtractedTool[], episodeId: number): ResolvedTool[] {
  const seen = new Set<string>();
  const resolved: ResolvedTool[] = [];

  for (const tool of tools) {
    // Step 2a: Blocklist filter (O(1))
    if (isBlocked(tool.name)) {
      log.debug({ name: tool.name }, 'Blocked by blocklist');
      continue;
    }

    // Step 2b: Family resolution — respect LLM's standalone product judgment
    const family = resolveCanonicalName(tool.name);

    let canonicalName: string;
    let versionDetail: string;

    if (tool.isStandaloneProduct) {
      // LLM says this is a distinct product (e.g., "Claude Code") → keep its own name
      canonicalName = tool.name;
      versionDetail = '';
    } else {
      // Version/update (e.g., "Claude Opus 4.6") → merge into family
      canonicalName = family?.familyName || tool.name;
      versionDetail = family?.versionDetail || '';
    }

    // Step 2c: Deduplicate by canonical name (keep highest mention type)
    if (seen.has(canonicalName.toLowerCase())) {
      log.debug({ raw: tool.name, canonical: canonicalName }, 'Deduplicated');
      continue;
    }
    seen.add(canonicalName.toLowerCase());

    // Step 2d: Compute significance score
    const significanceScore = computeSignificance(tool, canonicalName, episodeId);

    resolved.push({
      ...tool,
      canonicalName,
      rawName: tool.name,
      versionDetail,
      significanceScore,
      category: family?.category || tool.category,
    });
  }

  return resolved;
}

// ── Significance Scoring ──

/**
 * Compute significance score using four signals (IDF-inspired).
 *
 * Signal 1: Mention depth (40%) — deep_dive > update > new > brief
 * Signal 2: Recency decay (30%) — tools absent for many days get a boost
 * Signal 3: Inverse frequency (20%) — tools in every episode have low recall value
 * Signal 4: Version change (10%) — version updates are noteworthy
 */
function computeSignificance(
  tool: ExtractedTool,
  canonicalName: string,
  _currentEpisode: number
): number {
  let score = 0;

  // Signal 1: Mention depth
  const depthWeight: Record<string, number> = {
    deep_dive: 1.0,
    update: 0.8,
    new: 0.7,
    brief: 0.2,
  };
  score += (depthWeight[tool.mentionType] ?? 0.3) * 0.4;

  // Signals 2-4 require DB lookup
  try {
    const db = getDb();
    const record = db.prepare(
      'SELECT latest_seen_date, mention_count, latest_version_detail FROM tools WHERE canonical_name = ?'
    ).get(canonicalName) as { latest_seen_date: string | null; mention_count: number; latest_version_detail: string } | undefined;

    if (record) {
      // Signal 2: Recency decay (date-based)
      const daysSinceLast = record.latest_seen_date
        ? Math.floor((Date.now() - new Date(record.latest_seen_date).getTime()) / 86400000)
        : 999;
      if (daysSinceLast > 60) score += 0.3 * 0.3;
      else if (daysSinceLast > 30) score += 0.2 * 0.3;
      else if (daysSinceLast > 7) score += 0.1 * 0.3;
      // < 7 days ago: no recency boost

      // Signal 3: Inverse frequency (IDF-inspired)
      // Use total pipeline runs as corpus size proxy
      const totalRuns = (db.prepare('SELECT COUNT(*) as cnt FROM pipeline_runs').get() as { cnt: number })?.cnt || 1;
      const idf = Math.log(Math.max(totalRuns, 10) / (record.mention_count + 1));
      score += Math.min(idf / 5, 0.3) * 0.2;

      // Signal 4: Version change
      if (record.latest_version_detail && tool.name !== canonicalName) {
        score += 0.1;
      }
    } else {
      // New tool: moderate significance
      score += 0.15;
    }
  } catch {
    // DB not available, use defaults
    score += 0.1;
  }

  return Math.min(score, 1.0);
}
