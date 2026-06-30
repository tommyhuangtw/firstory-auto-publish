// dashboard/src/services/resources/settings.ts
import { getDb } from '@/db';

const DEFAULTS = {
  resource_x_queries: 'Claude Code,Codex CLI,MCP server,Claude agent skills,AI coding tools,how I use Claude Code,free AI resource',
  resource_x_max_items: '20',
  resource_x_min_faves: '40',            // X 來源端讚數門檻（太高 + 2天窗口會撈到 0 → 適中）
  resource_x_exclude_accounts: 'AnthropicAI,claude,claudeai,anthropic,OpenAI,OpenAIDevs,GoogleAI,GoogleDeepMind,GeminiApp,Google', // 大廠官方帳號的即時公告很多人 cover，排除→專注社群實證有用內容
  resource_github_queries: 'topic:mcp|topic:ai-agent|claude code in:name,description,readme|codex in:name,description',
  resource_recency_days: '2',
  resource_social_buzz_floor: '120',
  resource_github_created_days: '15',    // 只撈最近半個月「建立」的新 repo（created:>），不是最後 commit 日
  resource_github_min_stars: '80',
  // 依建立年齡分級的爆衝門檻：新生 repo 的總星數≈該時間窗衝到的星數。任一窗達標即挑出。
  resource_github_burst_3d_stars: '500',    // ≤ 3 天建立 且 ≥ 此星數
  resource_github_burst_1w_stars: '1500',   // ≤ 7 天建立 且 ≥ 此星數
  resource_github_burst_2w_stars: '3000',   // ≤ 14 天建立 且 ≥ 此星數
  resource_top_n: '5',
  resource_max_post_age_days: '2',       // 社群貼文超過幾天就算舊、直接淘汰（不論互動多高）— 只要最新 1-2 天
  resource_apify_cost_per_item: '0.0004', // Apify X 每則結果估價（USD），用於成本估算
};

export type ResourceSettingKey = keyof typeof DEFAULTS;

export function rget(key: ResourceSettingKey): string {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? DEFAULTS[key];
}
export function rgetNum(key: ResourceSettingKey): number {
  const n = parseFloat(rget(key));
  return Number.isFinite(n) ? n : parseFloat(DEFAULTS[key]);
}
export function rgetList(key: ResourceSettingKey, sep = ','): string[] {
  return rget(key).split(sep).map((s) => s.trim()).filter(Boolean);
}

/** 寫入設定（UI 可調的爬取設定）。upsert 進 settings 表，覆蓋 DEFAULTS。 */
export function rset(key: ResourceSettingKey, value: string): void {
  const db = getDb();
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

/** UI 可調的爬取設定（含目前值與預設）。 */
export const EDITABLE_KEYS: ResourceSettingKey[] = [
  'resource_x_queries', 'resource_x_exclude_accounts', 'resource_x_min_faves',
  'resource_recency_days', 'resource_max_post_age_days', 'resource_top_n',
];
