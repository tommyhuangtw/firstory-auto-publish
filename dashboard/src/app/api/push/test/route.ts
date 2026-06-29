import { NextResponse } from 'next/server';
import { sendPushToAll, isPushConfigured } from '@/services/webPush';

// Fire a test push to all subscribed devices — used by the "測試推播" button.
export async function POST() {
  if (!isPushConfigured()) {
    return NextResponse.json({ error: 'push not configured (no VAPID keys)' }, { status: 503 });
  }
  const result = await sendPushToAll({
    title: '🔔 測試推播',
    body: 'iPhone 推播設定成功！pipeline 有事就會這樣通知你。',
    url: '/episodes',
    tag: 'test',
  });
  return NextResponse.json({ ok: true, ...result });
}
