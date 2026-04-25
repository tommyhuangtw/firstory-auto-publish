/**
 * Tool Family Registry — entity resolution for AI tool deduplication.
 *
 * Uses a gazetteer approach (regex pattern table) to resolve tool name variants
 * to canonical family names. E.g., "Claude Opus 4.6" → family "Claude", version "Opus 4.6".
 *
 * Two-layer filtering:
 *   1. Static blocklist (O(1) Set lookup) — filters non-tool entities
 *   2. Regex family resolution — deduplicates tool variants
 */

import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('memory:families');

// ── Blocklist: entities that should NOT be tracked ──

const BLOCKLIST = new Set([
  // Programming languages
  'python', 'javascript', 'typescript', 'rust', 'go', 'java', 'c++', 'ruby',
  'swift', 'kotlin', 'php', 'html', 'css', 'sql', 'r',
  // YouTube channels / creators
  'fireship', 'two minute papers', 'matt wolfe', 'nate herk', 'theo',
  'the ai advantage', 'ai jason', 'matt shumer', 'joma tech',
  'sentdex', 'jordan harrod', 'valentin charrier',
  // Generic concepts
  'ai', 'artificial intelligence', 'machine learning', 'deep learning',
  'neural network', 'large language model', 'llm', 'nlp', 'computer vision',
  'open source', 'api', 'sdk', 'cli', 'saas', 'rag',
  // Platforms / social media (not AI-focused)
  'stackoverflow', 'reddit', 'twitter', 'youtube', 'discord',
  'linkedin', 'x', 'threads',
  // Generic non-AI tools
  'chrome', 'firefox', 'vs code', 'terminal', 'docker', 'kubernetes',
]);

/**
 * Check if extracted name should be filtered out.
 */
export function isBlocked(name: string): boolean {
  return BLOCKLIST.has(name.toLowerCase().trim());
}

// ── Family Resolution ──

export interface FamilyResolution {
  familyName: string;
  versionDetail: string;
  canonicalDisplay: string;
  category: string;
}

/**
 * Resolve a raw tool name to its canonical family.
 * Returns null if no family match found (tool is genuinely new).
 */
export function resolveCanonicalName(rawName: string): FamilyResolution | null {
  const db = getDb();
  const families = db.prepare('SELECT * FROM tool_families').all() as Array<{
    family_name: string;
    pattern: string;
    canonical_display: string;
    category: string;
  }>;

  const normalized = rawName.trim();

  for (const family of families) {
    try {
      const regex = new RegExp(family.pattern, 'i');
      const match = normalized.match(regex);
      if (match) {
        // Extract version detail: everything after the base family name
        const versionDetail = match[1]?.trim() || '';
        return {
          familyName: family.family_name,
          versionDetail,
          canonicalDisplay: family.canonical_display,
          category: family.category,
        };
      }
    } catch {
      // Invalid regex pattern, skip
      log.warn({ family: family.family_name, pattern: family.pattern }, 'Invalid family pattern');
    }
  }

  return null;
}

// ── Seed Data ──

const SEED_FAMILIES: Array<{
  family_name: string;
  pattern: string;
  canonical_display: string;
  category: string;
}> = [
  // LLMs
  { family_name: 'ChatGPT', pattern: '^(?:chat\\s*gpt|gpt)[\\s-]*(.*)', canonical_display: 'ChatGPT (OpenAI)', category: 'LLM' },
  { family_name: 'Claude', pattern: '^claude[\\s-]*(.*)', canonical_display: 'Claude (Anthropic)', category: 'LLM' },
  { family_name: 'Gemini', pattern: '^gemini[\\s-]*(.*)', canonical_display: 'Gemini (Google)', category: 'LLM' },
  { family_name: 'Llama', pattern: '^(?:llama|meta\\s*llama)[\\s-]*(.*)', canonical_display: 'Llama (Meta)', category: 'LLM' },
  { family_name: 'Mistral', pattern: '^mistral[\\s-]*(.*)', canonical_display: 'Mistral', category: 'LLM' },
  { family_name: 'Grok', pattern: '^grok[\\s-]*(.*)', canonical_display: 'Grok (xAI)', category: 'LLM' },
  { family_name: 'DeepSeek', pattern: '^deep\\s*seek[\\s-]*(.*)', canonical_display: 'DeepSeek', category: 'LLM' },
  { family_name: 'Copilot', pattern: '^(?:github\\s*)?copilot[\\s-]*(.*)', canonical_display: 'GitHub Copilot', category: 'DevTool' },
  { family_name: 'Qwen', pattern: '^qwen[\\s-]*(.*)', canonical_display: 'Qwen (Alibaba)', category: 'LLM' },
  { family_name: 'Phi', pattern: '^phi[\\s-]*(.*)', canonical_display: 'Phi (Microsoft)', category: 'LLM' },

  // Image / Video generation
  { family_name: 'Midjourney', pattern: '^midjourney[\\s-]*(.*)', canonical_display: 'Midjourney', category: 'Image' },
  { family_name: 'DALL-E', pattern: '^dall[\\s-]*e[\\s-]*(.*)', canonical_display: 'DALL-E (OpenAI)', category: 'Image' },
  { family_name: 'Stable Diffusion', pattern: '^stable\\s*diffusion[\\s-]*(.*)', canonical_display: 'Stable Diffusion', category: 'Image' },
  { family_name: 'Flux', pattern: '^flux[\\s-]*(.*)', canonical_display: 'Flux (Black Forest Labs)', category: 'Image' },
  { family_name: 'Sora', pattern: '^sora[\\s-]*(.*)', canonical_display: 'Sora (OpenAI)', category: 'Video' },
  { family_name: 'Runway', pattern: '^runway[\\s-]*(.*)', canonical_display: 'Runway', category: 'Video' },
  { family_name: 'Kling', pattern: '^kling[\\s-]*(.*)', canonical_display: 'Kling (Kuaishou)', category: 'Video' },

  // Dev tools
  { family_name: 'Cursor', pattern: '^cursor[\\s-]*(.*)', canonical_display: 'Cursor', category: 'DevTool' },
  { family_name: 'Replit', pattern: '^replit[\\s-]*(.*)', canonical_display: 'Replit', category: 'DevTool' },
  { family_name: 'Windsurf', pattern: '^windsurf[\\s-]*(.*)', canonical_display: 'Windsurf (Codeium)', category: 'DevTool' },
  { family_name: 'v0', pattern: '^v0[\\s-]*(.*)', canonical_display: 'v0 (Vercel)', category: 'DevTool' },
  { family_name: 'Bolt', pattern: '^bolt(?:\\.new)?[\\s-]*(.*)', canonical_display: 'Bolt.new', category: 'DevTool' },
  { family_name: 'Lovable', pattern: '^lovable[\\s-]*(.*)', canonical_display: 'Lovable', category: 'DevTool' },
  { family_name: 'LangChain', pattern: '^langchain[\\s-]*(.*)', canonical_display: 'LangChain', category: 'DevTool' },

  // Productivity / Automation
  { family_name: 'Notion AI', pattern: '^notion(?:\\s*ai)?[\\s-]*(.*)', canonical_display: 'Notion AI', category: 'Productivity' },
  { family_name: 'Perplexity', pattern: '^perplexity[\\s-]*(.*)', canonical_display: 'Perplexity', category: 'Search' },
  { family_name: 'n8n', pattern: '^n8n[\\s-]*(.*)', canonical_display: 'n8n', category: 'Automation' },
  { family_name: 'Zapier', pattern: '^zapier[\\s-]*(.*)', canonical_display: 'Zapier', category: 'Automation' },
  { family_name: 'Make', pattern: '^make(?:\\.com)?[\\s-]*(.*)', canonical_display: 'Make (Integromat)', category: 'Automation' },

  // Audio
  { family_name: 'ElevenLabs', pattern: '^eleven\\s*labs[\\s-]*(.*)', canonical_display: 'ElevenLabs', category: 'Audio' },
  { family_name: 'Suno', pattern: '^suno[\\s-]*(.*)', canonical_display: 'Suno', category: 'Audio' },
  { family_name: 'Udio', pattern: '^udio[\\s-]*(.*)', canonical_display: 'Udio', category: 'Audio' },

  // Other notable tools
  { family_name: 'Hugging Face', pattern: '^hugging\\s*face[\\s-]*(.*)', canonical_display: 'Hugging Face', category: 'DevTool' },
  { family_name: 'Ollama', pattern: '^ollama[\\s-]*(.*)', canonical_display: 'Ollama', category: 'DevTool' },
  { family_name: 'ComfyUI', pattern: '^comfy\\s*ui[\\s-]*(.*)', canonical_display: 'ComfyUI', category: 'Image' },
  { family_name: 'Canva', pattern: '^canva[\\s-]*(.*)', canonical_display: 'Canva', category: 'Image' },
  { family_name: 'Dify', pattern: '^dify[\\s-]*(.*)', canonical_display: 'Dify', category: 'DevTool' },
  { family_name: 'Coze', pattern: '^coze[\\s-]*(.*)', canonical_display: 'Coze', category: 'DevTool' },

  // Robotics (for robot segment)
  { family_name: 'Tesla Optimus', pattern: '^(?:tesla\\s*)?optimus[\\s-]*(.*)', canonical_display: 'Optimus (Tesla)', category: 'Robotics' },
  { family_name: 'Figure', pattern: '^figure(?:\\s*ai)?[\\s-]*(.*)', canonical_display: 'Figure AI', category: 'Robotics' },
  { family_name: 'Unitree', pattern: '^unitree[\\s-]*(.*)', canonical_display: 'Unitree', category: 'Robotics' },
  { family_name: 'Boston Dynamics', pattern: '^boston\\s*dynamics[\\s-]*(.*)', canonical_display: 'Boston Dynamics', category: 'Robotics' },

  // AI Companies & Tech Giants
  { family_name: 'OpenAI', pattern: '^open\\s*ai[\\s-]*(.*)', canonical_display: 'OpenAI', category: 'Company' },
  { family_name: 'Google', pattern: '^google(?:\\s*(?:ai|deepmind|cloud))?[\\s-]*(.*)', canonical_display: 'Google', category: 'Company' },
  { family_name: 'Microsoft', pattern: '^microsoft[\\s-]*(.*)', canonical_display: 'Microsoft', category: 'Company' },
  { family_name: 'Meta', pattern: '^meta(?:\\s*ai)?[\\s-]*(.*)', canonical_display: 'Meta', category: 'Company' },
  { family_name: 'Apple', pattern: '^apple(?:\\s*intelligence)?[\\s-]*(.*)', canonical_display: 'Apple', category: 'Company' },
  { family_name: 'Amazon', pattern: '^amazon(?:\\s*(?:aws|bedrock))?[\\s-]*(.*)', canonical_display: 'Amazon', category: 'Company' },
  { family_name: 'NVIDIA', pattern: '^nvidia[\\s-]*(.*)', canonical_display: 'NVIDIA', category: 'Company' },
  { family_name: 'Anthropic', pattern: '^anthropic[\\s-]*(.*)', canonical_display: 'Anthropic', category: 'Company' },
  { family_name: 'xAI', pattern: '^x\\.?ai[\\s-]*(.*)', canonical_display: 'xAI (Elon Musk)', category: 'Company' },
  { family_name: 'Cohere', pattern: '^cohere[\\s-]*(.*)', canonical_display: 'Cohere', category: 'Company' },
  { family_name: 'Stability AI', pattern: '^stability(?:\\s*ai)?[\\s-]*(.*)', canonical_display: 'Stability AI', category: 'Company' },

  // Platforms (AI-focused)
  { family_name: 'GitHub', pattern: '^github[\\s-]*(.*)', canonical_display: 'GitHub', category: 'Platform' },
];

/**
 * Seed tool_families table with known AI tool families.
 * Idempotent — uses INSERT OR IGNORE.
 */
export function seedFamilies(): void {
  const db = getDb();

  const insert = db.prepare(
    'INSERT OR IGNORE INTO tool_families (family_name, pattern, canonical_display, category) VALUES (?, ?, ?, ?)'
  );

  const transaction = db.transaction(() => {
    for (const family of SEED_FAMILIES) {
      insert.run(family.family_name, family.pattern, family.canonical_display, family.category);
    }
  });

  transaction();
  log.info({ count: SEED_FAMILIES.length }, 'Tool families seeded');
}
