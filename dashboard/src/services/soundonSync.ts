/**
 * SoundOn analytics sync — scrapes SoundOn (Playwright) and imports the daily +
 * episode CSV data into SQLite.
 *
 * In-process function so it can be called directly from BOTH the API route and the
 * scheduler. The scheduler must NOT self-fetch over http:// because the dev server
 * runs HTTPS-only (next dev --experimental-https), which makes plain HTTP fetches fail.
 */

import { getDb } from '@/db';
import { scrapeSoundOnAnalytics } from '@/services/soundonScraper';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('soundon-sync');

// ── CSV parsers ───────────────────────────────────────────────────────
// SoundOn date formats:
//   "2026/4/23 上午12:00:00"  → "2026-04-23"
//   "6/2/2025, 12:00:00 AM"   → "2025-06-02"  (en-US locale from blob CSV)
function parseSoundonDate(raw: string): string {
  const cleaned = raw.replace(/"/g, '').trim();

  const ymdMatch = cleaned.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const mdyMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdyMatch) {
    const [, m, d, y] = mdyMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  throw new Error(`Invalid date format: ${raw}`);
}

function parseIsoDate(raw: string): string {
  return raw.trim();
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function extractEpisodeNumber(title: string): number | null {
  const match = title.match(/EP(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

function importDailyCsv(csvText: string): number {
  const db = getDb();
  const lines = csvText.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return 0;

  const stmt = db.prepare(`
    INSERT INTO soundon_daily_downloads (date, downloads, unique_downloads)
    VALUES (?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      downloads = excluded.downloads,
      unique_downloads = excluded.unique_downloads,
      imported_at = datetime('now')
  `);

  let imported = 0;
  const insertMany = db.transaction((rows: string[]) => {
    for (const line of rows) {
      const fields = parseCSVLine(line);
      if (fields.length < 3) continue;
      try {
        const date = parseSoundonDate(fields[0]);
        const downloads = parseInt(fields[1], 10);
        const uniqueDownloads = parseInt(fields[2], 10);
        if (isNaN(downloads) || isNaN(uniqueDownloads)) continue;
        stmt.run(date, downloads, uniqueDownloads);
        imported++;
      } catch {
        // skip unparseable rows
      }
    }
  });
  insertMany(lines.slice(1));
  return imported;
}

function importEpisodeCsv(csvText: string): number {
  const db = getDb();
  const lines = csvText.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return 0;

  const stmt = db.prepare(`
    INSERT INTO soundon_episodes (episode_number, title, publish_type, total_downloads, downloads_7d, downloads_30d, duration_sec, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(title) DO UPDATE SET
      total_downloads = excluded.total_downloads,
      downloads_7d = excluded.downloads_7d,
      downloads_30d = excluded.downloads_30d,
      imported_at = datetime('now')
  `);

  let imported = 0;
  const insertMany = db.transaction((rows: string[]) => {
    for (const line of rows) {
      const fields = parseCSVLine(line);
      if (fields.length < 8) continue;
      const title = fields[1];
      const episodeNumber = extractEpisodeNumber(title);
      const publishType = fields[2];
      const totalDownloads = parseInt(fields[3], 10);
      const downloads7d = parseInt(fields[4], 10);
      const downloads30d = parseInt(fields[5], 10);
      const durationSec = parseFloat(fields[6]);
      const publishedAt = parseIsoDate(fields[7]);
      if (isNaN(totalDownloads)) continue;
      stmt.run(
        episodeNumber, title, publishType, totalDownloads,
        isNaN(downloads7d) ? 0 : downloads7d,
        isNaN(downloads30d) ? 0 : downloads30d,
        isNaN(durationSec) ? 0 : durationSec,
        publishedAt,
      );
      imported++;
    }
  });
  insertMany(lines.slice(1));
  return imported;
}

export interface SoundonSyncResult {
  success: boolean;
  daily_imported: number;
  episode_imported: number;
  errors?: string[];
  synced_at: string;
}

/** Scrape SoundOn and import daily + episode analytics. Throws on scrape failure. */
export async function syncSoundonAnalytics(): Promise<SoundonSyncResult> {
  log.info('Starting SoundOn analytics sync...');

  const { episodeCsv, dailyCsv, errors } = await scrapeSoundOnAnalytics();

  let dailyImported = 0;
  let episodeImported = 0;

  if (dailyCsv) {
    dailyImported = importDailyCsv(dailyCsv);
    log.info({ dailyImported }, 'Daily downloads imported');
  }

  if (episodeCsv) {
    episodeImported = importEpisodeCsv(episodeCsv);
    log.info({ episodeImported }, 'Episode stats imported');
  }

  return {
    success: !!(episodeCsv || dailyCsv),
    daily_imported: dailyImported,
    episode_imported: episodeImported,
    errors: errors.length > 0 ? errors : undefined,
    synced_at: new Date().toISOString(),
  };
}
