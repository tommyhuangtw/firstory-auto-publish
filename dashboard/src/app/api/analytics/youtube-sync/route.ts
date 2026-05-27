import { NextResponse } from 'next/server';
import { syncYoutubeAnalytics } from '@/services/youtubeAnalytics';
import { getDb } from '@/db';

export async function POST() {
  try {
    const result = await syncYoutubeAnalytics();
    return NextResponse.json({
      success: !result.error,
      ...result,
      synced_at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}

export async function GET() {
  const db = getDb();

  const latestChannel = db.prepare(
    'SELECT snapshot_date, subscriber_count, view_count, video_count FROM youtube_channel_stats ORDER BY snapshot_date DESC LIMIT 1'
  ).get() as { snapshot_date: string; subscriber_count: number; view_count: number; video_count: number } | undefined;

  const videoCount = (db.prepare(
    'SELECT COUNT(DISTINCT video_id) as count FROM youtube_video_stats'
  ).get() as { count: number }).count;

  const snapshotCount = (db.prepare(
    'SELECT COUNT(DISTINCT snapshot_date) as count FROM youtube_channel_stats'
  ).get() as { count: number }).count;

  return NextResponse.json({
    latestSnapshot: latestChannel?.snapshot_date ?? null,
    subscriberCount: latestChannel?.subscriber_count ?? 0,
    viewCount: latestChannel?.view_count ?? 0,
    trackedVideos: videoCount,
    totalSnapshots: snapshotCount,
  });
}
