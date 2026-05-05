import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function POST(request: NextRequest) {
  try {
    const { shortsId } = await request.json() as { shortsId: number };
    if (!shortsId) {
      return NextResponse.json({ error: 'shortsId is required' }, { status: 400 });
    }

    const db = getDb();
    const shorts = db.prepare(
      `SELECT s.episode_id, s.beats_json, s.selected_beat_index,
              s.headlines_json, s.selected_headline_index, s.episode_number,
              e.selected_title, e.segment_type
       FROM shorts s
       JOIN episodes e ON e.id = s.episode_id
       WHERE s.id = ?`
    ).get(shortsId) as {
      episode_id: number;
      beats_json: string;
      selected_beat_index: number;
      headlines_json: string;
      selected_headline_index: number;
      episode_number: number;
      selected_title: string | null;
      segment_type: string;
    } | undefined;

    if (!shorts) {
      return NextResponse.json({ error: 'Shorts not found' }, { status: 404 });
    }

    const beats = JSON.parse(shorts.beats_json);
    const selectedBeat = beats[shorts.selected_beat_index];
    const headlines = JSON.parse(shorts.headlines_json);
    const coverHeadline = headlines[shorts.selected_headline_index];

    // Dynamic import to avoid bundling issues
    const { generateShortsIgCaption } = await import('@/services/shortsPipeline');

    const igCaption = await generateShortsIgCaption({
      episodeId: shorts.episode_id,
      episodeTitle: shorts.selected_title || '',
      episodeNumber: shorts.episode_number,
      beatText: selectedBeat.text,
      coverHeadline,
      segmentType: shorts.segment_type,
    });

    db.prepare('UPDATE shorts SET ig_caption = ? WHERE id = ?').run(igCaption, shortsId);

    return NextResponse.json({ igCaption });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
