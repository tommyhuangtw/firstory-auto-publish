import { NextResponse } from 'next/server';
import { isThreadsConnected } from '@/services/threads';
import { syncThreadsPosts } from '@/services/voice/sync';
import { isRunning, setRunning, recordLastRun, getVoiceStatus } from '@/services/voice/status';

/** Current sync/generate status (for polling). */
export async function GET() {
  return NextResponse.json(getVoiceStatus());
}

/** Trigger a Threads sync (fire-and-forget; poll GET for completion). */
export async function POST() {
  if (!isThreadsConnected()) {
    return NextResponse.json({ error: 'Threads 尚未連結' }, { status: 400 });
  }
  if (isRunning('sync')) {
    return NextResponse.json({ error: '同步已在進行中' }, { status: 409 });
  }

  setRunning('sync', true);
  syncThreadsPosts()
    .then((r) => recordLastRun('sync', r))
    .catch((e: Error) => recordLastRun('sync', { error: e.message }))
    .finally(() => setRunning('sync', false));

  return NextResponse.json({ started: true });
}
