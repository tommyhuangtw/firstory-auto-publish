import { NextRequest, NextResponse } from 'next/server';
import { startPipeline } from '@/services/pipeline/graph';
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

    // Start pipeline (runs async, returns immediately with run ID)
    const { pipelineRunId } = await startPipeline(episodeNumber, segmentType);

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
