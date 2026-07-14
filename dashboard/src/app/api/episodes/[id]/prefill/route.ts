import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

// Returns the manual inputs used to generate an episode, for「複製設定重新生成」prefill.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getDb().prepare(
    'SELECT segment_type, generation_input FROM episodes WHERE id = ?'
  ).get(id) as { segment_type: string; generation_input: string | null } | undefined;

  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });

  let input: { manualVideoUrls?: string[]; customInstructions?: string; episodeLength?: number | null } = {};
  if (row.generation_input) {
    try { input = JSON.parse(row.generation_input); } catch { /* ignore malformed */ }
  }

  return NextResponse.json({
    segmentType: row.segment_type,
    manualVideoUrls: input.manualVideoUrls || [],
    customInstructions: input.customInstructions || '',
  });
}
