import { NextResponse } from 'next/server';
import { getDb } from '@/db';

/**
 * GET /api/auth/threads/status
 * Returns current Threads connection status.
 */
export async function GET() {
  const db = getDb();
  const getSetting = (key: string): string | undefined => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  };

  const userId = getSetting('threads_user_id');
  const username = getSetting('threads_username');

  if (!userId) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    userId,
    username: username || 'Unknown',
  });
}

/**
 * DELETE /api/auth/threads/status
 * Disconnects Threads by removing stored credentials.
 */
export async function DELETE() {
  const db = getDb();
  const keys = ['threads_user_id', 'threads_access_token', 'threads_username'];
  const del = db.prepare('DELETE FROM settings WHERE key = ?');
  for (const key of keys) {
    del.run(key);
  }

  return NextResponse.json({ disconnected: true });
}
