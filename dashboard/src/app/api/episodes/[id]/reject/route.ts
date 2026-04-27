import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const episodeId = parseInt(id);
    if (isNaN(episodeId)) {
      return NextResponse.json({ error: 'Invalid episode id' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const { reason, resetToReview } = body as { reason?: string; resetToReview?: boolean };

    const db = getDb();
    const episode = db.prepare('SELECT status FROM episodes WHERE id = ?').get(episodeId) as { status: string } | undefined;

    if (!episode) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    const allowedStatuses = ['pending_review', 'publishing', 'approved'];
    if (!allowedStatuses.includes(episode.status)) {
      return NextResponse.json(
        { error: `Cannot reject episode with status: ${episode.status}` },
        { status: 400 }
      );
    }

    // resetToReview: go back to pending_review (e.g. stop a stuck publish)
    // otherwise: reject the episode
    const newStatus = resetToReview ? 'pending_review' : 'rejected';

    db.prepare(
      `UPDATE episodes SET status = ?, description = CASE WHEN ? IS NOT NULL AND ? != '' THEN description || char(10) || '[' || ? || ': ' || ? || ']' ELSE description END WHERE id = ?`
    ).run(newStatus, reason, reason, resetToReview ? 'Reset' : 'Rejected', reason, episodeId);

    return NextResponse.json({ message: resetToReview ? 'Episode reset to review' : 'Episode rejected', episodeId });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
