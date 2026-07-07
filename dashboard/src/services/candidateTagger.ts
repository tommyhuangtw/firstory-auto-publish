/**
 * Auto-tag episode candidates with a small fixed topical taxonomy, and drop non-English ones.
 *
 * One batched, cheap LLM call (Gemini Flash Lite) per crawl: for each title it returns topical
 * tags AND whether it's English. Tags are a browsing aid. The English flag is the second layer
 * of the language filter — it catches Latin-script non-English (Italian/Spanish/French/…) that
 * the crawler's non-Latin-script check in candidateCrawler.ts can't. Non-English rows with
 * status 'new' are deleted (saved/used rows are protected). Tags stored delimited (',AI工具,').
 */

import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import { getLLMService } from '@/services/llmService';

const log = createChildLogger('candidate-tagger');

// Fixed taxonomy — the UI shows exactly these as filter chips.
export const CANDIDATE_TAGS = ['創業', 'AI 思維', 'AI 工具', '新發布', '技術教學', '產業趨勢', '機器人'] as const;

const MODEL = 'google/gemini-3.1-flash-lite-preview';

interface ToTag { id: number; title: string; channel: string; status: string }

/** Keep only known tags; wrap in delimiters for LIKE matching (',,' when empty). */
function encodeTags(tags: unknown): string {
  const valid = Array.isArray(tags)
    ? tags.filter((t): t is string => typeof t === 'string' && (CANDIDATE_TAGS as readonly string[]).includes(t))
    : [];
  return ',' + valid.join(',') + ',';
}

/** Tag untagged rows + drop non-English. Pass `all` to re-scan every 'new' row (one-time sweep). */
export async function tagUntagged(limit = 120, all = false): Promise<{ tagged: number; deleted: number }> {
  const db = getDb();
  const where = all ? "status = 'new'" : 'tags IS NULL';
  const rows = db.prepare(
    `SELECT id, title, channel_name AS channel, status FROM episode_candidates WHERE ${where} ORDER BY crawled_at DESC LIMIT ?`,
  ).all(limit) as ToTag[];
  if (!rows.length) return { tagged: 0, deleted: 0 };

  const list = rows.map((r, i) => `${i}. ${r.title} — ${r.channel}`).join('\n');
  const prompt = `你是 AI podcast「AI 懶人報」的選題助理。下面每行是一支 YouTube 影片（標題 — 頻道）。
對每支影片做兩件事：
(1) 從這組固定標籤挑 1-3 個最貼切的（可複選，不確定就少貼）：${CANDIDATE_TAGS.join(' / ')}
(2) 判斷內容主要語言是不是英文（en）。標題若主要是義大利文/西班牙文/法文/葡萄牙文/德文等非英文，en=false。

標籤定義：
- 創業：創業、商業、募資、產品打造、創辦人訪談
- AI 思維：觀點、策略、心法、對 AI 未來的思考
- AI 工具：具體工具/App/產品的介紹或教學
- 新發布：新模型、新產品、新版本發表
- 技術教學：coding、實作、how-to、工程細節
- 產業趨勢：產業新聞、市場分析、總體趨勢
- 機器人：機器人、硬體、自駕、實體 AI

只回 JSON：{"items":{"0":{"tags":["AI 工具"],"en":true},"1":{"tags":["創業"],"en":false},...}}
每個 index 都要有。

影片：
${list}`;

  const res = await getLLMService().generateJSON<{ items: Record<string, { tags?: string[]; en?: boolean }> }>(prompt, 'candidate-tag', {
    models: [MODEL], // restrict to the cheap model — no expensive fallback for a browsing aid
    maxTokens: 2048,
    temperature: 0.2,
    timeoutMs: 60_000,
  });
  if (!res.success || !res.data?.items) {
    log.warn({ err: res.error }, 'tagging failed; leaving rows untagged (retried next crawl)');
    return { tagged: 0, deleted: 0 };
  }

  const items = res.data.items;
  const upd = db.prepare('UPDATE episode_candidates SET tags = ? WHERE id = ?');
  const del = db.prepare('DELETE FROM episode_candidates WHERE id = ?');
  let tagged = 0, deleted = 0;
  db.transaction(() => {
    rows.forEach((r, i) => {
      const item = items[String(i)] || {};
      // Non-English → drop (but never touch a row the user saved / turned into an episode).
      if (item.en === false && r.status === 'new') {
        del.run(r.id);
        deleted++;
        return;
      }
      upd.run(encodeTags(item.tags), r.id);
      tagged++;
    });
  })();
  log.info({ tagged, deleted }, 'candidates tagged');
  return { tagged, deleted };
}
