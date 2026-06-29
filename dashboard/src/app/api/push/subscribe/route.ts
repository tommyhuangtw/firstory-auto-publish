import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

// Save (upsert) a device's push subscription.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { subscription?: BrowserSubscription } | null;
  const sub = body?.subscription;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ error: 'invalid subscription' }, { status: 400 });
  }

  const userAgent = request.headers.get('user-agent') || '';
  const db = getDb();
  db.prepare(`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent, enabled)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(endpoint) DO UPDATE SET
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = excluded.user_agent,
      enabled = 1
  `).run(sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent);

  return NextResponse.json({ ok: true });
}

// Remove a device's subscription (on unsubscribe).
export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => null) as { endpoint?: string } | null;
  if (!body?.endpoint) {
    return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
  }
  const db = getDb();
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(body.endpoint);
  return NextResponse.json({ ok: true });
}
