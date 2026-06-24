import { getDb } from '@/db';
import { getLLMService } from '@/services/llmService';
import { embedTexts, cosine, parseEmbedding } from '@/services/trends/embeddings';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('theme-service');
const MIN_SCORE = 0.30;     // assignment floor
const MAX_THEMES_PER = 2;   // top-N themes per insight

interface ThemeRow { id: number; embedding: string | null }

/** Derive ~15 themes from a representative sample, embed them, replace the themes table. */
export async function deriveThemes(): Promise<number> {
  const db = getDb();
  const sample = db.prepare(
    `SELECT hook, idea FROM insights WHERE embedding IS NOT NULL ORDER BY RANDOM() LIMIT 120`,
  ).all() as Array<{ hook: string; idea: string }>;
  const list = sample.map((s, i) => `${i + 1}. ${s.hook}`).join('\n');

  const prompt = `以下是我內容靈感庫裡的代表性 insight（每則一句 hook）。請幫我歸納出 6 到 9 個「主題分類」（寧少勿多，每個主題要夠大、夠有區隔，不要切太細），讓我之後可以按主題瀏覽（例如：創業、AI 應用、行銷、商業思維、創意發想、生產力、個人成長…，但請依實際內容歸納，不要硬塞）。
每個主題要：一個簡短的繁體中文名稱 + 一句話描述。主題之間不要重疊。

${list}

嚴格輸出 JSON，不要 markdown fence：
{ "themes": [ { "name": "...", "description": "..." } ] }`;

  const llm = getLLMService();
  const r = await llm.call({
    stage: 'theme_derive',
    messages: [{ role: 'user', content: prompt }],
    options: { temperature: 0.4, maxTokens: 1500, models: ['google/gemini-3.1-flash-lite-preview', 'google/gemini-3.5-flash'], retryCount: 2, timeoutMs: 60_000 },
  });
  if (!r.success || !r.content) throw new Error(r.error || 'theme derive LLM failed');
  let cleaned = r.content.trim();
  if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  const obj = cleaned.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(obj ? obj[0] : cleaned) as { themes?: Array<{ name: string; description: string }> };
  const themes = (parsed.themes || []).filter((t) => t.name);
  if (!themes.length) throw new Error('LLM returned no themes');

  const vecs = await embedTexts(themes.map((t) => `${t.name} — ${t.description || ''}`));

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM inspiration_themes').run();
    themes.forEach((t, i) => {
      const v = vecs[i];
      db.prepare('INSERT INTO inspiration_themes (name, description, embedding) VALUES (?, ?, ?)')
        .run(t.name, t.description || '', v ? JSON.stringify(v) : null);
    });
  });
  tx();
  log.info({ count: themes.length }, 'Themes derived');
  return themes.length;
}

/** Cosine an insight embedding to all themes → top MAX_THEMES_PER above MIN_SCORE. */
export function assignThemes(insightVec: number[]): Array<{ themeId: number; score: number }> {
  const db = getDb();
  const themes = db.prepare('SELECT id, embedding FROM inspiration_themes WHERE embedding IS NOT NULL').all() as ThemeRow[];
  return themes
    .map((t) => { const v = parseEmbedding(t.embedding); return { themeId: t.id, score: v ? cosine(insightVec, v) : -1 }; })
    .filter((s) => s.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_THEMES_PER);
}

/** Write an insight's theme assignments (replaces any existing). */
export function setInsightThemes(insightId: number, assigned: Array<{ themeId: number; score: number }>): void {
  const db = getDb();
  db.prepare('DELETE FROM insight_themes WHERE insight_id = ?').run(insightId);
  const ins = db.prepare('INSERT OR IGNORE INTO insight_themes (insight_id, theme_id, score) VALUES (?, ?, ?)');
  for (const a of assigned) ins.run(insightId, a.themeId, a.score);
}

/** Re-tag every insight against the current themes; recompute counts. */
export function tagAllInsights(): { tagged: number } {
  const db = getDb();
  const rows = db.prepare('SELECT id, embedding FROM insights WHERE embedding IS NOT NULL').all() as Array<{ id: number; embedding: string }>;
  let tagged = 0;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM insight_themes').run();
    for (const r of rows) {
      const v = parseEmbedding(r.embedding);
      if (!v) continue;
      const assigned = assignThemes(v);
      if (assigned.length) { setInsightThemes(r.id, assigned); tagged++; }
    }
  });
  tx();
  recomputeThemeCounts();
  log.info({ tagged }, 'All insights tagged');
  return { tagged };
}

export function recomputeThemeCounts(): void {
  getDb().exec(
    `UPDATE inspiration_themes SET insight_count = (SELECT COUNT(*) FROM insight_themes it WHERE it.theme_id = inspiration_themes.id)`,
  );
}
