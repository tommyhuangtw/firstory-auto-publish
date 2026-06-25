import { NextResponse } from 'next/server';
import { generateAllAssets } from '@/services/voice/assets';
import { isRunning, setRunning, recordLastRun } from '@/services/voice/status';
import { getDb } from '@/db';

/** Regenerate voice assets from the corpus (fire-and-forget; poll /api/voice/sync GET). */
export async function POST() {
  const count = (getDb().prepare('SELECT COUNT(*) c FROM threads_posts').get() as { c: number }).c;
  if (count === 0) {
    return NextResponse.json({ error: '尚無語料,請先同步 Threads 貼文' }, { status: 400 });
  }
  if (isRunning('generate')) {
    return NextResponse.json({ error: '資產生成已在進行中' }, { status: 409 });
  }

  setRunning('generate', true);
  generateAllAssets()
    .then((r) => recordLastRun('generate', r))
    .catch((e: Error) => recordLastRun('generate', { error: e.message }))
    .finally(() => setRunning('generate', false));

  return NextResponse.json({ started: true });
}
