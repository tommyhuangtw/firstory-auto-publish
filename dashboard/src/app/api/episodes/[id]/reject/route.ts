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
    const { reason } = body as { reason?: string };

    const db = getDb();
    const episode = db.prepare('SELECT status FROM episodes WHERE id = ?').get(episodeId) as { status: string } | undefined;

    if (!episode) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    if (episode.status !== 'pending_review') {
      return NextResponse.json(
        { error: `Cannot reject episode with status: ${episode.status}` },
        { status: 400 }
      );
    }

    db.prepare(
      `UPDATE episodes SET status = 'rejected', description = CASE WHEN ? IS NOT NULL AND ? != '' THEN description || char(10) || '[Rejected: ' || ? || ']' ELSE description END WHERE id = ?`
    ).run(reason, reason, reason, episodeId);

    return NextResponse.json({ message: 'Episode rejected', episodeId });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
