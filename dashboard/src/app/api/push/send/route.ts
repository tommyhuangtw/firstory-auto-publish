import { NextRequest, NextResponse } from 'next/server';
import { sendPushToAll, isPushConfigured } from '@/services/webPush';

// Internal endpoint for non-Next processes (e.g. the agent 老闆快報) to fire a push.
// Protected by a shared secret so it isn't publicly callable through the tunnel.
export async function POST(request: NextRequest) {
  const secret = process.env.PUSH_INTERNAL_SECRET;
  if (secret && request.headers.get('x-push-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isPushConfigured()) {
    return NextResponse.json({ error: 'push not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => null) as
    | { title?: string; body?: string; url?: string; tag?: string }
    | null;
  if (!body?.title || !body?.body) {
    return NextResponse.json({ error: 'title and body required' }, { status: 400 });
  }

  const result = await sendPushToAll({
    title: body.title,
    body: body.body,
    url: body.url || '/',
    tag: body.tag,
  });
  return NextResponse.json({ ok: true, ...result });
}
