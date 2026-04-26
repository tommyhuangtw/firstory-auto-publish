import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { regenerateIgCaption } from '@/services/pipeline/nodes/notify';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:regenerate-ig');

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const episodeNumber = parseInt(id);
    if (isNaN(episodeNumber)) {
      return NextResponse.json({ error: 'Invalid episode number' }, { status: 400 });
    }

    const db = getDb();
    const episode = db.prepare(
      'SELECT segment_type, source_videos, script_summary FROM episodes WHERE episode_number = ?'
    ).get(episodeNumber) as { segment_type: string; source_videos: string | null; script_summary: string | null } | undefined;

    if (!episode) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    // Get igScenario from pipeline snapshot if available
    const pipelineRun = db.prepare(
      'SELECT id FROM pipeline_runs WHERE episode_number = ? ORDER BY id DESC LIMIT 1'
    ).get(episodeNumber) as { id: number } | undefined;

    let igScenario = '';
    if (pipelineRun) {
      const coverSnapshot = db.prepare(
        `SELECT output_data FROM pipeline_snapshots
         WHERE pipeline_run_id = ? AND stage = 'generateCover'
         ORDER BY id DESC LIMIT 1`
      ).get(pipelineRun.id) as { output_data: string } | undefined;

      if (coverSnapshot) {
        try {
          const data = JSON.parse(coverSnapshot.output_data);
          igScenario = data.igScenario || '';
        } catch { /* skip */ }
      }
    }

    // Parse source videos for summary
    const sourceVideos: { title: string; viewCount: number }[] = [];
    if (episode.source_videos) {
      try {
        const parsed = JSON.parse(episode.source_videos);
        for (const v of parsed) {
          sourceVideos.push({
            title: v.title || '',
            viewCount: v.viewCount || v.view_count || 0,
          });
        }
      } catch { /* skip */ }
    }

    log.info({ episodeNumber, segmentType: episode.segment_type }, 'Regenerating IG caption');

    const igCaption = await regenerateIgCaption(
      episode.segment_type,
      igScenario,
      sourceVideos,
      episodeNumber,
      episode.script_summary || undefined,
    );

    db.prepare('UPDATE episodes SET ig_caption = ? WHERE episode_number = ?')
      .run(igCaption, episodeNumber);

    log.info({ episodeNumber, captionLength: igCaption.length }, 'IG caption regenerated');

    return NextResponse.json({ igCaption });
  } catch (error) {
    log.error({ error: (error as Error).message }, 'IG caption regeneration failed');
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
