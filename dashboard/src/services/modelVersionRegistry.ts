/**
 * Model Version Registry — maintains a small reference list of the CURRENT latest
 * version of commonly-mentioned AI models/tools, and verifies version claims via
 * web search (OpenRouter web-search model).
 *
 * Used to (a) ground generation, and (b) flag outdated version claims at review.
 * The reference lives in the `settings` table (key `current_model_versions`) so it
 * can be refreshed from the web without code changes.
 */

import { getDb } from '@/db';
import { getLLMService } from '@/services/llmService';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('model-version-registry');

export const SETTING_KEY = 'current_model_versions';

/** OpenRouter web-search model — purpose-built for current-facts retrieval with citations. */
const WEB_MODEL = 'perplexity/sonar';

export interface ModelVersion {
  name: string;       // canonical tool/vendor, e.g. "Claude", "GPT (OpenAI)"
  latest: string;     // human-readable latest version, e.g. "Opus 4.8 / Sonnet 4.6"
  asOf: string;       // YYYY-MM-DD when this was last confirmed
}

/**
 * Seed values (best-known at time of writing). The web refresh keeps these current —
 * treat as a starting point, not a source of truth that must be hand-edited.
 */
export const DEFAULT_MODEL_VERSIONS: ModelVersion[] = [
  { name: 'Claude', latest: 'Opus 4.8 / Sonnet 4.6 / Haiku 4.5 (Fable 5)', asOf: '2026-06-15' },
  { name: 'GPT (OpenAI)', latest: 'GPT-5.5', asOf: '2026-06-15' },
  { name: 'Gemini (Google)', latest: 'Gemini 3.1', asOf: '2026-06-15' },
];

/** Tools to refresh by default when no explicit list is given. */
const DEFAULT_TRACKED = [
  'Claude (Anthropic)', 'GPT (OpenAI)', 'Gemini (Google)', 'Llama (Meta)',
  'Grok (xAI)', 'DeepSeek', 'Qwen (Alibaba)', 'Mistral',
];

/** Read the maintained reference list (falls back to seed defaults). */
export function getCurrentVersions(): ModelVersion[] {
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(SETTING_KEY) as
      | { value: string }
      | undefined;
    if (row?.value) {
      const parsed = JSON.parse(row.value);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as ModelVersion[];
    }
  } catch (err) {
    log.warn({ error: (err as Error).message }, 'Failed to read current_model_versions, using defaults');
  }
  return DEFAULT_MODEL_VERSIONS;
}

/** Persist the reference list. */
export function writeCurrentVersions(list: ModelVersion[]): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(SETTING_KEY, JSON.stringify(list));
}

/** Compact one-line reference string for injecting into generation prompts. */
export function buildVersionReferenceSnippet(): string {
  const list = getCurrentVersions();
  const items = list.map((v) => `${v.name}: ${v.latest}`).join('；');
  return `【目前各 AI 模型最新版本（參考用，截至 ${list[0]?.asOf || ''}）】${items}。請勿把比這更舊的版本說成「最新」；不確定版本時只用模型名稱、不要自行加版本號。`;
}

/**
 * Refresh the reference list from the web. Only writes if a web-search model actually
 * answered (so a fallback to a non-web model never overwrites with stale training data).
 */
export async function refreshVersionsViaWeb(names: string[] = DEFAULT_TRACKED): Promise<{
  updated: boolean;
  list: ModelVersion[];
  model: string | null;
}> {
  const llm = getLLMService();
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `What is the CURRENT latest publicly-released version of each of these AI models/tools, as of ${today}? ${names.join(', ')}.
Use up-to-date web information. For vendors with multiple tiers (e.g. Claude Opus/Sonnet/Haiku), give the current flagship versions.
Return ONLY JSON: {"versions":[{"name":"<vendor/model>","latest":"<version string>"}]}. Keep "latest" short. Do not include commentary.`;

  const result = await llm.generateJSON<{ versions: { name: string; latest: string }[] }>(
    prompt,
    'version_refresh',
    { preferredModel: WEB_MODEL, maxTokens: 1024, temperature: 0 },
  );

  // Safety: only trust the answer if a web-capable model produced it.
  const usedWebModel = !!result.model && /perplexity|sonar|online/i.test(result.model);
  if (!result.success || !result.data?.versions || !usedWebModel) {
    log.warn({ model: result.model, success: result.success }, 'Version refresh skipped (no web model answer)');
    return { updated: false, list: getCurrentVersions(), model: result.model };
  }

  const list: ModelVersion[] = result.data.versions
    .filter((v) => v.name && v.latest)
    .map((v) => ({ name: v.name.trim(), latest: v.latest.trim(), asOf: today }));

  if (list.length === 0) {
    return { updated: false, list: getCurrentVersions(), model: result.model };
  }

  writeCurrentVersions(list);
  log.info({ count: list.length, model: result.model }, 'Model version reference refreshed via web');
  return { updated: true, list, model: result.model };
}

export interface VersionVerdict {
  claim: string;        // the version mention found in the content, e.g. "Claude 3.5"
  isOutdated: boolean;  // true if the web/reference says a newer version exists
  current: string;      // what the current latest is
  note: string;         // short human-readable explanation
}

/**
 * Verify specific version claims via web search. Used both by the conditional
 * pipeline step and the on-demand review button. Degrades gracefully (returns []).
 */
export async function verifyVersionClaims(
  claims: string[],
  context?: string,
): Promise<{ verdicts: VersionVerdict[]; model: string | null }> {
  const unique = [...new Set(claims.map((c) => c.trim()).filter(Boolean))];
  if (unique.length === 0) return { verdicts: [], model: null };

  const llm = getLLMService();
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Today is ${today}. For each AI model version claim below, use up-to-date web information to decide whether it is OUTDATED (a newer version of that model now exists).${
    context ? `\n\nContext where the claim appeared:\n${context.slice(0, 800)}` : ''
  }

Claims:
${unique.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Return ONLY JSON: {"verdicts":[{"claim":"<original claim>","isOutdated":true|false,"current":"<current latest version>","note":"<one short sentence>"}]}.`;

  const result = await llm.generateJSON<{ verdicts: VersionVerdict[] }>(
    prompt,
    'version_verify',
    { preferredModel: WEB_MODEL, maxTokens: 1024, temperature: 0 },
  );

  if (!result.success || !result.data?.verdicts) {
    log.warn({ model: result.model }, 'Version verification failed/unavailable');
    return { verdicts: [], model: result.model };
  }
  return { verdicts: result.data.verdicts, model: result.model };
}
