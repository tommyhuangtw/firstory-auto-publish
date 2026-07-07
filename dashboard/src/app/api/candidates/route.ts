import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

// List episode candidates for the 選題板.
// Params: status (csv, default new,saved) | source (query|channel) | minViews | days | sort
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const statuses = (p.get('status') || 'new,saved').split(',').map((s) => s.trim()).filter(Boolean);
  const source = p.get('source'); // 'query' | 'channel' | null (all)
  const channel = p.get('channel'); // source_detail (a channel handle), null = all
  const tag = p.get('tag'); // topical tag, null = all
  const minViews = parseInt(p.get('minViews') || '0', 10) || 0;
  const days = parseInt(p.get('days') || '0', 10) || 0;
  const sort = p.get('sort') || 'views'; // views | newest | crawled

  const where: string[] = [];
  const args: (string | number)[] = [];

  if (statuses.length) {
    where.push(`status IN (${statuses.map(() => '?').join(',')})`);
    args.push(...statuses);
  }
  if (source === 'query' || source === 'channel') {
    where.push('source = ?');
    args.push(source);
  }
  if (channel) {
    where.push("source = 'channel' AND source_detail = ?");
    args.push(channel);
  }
  if (tag) {
    where.push('tags LIKE ?');
    args.push(`%,${tag},%`);
  }
  if (minViews > 0) {
    where.push('view_count >= ?');
    args.push(minViews);
  }
  if (days > 0) {
    where.push(`published_at IS NOT NULL AND datetime(published_at) > datetime('now', ?)`);
    args.push(`-${days} days`);
  }

  const orderBy =
    sort === 'newest' ? 'datetime(published_at) DESC'
    : sort === 'crawled' ? 'datetime(crawled_at) DESC'
    : 'view_count DESC';

  const rows = getDb().prepare(
    `SELECT id, video_id, title, channel_name, thumbnail_url, published_at,
            view_count, duration_seconds, source, source_detail, status, tags, crawled_at
     FROM episode_candidates
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY ${orderBy}
     LIMIT 200`,
  ).all(...args);

  // Distinct channels available (for the channel filter chips) — independent of the
  // active channel/date/view filters so the chip list stays stable, but respects status.
  const chArgs: string[] = [];
  let chWhere = "source = 'channel'";
  if (statuses.length) {
    chWhere += ` AND status IN (${statuses.map(() => '?').join(',')})`;
    chArgs.push(...statuses);
  }
  const channels = getDb().prepare(
    `SELECT source_detail AS handle, channel_name AS name, COUNT(*) AS count
     FROM episode_candidates WHERE ${chWhere}
     GROUP BY source_detail ORDER BY name`,
  ).all(...chArgs);

  return NextResponse.json({ candidates: rows, channels });
}
