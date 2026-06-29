import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { draftResource } from '@/services/resources/draft';
import type { ScoredResource } from '@/services/resources/types';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const row = db.prepare('SELECT * FROM curated_resources WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });

  let highlights: string[] = [];
  try { highlights = JSON.parse(String(row.ai_highlights ?? '[]')); } catch { highlights = []; }

  const r: ScoredResource = {
    guid: String(row.guid),
    contentType: row.content_type as ScoredResource['contentType'],
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    url: String(row.url ?? ''),
    author: String(row.author ?? ''),
    source: String(row.source ?? ''),
    stars: row.stars != null ? Number(row.stars) : undefined,
    starVelocity: row.star_velocity != null ? Number(row.star_velocity) : undefined,
    socialBuzz: Number(row.social_buzz ?? 0),
    freshnessScore: Number(row.freshness_score ?? 0),
    freshnessReason: String(row.freshness_reason ?? ''),
    aiScore: Number(row.ai_score ?? 0),
    aiSummary: String(row.ai_summary ?? ''),
    aiReasoning: String(row.ai_reasoning ?? ''),
    aiHighlights: highlights,
    aiAngle: String(row.ai_angle ?? ''),
    worthSharing: true,
  };

  try {
    const d = await draftResource(r);
    const draftId = Number(
      db.prepare("INSERT INTO resource_drafts (resource_guid, draft_text, viral_score, status) VALUES (?, ?, ?, 'seen')")
        .run(r.guid, d.draftText, d.viralScore).lastInsertRowid,
    );
    return NextResponse.json({ draftId, draftText: d.draftText, viralScore: d.viralScore });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
