import { NextRequest, NextResponse } from 'next/server';
import { getYoutubeAnalyticsData } from '@/services/youtubeAnalytics';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const sort = searchParams.get('sort') ?? 'views';
  const order = searchParams.get('order') ?? 'desc';

  try {
    const data = getYoutubeAnalyticsData({ sort, order });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
