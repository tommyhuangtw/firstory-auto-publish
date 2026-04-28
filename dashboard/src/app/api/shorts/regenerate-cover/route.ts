import { NextRequest, NextResponse } from 'next/server';
import { regenerateCover } from '@/services/shortsPipeline';

export async function POST(request: NextRequest) {
  try {
    const { shortsId, headline, headlineY } = await request.json() as {
      shortsId: number;
      headline: string;
      headlineY?: number;
    };
    if (!shortsId || !headline?.trim()) {
      return NextResponse.json({ error: 'shortsId and headline are required' }, { status: 400 });
    }

    const coverPath = await regenerateCover(shortsId, headline.trim(), headlineY);
    return NextResponse.json({ coverPath });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
