import { NextResponse } from 'next/server';
import { backfillEmbeddings } from '@/services/voice/embeddings';

/** Backfill embeddings for any posts/stories missing them. */
export async function POST() {
  try {
    const result = await backfillEmbeddings();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
