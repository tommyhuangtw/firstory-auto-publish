import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get('range') || 'all'; // 7d, 30d, 90d, 360d, all
  const sort = searchParams.get('sort') || 'total_downloads'; // total_downloads, downloads_7d, downloads_30d, published_at
  const order = searchParams.get('order') || 'desc';

  const db = getDb();

  // Build date filter
  let dateFilter = '';
  if (range !== 'all') {
    const days = parseInt(range.replace('d', ''), 10);
    if (!isNaN(days)) {
      dateFilter = `WHERE date >= date('now', '-${days} days')`;
    }
  }

  // Daily downloads
  const dailyDownloads = db.prepare(`
    SELECT date, downloads, unique_downloads
    FROM soundon_daily_downloads
    ${dateFilter}
    ORDER BY date ASC
  `).all() as { date: string; downloads: number; unique_downloads: number }[];

  // Episode rankings
  const validSortColumns = ['total_downloads', 'downloads_7d', 'downloads_30d', 'published_at', 'episode_number'];
  const sortCol = validSortColumns.includes(sort) ? sort : 'total_downloads';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

  const episodes = db.prepare(`
    SELECT episode_number, title, publish_type, total_downloads, downloads_7d, downloads_30d, duration_sec, published_at
    FROM soundon_episodes
    ORDER BY ${sortCol} ${sortOrder}
  `).all() as {
    episode_number: number | null;
    title: string;
    publish_type: string;
    total_downloads: number;
    downloads_7d: number;
    downloads_30d: number;
    duration_sec: number;
    published_at: string;
  }[];

  // Summary stats — based on unique downloads as primary metric
  const totalDownloads = dailyDownloads.reduce((sum, d) => sum + d.downloads, 0);
  const totalUniqueDownloads = dailyDownloads.reduce((sum, d) => sum + d.unique_downloads, 0);
  const daysCount = dailyDownloads.length || 1;
  const avgDailyUniqueDownloads = Math.round(totalUniqueDownloads / daysCount);
  const maxDay = dailyDownloads.reduce(
    (max, d) => (d.unique_downloads > max.unique_downloads ? d : max),
    { date: '', downloads: 0, unique_downloads: 0 }
  );

  // Week-over-week growth (last 7 days vs previous 7 days) — based on unique downloads
  const allDaily = db.prepare(`
    SELECT date, unique_downloads FROM soundon_daily_downloads ORDER BY date DESC
  `).all() as { date: string; unique_downloads: number }[];

  let wowGrowth: number | null = null;
  if (allDaily.length >= 14) {
    const last7 = allDaily.slice(0, 7).reduce((s, d) => s + d.unique_downloads, 0);
    const prev7 = allDaily.slice(7, 14).reduce((s, d) => s + d.unique_downloads, 0);
    if (prev7 > 0) {
      wowGrowth = Math.round(((last7 - prev7) / prev7) * 100);
    }
  }

  // Weekly averages for trend analysis
  const weeklyAverages: { week: string; avg_downloads: number; avg_unique: number }[] = [];
  if (dailyDownloads.length > 0) {
    let weekStart = dailyDownloads[0].date;
    let weekDownloads = 0;
    let weekUnique = 0;
    let dayCount = 0;

    for (const d of dailyDownloads) {
      weekDownloads += d.downloads;
      weekUnique += d.unique_downloads;
      dayCount++;
      if (dayCount === 7) {
        weeklyAverages.push({
          week: weekStart,
          avg_downloads: Math.round(weekDownloads / 7),
          avg_unique: Math.round(weekUnique / 7),
        });
        weekStart = d.date;
        weekDownloads = 0;
        weekUnique = 0;
        dayCount = 0;
      }
    }
    // Remaining partial week
    if (dayCount > 0) {
      weeklyAverages.push({
        week: weekStart,
        avg_downloads: Math.round(weekDownloads / dayCount),
        avg_unique: Math.round(weekUnique / dayCount),
      });
    }
  }

  return NextResponse.json({
    dailyDownloads,
    episodes,
    weeklyAverages,
    summary: {
      totalDownloads,
      totalUniqueDownloads,
      avgDailyUniqueDownloads,
      maxDay: maxDay.date ? maxDay : null,
      wowGrowth,
      totalEpisodes: episodes.length,
      // Episode-level stats (from episode-list CSV = per-episode unique downloads)
      cumulativeEpisodeDownloads: episodes.reduce((s, e) => s + e.total_downloads, 0),
      avgDownloadsPerEpisode: episodes.length > 0
        ? Math.round(episodes.reduce((s, e) => s + e.total_downloads, 0) / episodes.length)
        : 0,
    },
  });
}
