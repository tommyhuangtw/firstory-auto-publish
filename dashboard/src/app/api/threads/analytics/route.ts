import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

interface CategoryStat {
  category: string;
  post_count: number;
  avg_likes: number;
  avg_replies: number;
  avg_views: number;
  avg_engagement_pct: number;
  total_likes: number;
  total_replies: number;
}

interface TimeSeriesPoint {
  date: string;
  post_count: number;
  avg_likes: number;
  avg_replies: number;
  avg_views: number;
}

interface TopPost {
  post_id: string;
  text: string;
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  engagement_rate: number;
  posted_at: string;
}

export async function GET(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const range = searchParams.get('range') || '90d'; // 7d, 30d, 90d, all
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)));

  // Determine cutoff date
  let cutoff = '';
  if (range !== 'all') {
    const days = parseInt(range.replace('d', ''), 10);
    cutoff = new Date(Date.now() - days * 86400000).toISOString();
  }

  // Helper: categorize posts based on text content
  const categorizeSQL = `
    CASE
      WHEN (text LIKE '%AI懶人報%' OR text LIKE '%Podcast%' OR text LIKE '%EP%' OR text LIKE '%懶人報%') AND text NOT LIKE '%不是AI懶人報%' THEN 'podcast_promo'
      WHEN text LIKE '%課程%' OR text LIKE '%割韭菜%' OR text LIKE '%教程%' OR text LIKE '%course%' OR text LIKE '%免費%' OR text LIKE '%開源%' THEN 'resource_share'
      WHEN text LIKE '%接案%' OR text LIKE '%合約%' OR text LIKE '%企業導入%' OR text LIKE '%客戶%' OR text LIKE '%顧問%' OR text LIKE '%合夥%' THEN 'business_work'
      WHEN text LIKE '%倫敦%' OR text LIKE '%台灣%' OR text LIKE '%華南%' OR text LIKE '%買%' OR text LIKE '%網球%' OR text LIKE '%運動%' OR text LIKE '%自由%' OR text LIKE '%思鄉%' THEN 'personal_life'
      WHEN text LIKE '%裁員%' OR text LIKE '%Tesla%' OR text LIKE '%被裁%' OR text LIKE '%一年%' OR text LIKE '%追蹤%' OR text LIKE '%里程碑%' OR text LIKE '%訂閱%' THEN 'personal_story'
      ELSE 'ai_opinion'
    END
  `;

  const whereClause = cutoff ? `WHERE posted_at >= ? AND is_repost = 0` : `WHERE is_repost = 0`;
  const params: unknown[] = cutoff ? [cutoff] : [];

  // ── Category breakdown ──
  const categories = db.prepare(`
    SELECT
      ${categorizeSQL} AS category,
      COUNT(*) AS post_count,
      ROUND(AVG(likes), 1) AS avg_likes,
      ROUND(AVG(replies), 1) AS avg_replies,
      ROUND(AVG(views), 0) AS avg_views,
      ROUND(AVG(engagement_rate) * 100, 2) AS avg_engagement_pct,
      SUM(likes) AS total_likes,
      SUM(replies) AS total_replies
    FROM threads_posts
    ${whereClause}
    GROUP BY category
    ORDER BY avg_likes DESC
  `).all(...params) as CategoryStat[];

  // ── Time series (weekly) ──
  const timeSeries = db.prepare(`
    SELECT
      strftime('%Y-%W', posted_at) AS week,
      COUNT(*) AS post_count,
      ROUND(AVG(likes), 1) AS avg_likes,
      ROUND(AVG(replies), 1) AS avg_replies,
      ROUND(AVG(views), 0) AS avg_views
    FROM threads_posts
    ${whereClause}
    GROUP BY week
    ORDER BY week DESC
    LIMIT 26
  `).all(...params) as TimeSeriesPoint[];

  // ── Top posts by likes ──
  const topPosts = db.prepare(`
    SELECT post_id, substr(text, 1, 200) AS text, views, likes, replies, reposts, engagement_rate, posted_at
    FROM threads_posts
    ${whereClause}
    ORDER BY likes DESC
    LIMIT ?
  `).all(...params, limit) as TopPost[];

  // ── Bottom posts by engagement (but with views > 1000) ──
  const bottomWhere = cutoff
    ? `WHERE posted_at >= ? AND is_repost = 0 AND views > 1000`
    : `WHERE is_repost = 0 AND views > 1000`;
  const bottomParams: unknown[] = cutoff ? [cutoff] : [];

  const bottomPosts = db.prepare(`
    SELECT post_id, substr(text, 1, 200) AS text, views, likes, replies, reposts, engagement_rate, posted_at
    FROM threads_posts
    ${bottomWhere}
    ORDER BY likes ASC
    LIMIT ?
  `).all(...bottomParams, limit) as TopPost[];

  // ── Summary stats ──
  const summary = db.prepare(`
    SELECT
      COUNT(*) AS total_posts,
      ROUND(AVG(likes), 1) AS avg_likes,
      ROUND(AVG(replies), 1) AS avg_replies,
      ROUND(AVG(views), 0) AS avg_views,
      ROUND(AVG(engagement_rate) * 100, 2) AS avg_engagement_pct,
      SUM(likes) AS total_likes,
      SUM(replies) AS total_replies
    FROM threads_posts ${whereClause}
  `).get(...params) as {
    total_posts: number;
    avg_likes: number;
    avg_replies: number;
    avg_views: number;
    avg_engagement_pct: number;
    total_likes: number;
    total_replies: number;
  };

  return NextResponse.json({
    range,
    summary,
    categories,
    time_series: timeSeries,
    top_posts: topPosts,
    bottom_posts: bottomPosts,
  });
}