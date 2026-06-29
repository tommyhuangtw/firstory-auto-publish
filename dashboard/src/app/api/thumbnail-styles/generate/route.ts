import { NextRequest, NextResponse } from 'next/server';
import { generateStyles } from '@/services/thumbnailStyles';

export async function POST(request: NextRequest) {
  try {
    const { count = 5 } = (await request.json().catch(() => ({}))) as { count?: number };
    const numStyles = Math.min(Math.max(count, 1), 30);
    const styles = await generateStyles(numStyles);
    return NextResponse.json({ styles, generated: styles.length, requested: numStyles });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
