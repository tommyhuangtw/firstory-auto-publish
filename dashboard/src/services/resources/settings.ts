// dashboard/src/services/resources/settings.ts
import { getDb } from '@/db';

const DEFAULTS = {
  resource_x_queries: 'Claude Code,Codex CLI,MCP server,AI agent skill',
  resource_x_max_items: '20',
  resource_github_queries: 'topic:mcp|topic:ai-agent|claude code in:name,description,readme|codex in:name,description',
  resource_recency_days: '3',
  resource_social_buzz_floor: '120',
  resource_star_velocity_floor: '15',
  resource_youth_window_days: '60',
  resource_github_pushed_days: '14',
  resource_github_min_stars: '80',
  resource_top_n: '5',
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
