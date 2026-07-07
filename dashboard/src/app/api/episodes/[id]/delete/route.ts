import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import fs from 'fs';

const log = createChildLogger('api:episode-delete');

export async function DELETE(
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
      'SELECT id, status, audio_path, cover_path FROM episodes WHERE id = ?'
    ).get(episodeId) as { id: number; status: string; audio_path: string | null; cover_path: string | null } | undefined;

    if (!episode) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    if (episode.status === 'published') {
      return NextResponse.json(
        { error: '已發布的集數不可刪除。請先從 podcast 平台下架。' },
        { status: 403 }
      );
    }

    // Cascade delete related records
    const tx = db.transaction(() => {
      // Delete snapshots first (FK → pipeline_runs)
      db.prepare(
        'DELETE FROM pipeline_snapshots WHERE pipeline_run_id IN (SELECT id FROM pipeline_runs WHERE episode_id = ?)'
      ).run(episodeId);
      db.prepare('DELETE FROM episode_tool_mentions WHERE episode_id = ?').run(episodeId);
      db.prepare('DELETE FROM llm_calls WHERE episode_id = ?').run(episodeId);
      db.prepare('DELETE FROM service_costs WHERE episode_id = ?').run(episodeId);
      // Other tables with a FK → episodes.id (would otherwise fail the constraint).
      db.prepare('DELETE FROM episode_digests WHERE episode_id = ?').run(episodeId);
      db.prepare('DELETE FROM episode_themes WHERE episode_id = ?').run(episodeId);
      db.prepare('DELETE FROM substack_drafts WHERE episode_id = ?').run(episodeId);
      db.prepare('DELETE FROM pipeline_runs WHERE episode_id = ?').run(episodeId);
      db.prepare('DELETE FROM episodes WHERE id = ?').run(episodeId);
    });
    tx();

    // Clean up local files if they exist
    for (const filePath of [episode.audio_path, episode.cover_path]) {
      if (filePath) {
        try { fs.unlinkSync(filePath); } catch { /* file may not exist */ }
      }
    }

    log.info({ episodeId, status: episode.status }, 'Episode deleted');

    return NextResponse.json({ deleted: episodeId });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
