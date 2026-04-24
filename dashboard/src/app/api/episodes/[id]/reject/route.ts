import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const episodeNumber = parseInt(id);
    if (isNaN(episodeNumber)) {
      return NextResponse.json({ error: 'Invalid episode number' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const { reason } = body as { reason?: string };

    const db = getDb();
    const episode = db.prepare('SELECT status FROM episodes WHERE episode_number = ?').get(episodeNumber) as { status: string } | undefined;

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
      `UPDATE episodes SET status = 'rejected', description = CASE WHEN ? IS NOT NULL AND ? != '' THEN description || char(10) || '[Rejected: ' || ? || ']' ELSE description END WHERE episode_number = ?`
    ).run(reason, reason, reason, episodeNumber);

    return NextResponse.json({ message: 'Episode rejected', episodeNumber });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
