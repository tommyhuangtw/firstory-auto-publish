/**
 * Tool Extraction — uses LLM to extract AI tool mentions from podcast scripts.
 *
 * Runs after scriptEnglish, before translate.
 * Uses Gemini Flash Lite for cost efficiency.
 */

import { getLLMService } from '@/services/llmService';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('memory:extractor');

const EXTRACTION_MODEL = 'google/gemini-2.5-flash-lite';

export interface ExtractedTool {
  name: string;
  category: string;
  aliases: string[];
  contextSnippet: string;
  mentionType: 'new' | 'update' | 'deep_dive' | 'brief';
}

export async function extractToolsFromScript(
  scriptEn: string,
  episodeNumber: number
): Promise<ExtractedTool[]> {
  if (!scriptEn || scriptEn.length < 100) {
    log.warn('Script too short for tool extraction');
    return [];
  }

  const llm = getLLMService();

  // Use first 8000 chars to stay within token limits
  const scriptChunk = scriptEn.slice(0, 8000);

  const prompt = `Extract all AI tools, platforms, and software products mentioned in this podcast script.

For each tool, provide:
- name: The canonical/official name (e.g., "ChatGPT" not "chat gpt")
- category: One of: LLM, DevTool, Image, Audio, Video, Productivity, Automation, Search, Database, Other
- aliases: Array of alternative names used in the script (empty array if none)
- contextSnippet: A 1-2 sentence summary of what the script says about this tool
- mentionType: "deep_dive" if the tool is discussed in detail (>2 paragraphs), "brief" if just mentioned in passing, "update" if discussing a new version/feature, "new" if introducing the tool for the first time to the audience

Script:
${scriptChunk}

Return JSON: { "tools": [ { "name": "...", "category": "...", "aliases": [], "contextSnippet": "...", "mentionType": "..." } ] }

Important:
- Only include real, specific tools/products (not generic concepts like "AI" or "machine learning")
- Deduplicate: if the same tool appears multiple times, list it once with the most relevant context
- Maximum 15 tools`;

  const result = await llm.generateJSON<{ tools: ExtractedTool[] }>(
    prompt,
    'tool_extraction',
    {
      episodeNumber,
      preferredModel: EXTRACTION_MODEL,
      maxTokens: 2048,
      temperature: 0.2,
    }
  );

  if (!result.success || !result.data?.tools) {
    log.error({ error: result.error }, 'Tool extraction failed');
    return [];
  }

  const tools = result.data.tools.filter(
    (t) => t.name && t.name.length > 1 && t.category
  );

  log.info({ count: tools.length, episodeNumber }, 'Tools extracted');
  return tools;
}
