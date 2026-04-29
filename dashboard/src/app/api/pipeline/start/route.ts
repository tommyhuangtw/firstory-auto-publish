import { NextRequest, NextResponse } from 'next/server';
import { startPipeline } from '@/services/pipeline/graph';
import { getDb } from '@/db';
import type { SegmentType } from '@/services/pipeline/state';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { segmentType, manualVideoUrls } = body as {
      segmentType: SegmentType;
      manualVideoUrls?: string[];
    };

    if (!segmentType) {
      return NextResponse.json(
        { error: 'segmentType is required' },
        { status: 400 }
      );
    }

    if (!['daily', 'weekly', 'robot', 'sysdesign'].includes(segmentType)) {
      return NextResponse.json(
        { error: 'segmentType must be daily, weekly, robot, or sysdesign' },
        { status: 400 }
      );
    }

    if (segmentType === 'sysdesign') {
      if (!manualVideoUrls?.length) {
        return NextResponse.json(
          { error: 'sysdesign requires at least one YouTube URL' },
          { status: 400 }
        );
      }
    }

    const db = getDb();

    // Guard: prevent duplicate running pipeline for same segment type
    const running = db.prepare(
      `SELECT id FROM pipeline_runs
       WHERE segment_type = ? AND status = 'running'`
    ).get(segmentType) as { id: number } | undefined;

    if (running) {
      return NextResponse.json(
        { error: `${segmentType} 已有正在執行的 pipeline (run #${running.id})` },
        { status: 409 }
      );
    }

    // Create episode record (no episode_number yet — assigned at publish)
    const epResult = db.prepare(
      `INSERT INTO episodes (segment_type, status) VALUES (?, 'generating')`
    ).run(segmentType);
    const episodeId = Number(epResult.lastInsertRowid);

    // Create pipeline run
    const runResult = db.prepare(
      `INSERT INTO pipeline_runs (episode_id, segment_type, status, current_stage)
       VALUES (?, ?, 'running', 'fetchYoutube')`
    ).run(episodeId, segmentType);
    const pipelineRunId = Number(runResult.lastInsertRowid);

    // Fire-and-forget: don't await — send email on failure
    startPipeline(episodeId, segmentType, pipelineRunId, {
      manualVideoUrls: manualVideoUrls || [],
    }).catch(async (error) => {
      // DB is already updated by startPipeline; send email notification
      try {
        const { getGmailService } = await import('@/services/gmail');
        const gmail = getGmailService();

        const failedRun = getDb().prepare(
          'SELECT current_stage FROM pipeline_runs WHERE id = ?'
        ).get(pipelineRunId) as { current_stage: string | null } | undefined;

        await gmail.sendPipelineNotification({
          episodeNumber: episodeId,
          segmentType,
          failedStage: failedRun?.current_stage || null,
          errorMessage: (error as Error).message,
          type: 'failure',
        });
      } catch {
        // Email is best-effort; pipeline error already logged
      }
    });

    return NextResponse.json({
      message: 'Pipeline started',
      pipelineRunId,
      episodeId,
      segmentType,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
