import { NextResponse } from 'next/server';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:trends-digest');

/** Send the Telegram digest of pending trend drafts. */
export async function POST() {
  try {
    // Drafts are on-demand now → push a summary of the fresh hot posts instead.
    const { sendHotPostsNote } = await import('@/services/trends/digest');
    const result = await sendHotPostsNote();
    return NextResponse.json(result);
  } catch (error) {
    log.error({ err: (error as Error).message }, 'Digest send failed');
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
