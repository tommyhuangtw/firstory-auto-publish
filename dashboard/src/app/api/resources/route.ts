import { NextResponse } from 'next/server';
import { getDb } from '@/db';

const FIELDS = `r.id, r.guid, r.content_type, r.title, r.description, r.url, r.author, r.published_at, r.stars,
  r.likes, r.comments, r.reposts, r.star_velocity, r.freshness_reason, r.freshness_score, r.status,
  r.ai_score, r.ai_summary, r.ai_highlights`;

export async function GET() {
  const db = getDb();

  // 已 surface 的精選（有 AI 重點 + 草稿）。
  const surfaced = db.prepare(`
    SELECT ${FIELDS}, d.id AS draft_id, d.draft_text, d.viral_score
    FROM curated_resources r
    LEFT JOIN resource_drafts d ON d.id = (
      SELECT id FROM resource_drafts WHERE resource_guid = r.guid AND status != 'dismissed' ORDER BY id DESC LIMIT 1
    )
    WHERE r.status = 'surfaced'
    ORDER BY r.last_surfaced_at DESC
    LIMIT 100
  `).all() as Array<{ id: number; content_type: string }>;

  // 每個來源保留「最新爬出來的 5 篇」，即使沒過爆衝門檻 — 頁面永遠不空、看得到最新動態。
  const latestPerSource = db.prepare(`
    SELECT ${FIELDS}, NULL AS draft_id, NULL AS draft_text, NULL AS viral_score
    FROM curated_resources r
    WHERE r.content_type = ? AND r.status != 'dismissed'
    ORDER BY r.published_at DESC
    LIMIT 5
  `);

  const seen = new Set(surfaced.map((r) => r.id));
  const fill: Array<{ id: number }> = [];
  for (const src of ['github', 'x']) {
    for (const row of latestPerSource.all(src) as Array<{ id: number }>) {
      if (!seen.has(row.id)) { seen.add(row.id); fill.push(row); }
    }
  }

  return NextResponse.json({ resources: [...surfaced, ...fill] });
}
