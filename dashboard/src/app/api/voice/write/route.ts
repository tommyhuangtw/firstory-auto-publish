import { NextRequest, NextResponse } from 'next/server';
import { writeThreadsPost, writeBestOfN, type WriteRequest } from '@/services/voice/writer';

/**
 * Generate a Threads draft in the user's voice.
 *
 * - default: single draft.
 * - { bestOf: N }: generate N drafts, score each with the like-predictor, and
 *   return the highest-scoring one + ranked candidates (the agent self-tune loop).
 */
export async function POST(req: NextRequest) {
  const body = await req.json() as Partial<WriteRequest> & { bestOf?: number };
  const mode = body.mode === 'autonomous' ? 'autonomous' : 'rewrite';
  const idea = typeof body.idea === 'string' ? body.idea : '';
  const useStories = !!body.useStories;
  const viral = !!body.viral;
  const bestOf = typeof body.bestOf === 'number' ? body.bestOf : 0;

  if (mode === 'rewrite' && !idea.trim()) {
    return NextResponse.json({ error: '請先輸入你的想法' }, { status: 400 });
  }

  try {
    const reqObj: WriteRequest = { mode, idea, useStories, viral };
    if (bestOf && bestOf > 1) {
      const result = await writeBestOfN(reqObj, bestOf);
      return NextResponse.json(result);
    }
    const result = await writeThreadsPost(reqObj);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
