import { NextRequest, NextResponse } from 'next/server';
import { cleanupOldAudioFiles, RETENTION_DAYS } from '@/services/audioRetention';

/**
 * Manually trigger old-audio cleanup. Same logic the weekly scheduler job runs.
 * Body: { olderThanDays?: number }  (defaults to RETENTION_DAYS)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const olderThanDays =
      typeof body.olderThanDays === 'number' ? body.olderThanDays : RETENTION_DAYS;

    const result = await cleanupOldAudioFiles({ olderThanDays });
    return NextResponse.json({
      ...result,
      freedMB: Math.round((result.freedBytes / 1024 / 1024) * 10) / 10,
      olderThanDays,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
