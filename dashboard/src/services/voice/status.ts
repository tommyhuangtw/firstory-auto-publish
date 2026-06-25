/**
 * Voice corpus job status — lets the UI show progress + poll while the
 * (long-running) sync / asset-generation jobs run fire-and-forget on the server.
 *
 * Running flags live in module memory (shared across route modules in the single
 * dev/prod server process); last-run summaries are persisted to settings so they
 * survive restarts.
 */

import { getDb } from '@/db';

const SETTING_KEY = 'voice_last_runs';

interface LastRuns {
  lastSync?: { at: string; result: unknown };
  lastGenerate?: { at: string; result: unknown };
}

// In-process running flags
const running = { sync: false, generate: false };

export function isRunning(job: 'sync' | 'generate'): boolean {
  return running[job];
}

export function setRunning(job: 'sync' | 'generate', value: boolean): void {
  running[job] = value;
}

function readLastRuns(): LastRuns {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(SETTING_KEY) as { value: string } | undefined;
  if (!row) return {};
  try { return JSON.parse(row.value) as LastRuns; } catch { return {}; }
}

export function recordLastRun(job: 'sync' | 'generate', result: unknown): void {
  const current = readLastRuns();
  const key = job === 'sync' ? 'lastSync' : 'lastGenerate';
  current[key] = { at: new Date().toISOString(), result };
  getDb().prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(SETTING_KEY, JSON.stringify(current));
}

export function getVoiceStatus() {
  const last = readLastRuns();
  return {
    syncRunning: running.sync,
    generateRunning: running.generate,
    lastSync: last.lastSync ?? null,
    lastGenerate: last.lastGenerate ?? null,
  };
}
