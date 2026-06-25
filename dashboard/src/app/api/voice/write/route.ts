import { NextRequest, NextResponse } from 'next/server';
import { writeThreadsPost, type WriteRequest } from '@/services/voice/writer';

/** Generate a Threads draft in the user's voice. */
export async function POST(req: NextRequest) {
  const body = await req.json() as Partial<WriteRequest>;
  const mode = body.mode === 'autonomous' ? 'autonomous' : 'rewrite';
  const idea = typeof body.idea === 'string' ? body.idea : '';
  const useStories = !!body.useStories;
  const viral = !!body.viral;

  if (mode === 'rewrite' && !idea.trim()) {
    return NextResponse.json({ error: '請先輸入你的想法' }, { status: 400 });
  }

  try {
    const result = await writeThreadsPost({ mode, idea, useStories, viral });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
