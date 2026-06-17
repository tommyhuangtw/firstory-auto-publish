import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:trends-draft');

interface PostRow {
  id: number;
  text: string;
  author: string | null;
  like_count: number;
  reply_count: number;
  velocity: number;
  posted_at: string | null;
  permalink: string | null;
}

/**
 * Generate a 蹭點 draft ON DEMAND for one scraped post, optionally weaving in Tommy's
 * own opinion. Creates a trend_topic + trend_draft linked back to the source post.
 * Body: { postId: number, opinion?: string }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const postId = parseInt(body.postId, 10);
  const opinion: string | undefined = typeof body.opinion === 'string' && body.opinion.trim() ? body.opinion : undefined;
  if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 });

  const db = getDb();
  const post = db.prepare('SELECT * FROM trend_posts WHERE id = ?').get(postId) as PostRow | undefined;
  if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 });

  const { assessAndDraft } = await import('@/services/trends/draftGenerator');
  const { velocityToHeat } = await import('@/services/trends/scorer');
  const heat = velocityToHeat(post.velocity || 0);

  try {
    const a = await assessAndDraft([{
      text: post.text,
      likeCount: post.like_count,
      replyCount: post.reply_count,
      timestamp: post.posted_at ?? undefined,
      permalink: post.permalink ?? undefined,
      author: post.author ?? undefined,
    }], heat, opinion);

    const samplePosts = JSON.stringify([{
      text: post.text.slice(0, 280), likes: post.like_count, replies: post.reply_count,
      ts: post.posted_at, velocity: Math.round(post.velocity || 0), permalink: post.permalink, author: post.author,
    }]);

    const t = db.prepare(`
      INSERT INTO trend_topics
        (topic, heat_score, rideability, risk_level, risk_reason, sample_posts, post_count, top_velocity, status)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'drafted')
    `).run(a.topic, heat, a.rideability, a.riskLevel, a.riskReason, samplePosts, Math.round(post.velocity || 0));
    const topicId = Number(t.lastInsertRowid);

    const d = db.prepare(`
      INSERT INTO trend_drafts (topic_id, draft_text, format_suggestion, format_reason, char_count, status)
      VALUES (?, ?, ?, ?, ?, 'pending_review')
    `).run(topicId, a.draftText, a.formatSuggestion, a.formatReason, a.draftText.length);

    db.prepare('UPDATE trend_posts SET topic_id = ?, topic = ? WHERE id = ?').run(topicId, a.topic, post.id);

    log.info({ postId, topic: a.topic, withOpinion: !!opinion }, 'On-demand draft generated');
    return NextResponse.json({
      draftId: Number(d.lastInsertRowid), topic: a.topic, draft_text: a.draftText,
      rideability: a.rideability, risk_level: a.riskLevel, format_suggestion: a.formatSuggestion,
    });
  } catch (err) {
    log.error({ postId, err: (err as Error).message }, 'Draft generation failed');
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
