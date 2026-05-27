import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

// Parse SoundOn date formats:
//   "2026/4/23 上午12:00:00"  → "2026-04-23"
//   "6/2/2025, 12:00:00 AM"  → "2025-06-02"
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
  throw new Error(`Invalid date: ${raw}`);
}

// Parse ISO date: "2026-04-29T13:06:48Z" → "2026-04-29T13:06:48Z"
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

type CsvFormat = 'daily' | 'episode';

function detectFormat(header: string): CsvFormat {
  if (header.includes('標題')) return 'episode';
  if (header.includes('下載數')) return 'daily';
  throw new Error(`Unknown CSV format. Header: ${header}`);
}

function extractEpisodeNumber(title: string): number | null {
  const match = title.match(/EP(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const text = await file.text();
    const lines = text.split('\n').filter((l) => l.trim());
    if (lines.length < 2) {
      return NextResponse.json({ error: 'CSV is empty' }, { status: 400 });
    }

    const header = lines[0];
    const format = detectFormat(header);
    const db = getDb();
    let imported = 0;

    if (format === 'daily') {
      // date,下載數,不重複下載數
      const stmt = db.prepare(`
        INSERT INTO soundon_daily_downloads (date, downloads, unique_downloads)
        VALUES (?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
          downloads = excluded.downloads,
          unique_downloads = excluded.unique_downloads,
          imported_at = datetime('now')
      `);

      const insertMany = db.transaction((rows: string[]) => {
        for (const line of rows) {
          const fields = parseCSVLine(line);
          if (fields.length < 3) continue;
          const date = parseSoundonDate(fields[0]);
          const downloads = parseInt(fields[1], 10);
          const uniqueDownloads = parseInt(fields[2], 10);
          if (isNaN(downloads) || isNaN(uniqueDownloads)) continue;
          stmt.run(date, downloads, uniqueDownloads);
          imported++;
        }
      });

      insertMany(lines.slice(1));
    } else {
      // #,標題,上架類型,總下載,發佈7天,發佈30天,單集長度,發布日期
      const stmt = db.prepare(`
        INSERT INTO soundon_episodes (episode_number, title, publish_type, total_downloads, downloads_7d, downloads_30d, duration_sec, published_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(title) DO UPDATE SET
          total_downloads = excluded.total_downloads,
          downloads_7d = excluded.downloads_7d,
          downloads_30d = excluded.downloads_30d,
          imported_at = datetime('now')
      `);

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
            episodeNumber,
            title,
            publishType,
            totalDownloads,
            isNaN(downloads7d) ? 0 : downloads7d,
            isNaN(downloads30d) ? 0 : downloads30d,
            isNaN(durationSec) ? 0 : durationSec,
            publishedAt
          );
          imported++;
        }
      });

      insertMany(lines.slice(1));
    }

    return NextResponse.json({
      success: true,
      format,
      imported,
      filename: file.name,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
