import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { generateCover } from '@/services/pipeline/nodes/generateCover';
import { createChildLogger } from '@/lib/logger';
import type { PipelineState } from '@/services/pipeline/state';

const log = createChildLogger('api:regenerate-cover');

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const episodeId = parseInt(id);
    if (isNaN(episodeId)) {
      return NextResponse.json({ error: 'Invalid episode id' }, { status: 400 });
    }

    const db = getDb();
    const episode = db.prepare(
      'SELECT id, episode_number, segment_type, selected_title, source_videos, script_summary FROM episodes WHERE id = ?'
    ).get(episodeId) as {
      id: number;
      episode_number: number | null;
      segment_type: string;
      selected_title: string | null;
      source_videos: string | null;
      script_summary: string | null;
    } | undefined;

    if (!episode) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    // Parse source videos for first video title
    let selectedVideos: { title: string; viewCount: number }[] = [];
    if (episode.source_videos) {
      try {
        const parsed = JSON.parse(episode.source_videos);
        selectedVideos = parsed.map((v: Record<string, unknown>) => ({
          title: (v.title as string) || '',
          viewCount: (v.viewCount as number) || (v.view_count as number) || 0,
        }));
      } catch { /* skip */ }
    }

    log.info({ episodeId, segmentType: episode.segment_type }, 'Regenerating cover image');

    // Build minimal PipelineState for generateCover
    const minimalState = {
      episodeId: episode.id,
      episodeNumber: episode.episode_number,
      segmentType: episode.segment_type,
      selectedTitle: episode.selected_title || '',
      selectedVideos,
      scriptSummary: episode.script_summary || '',
    } as PipelineState;

    const result = await generateCover(minimalState);

    // Append to cover_candidates and set as active cover
    const row = db.prepare('SELECT cover_candidates FROM episodes WHERE id = ?').get(episodeId) as { cover_candidates: string | null } | undefined;
    const candidates: { path: string; url: string; createdAt: string; source: string }[] = row?.cover_candidates ? JSON.parse(row.cover_candidates) : [];
    if (result.coverPath) {
      candidates.push({
        path: result.coverPath,
        url: result.coverUrl || '',
        createdAt: new Date().toISOString(),
        source: 'generated',
      });
    }

    db.prepare('UPDATE episodes SET cover_path = ?, cover_url = ?, cover_candidates = ? WHERE id = ?')
      .run(result.coverPath || null, result.coverUrl || null, JSON.stringify(candidates), episodeId);

    log.info({ episodeId, coverUrl: result.coverUrl, totalCandidates: candidates.length }, 'Cover image regenerated');

    return NextResponse.json({
      coverPath: result.coverPath,
      coverUrl: result.coverUrl,
      igScenario: result.igScenario,
      candidates,
    });
  } catch (error) {
    log.error({ error: (error as Error).message }, 'Cover regeneration failed');
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
