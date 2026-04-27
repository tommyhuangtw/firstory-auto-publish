import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { generateHeadlines } from '@/services/shortsPipeline';

export async function POST(request: NextRequest) {
  try {
    const { shortsId, selectedBeatIndex } = await request.json() as {
      shortsId: number;
      selectedBeatIndex: number;
    };
    if (!shortsId || selectedBeatIndex == null) {
      return NextResponse.json({ error: 'shortsId and selectedBeatIndex are required' }, { status: 400 });
    }

    const db = getDb();
    const shorts = db.prepare('SELECT beats_json FROM shorts WHERE id = ?').get(shortsId) as
      { beats_json: string } | undefined;
    if (!shorts) {
      return NextResponse.json({ error: 'Shorts not found' }, { status: 404 });
    }

    const beats = JSON.parse(shorts.beats_json);
    if (selectedBeatIndex < 0 || selectedBeatIndex >= beats.length) {
      return NextResponse.json({ error: 'Invalid beat index' }, { status: 400 });
    }

    const selectedBeat = beats[selectedBeatIndex];
    const headlines = await generateHeadlines(selectedBeat);

    db.prepare(
      `UPDATE shorts SET status = 'headline_ready', selected_beat_index = ?, headlines_json = ? WHERE id = ?`
    ).run(selectedBeatIndex, JSON.stringify(headlines), shortsId);

    return NextResponse.json({ headlines });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
