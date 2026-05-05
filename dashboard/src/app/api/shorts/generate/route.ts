import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { runShortsGeneration } from '@/services/shortsPipeline';

export async function POST(request: NextRequest) {
  try {
    const { shortsId, selectedHeadlineIndex, customHeadline } = await request.json() as {
      shortsId: number;
      selectedHeadlineIndex: number;
      customHeadline?: string;
    };
    if (!shortsId || selectedHeadlineIndex == null) {
      return NextResponse.json({ error: 'shortsId and selectedHeadlineIndex are required' }, { status: 400 });
    }

    const db = getDb();
    const shorts = db.prepare('SELECT status, headlines_json FROM shorts WHERE id = ?').get(shortsId) as
      { status: string; headlines_json: string } | undefined;
    if (!shorts) {
      return NextResponse.json({ error: 'Shorts not found' }, { status: 404 });
    }

    if (shorts.status === 'generating') {
      return NextResponse.json({ error: 'Pipeline already running' }, { status: 409 });
    }

    const headlines = JSON.parse(shorts.headlines_json);
    if (selectedHeadlineIndex < 0 || selectedHeadlineIndex >= headlines.length) {
      return NextResponse.json({ error: 'Invalid headline index' }, { status: 400 });
    }

    // If user edited the headline, update it in the array
    if (customHeadline && customHeadline.trim()) {
      headlines[selectedHeadlineIndex] = customHeadline.trim();
      db.prepare('UPDATE shorts SET headlines_json = ? WHERE id = ?')
        .run(JSON.stringify(headlines), shortsId);
    }

    db.prepare(
      `UPDATE shorts SET selected_headline_index = ?, status = 'generating' WHERE id = ?`
    ).run(selectedHeadlineIndex, shortsId);

    // Fire-and-forget
    runShortsGeneration(shortsId).catch(() => {
      // Error handling is inside runShortsGeneration (updates DB)
    });

    return NextResponse.json({ message: 'Pipeline started', shortsId });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
