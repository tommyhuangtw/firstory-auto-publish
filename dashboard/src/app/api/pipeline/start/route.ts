import { NextRequest, NextResponse } from 'next/server';
import { startPipeline } from '@/services/pipeline/graph';
import { getDb } from '@/db';
import type { SegmentType } from '@/services/pipeline/state';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { episodeNumber, segmentType } = body as {
      episodeNumber: number;
      segmentType: SegmentType;
    };

    if (!episodeNumber || !segmentType) {
      return NextResponse.json(
        { error: 'episodeNumber and segmentType are required' },
        { status: 400 }
      );
    }

    if (!['daily', 'weekly', 'robot'].includes(segmentType)) {
      return NextResponse.json(
        { error: 'segmentType must be daily, weekly, or robot' },
        { status: 400 }
      );
    }

    // Create pipeline_run + episode records first, then fire-and-forget
    const db = getDb();

    const result = db.prepare(
      `INSERT INTO pipeline_runs (episode_number, segment_type, status, current_stage)
       VALUES (?, ?, 'running', 'fetchYoutube')`
    ).run(episodeNumber, segmentType);
    const pipelineRunId = Number(result.lastInsertRowid);

    db.prepare(
      `INSERT OR IGNORE INTO episodes (episode_number, segment_type, status)
       VALUES (?, ?, 'generating')`
    ).run(episodeNumber, segmentType);

    // Fire-and-forget: don't await
    startPipeline(episodeNumber, segmentType, pipelineRunId).catch(() => {
      // Error handling is inside startPipeline (updates DB)
    });

    return NextResponse.json({
      message: 'Pipeline started',
      pipelineRunId,
      episodeNumber,
      segmentType,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
