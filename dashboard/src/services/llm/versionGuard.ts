/**
 * Version Guard — prevents outdated / hallucinated AI-model version numbers
 * (e.g. "Claude 3.5", "GPT-4", "Gemini 2.0") from leaking into generated
 * titles, scripts, descriptions, and social captions.
 *
 * Two halves:
 *  - GUARD STRINGS appended to generation system prompts (suppress invented versions).
 *  - DETECTORS used by the review UI + pipeline verify step to flag what slips through.
 */

/** Appended to Chinese-output generation prompts (titles, descriptions, captions, hook titles). */
export const VERSION_GUARD_ZH = `【版本號規則】除非使用者提供的「來源素材」中明確出現某個 AI 模型／工具的版本號，否則一律只用模型名稱稱呼（例如寫「Claude」「GPT」「Gemini」，不要寫「Claude 3.5」「GPT-4」「Gemini 2.0」），不要自行加上版本號或世代數字。若來源素材有明確版本號，則照抄該版本號，不得改寫、升版或降版。`;

/** Appended to the English script-generation prompt. */
export const VERSION_GUARD_EN = `[Model version rule] Do NOT add a version number to any AI model or tool name unless that exact version appears in the provided source material. Otherwise refer to it by name only (e.g. "Claude", "GPT", "Gemini") — never invent versions like "Claude 3.5", "GPT-4", or "Gemini 2.0". If the source states a specific version, copy it verbatim; never upgrade, downgrade, or guess.`;

/**
 * Matches an AI model/tool name immediately followed by a version token,
 * e.g. "Claude 3.5", "GPT-4o", "Gemini 2.0", "Claude Code 2.0", "Llama 3.1".
 * Intentionally broad on the trailing version chars to catch "3.5 Sonnet" → captures "Claude 3.5".
 */
export const VERSION_REGEX =
  /\b(Claude(?:\s+Code)?|GPT|ChatGPT|Gemini|Gemma|Llama|Mistral|Mixtral|Grok|Qwen|DeepSeek|Sora|DALL[-·]?E|Phi|Command\s+R)[-\s]?\d[\w.]*/gi;

/** Normalize for grounded-vs-not comparison: lowercase, collapse dashes/whitespace to one space. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[-\s]+/g, ' ').trim();
}

/** Return the distinct model-version mentions found in `text` (original casing, deduped). */
export function detectModelVersions(text: string | null | undefined): string[] {
  if (!text) return [];
  const matches = text.match(VERSION_REGEX) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const cleaned = m.trim();
    const key = normalize(cleaned);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(cleaned);
    }
  }
  return out;
}

/**
 * Return version mentions in `text` that do NOT appear in `sourceText`.
 * These are the precise "the model invented this version" cases — the strongest
 * hallucination signal, since the episode's source transcript/summary is the
 * ground truth for what the episode actually covers.
 */
export function detectUngroundedVersions(
  text: string | null | undefined,
  sourceText: string | null | undefined,
): string[] {
  const detected = detectModelVersions(text);
  if (detected.length === 0) return [];
  const source = normalize(sourceText || '');
  if (!source) return detected; // no source to ground against → treat all as suspect
  return detected.filter((v) => !source.includes(normalize(v)));
}

/** Keywords that indicate a version/release/freshness CLAIM worth web-verifying. */
export const UPDATE_CLAIM_REGEX =
  /(發布|推出|更新|升級|最新|新版|新一代|剛(?:推出|發布|上線)|release|launch|update|latest|newest|just\s+released|\bv\d|\d\.\d)/i;

/** True if `text` makes a version/update/freshness claim (used to gate web verification). */
export function hasVersionUpdateClaim(text: string | null | undefined): boolean {
  if (!text) return false;
  return detectModelVersions(text).length > 0 || UPDATE_CLAIM_REGEX.test(text);
}
