import { NextRequest, NextResponse } from 'next/server';
import { retryFromStage } from '@/services/pipeline/graph';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pipelineRunId, fromStage, stateOverrides } = body as {
      pipelineRunId: number;
      fromStage: string;
      stateOverrides?: Record<string, unknown>;
    };

    if (!pipelineRunId || !fromStage) {
      return NextResponse.json(
        { error: 'pipelineRunId and fromStage are required' },
        { status: 400 }
      );
    }

    // Fire-and-forget
    retryFromStage(pipelineRunId, fromStage, stateOverrides).catch(() => {
      // Error handling is inside retryFromStage (updates DB)
    });

    return NextResponse.json({
      message: `Retry started from ${fromStage}`,
      pipelineRunId,
      fromStage,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
