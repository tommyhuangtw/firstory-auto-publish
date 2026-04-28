import { NextResponse } from 'next/server';
import { getDb } from '@/db';

/**
 * GET /api/auth/facebook/status
 * Returns current Facebook Page connection status.
 */
export async function GET() {
  const db = getDb();
  const getSetting = (key: string): string | undefined => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  };

  const pageId = getSetting('fb_page_id');
  const pageName = getSetting('fb_page_name');

  if (!pageId) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    pageId,
    pageName: pageName || 'Unknown Page',
  });
}

/**
 * DELETE /api/auth/facebook/status
 * Disconnects Facebook Page by removing stored credentials.
 */
export async function DELETE() {
  const db = getDb();
  const keys = ['fb_page_id', 'fb_page_access_token', 'fb_page_name', 'fb_pages_list'];
  const del = db.prepare('DELETE FROM settings WHERE key = ?');
  for (const key of keys) {
    del.run(key);
  }

  return NextResponse.json({ disconnected: true });
}
