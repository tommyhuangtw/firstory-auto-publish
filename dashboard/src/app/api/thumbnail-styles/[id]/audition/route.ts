import { NextRequest, NextResponse } from 'next/server';
import { auditionStyle } from '@/services/thumbnailStyles';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const styleId = parseInt(id);
    if (isNaN(styleId)) {
      return NextResponse.json({ error: 'Invalid style id' }, { status: 400 });
    }

    const { hookTitle } = (await request.json().catch(() => ({}))) as { hookTitle?: string };
    const result = await auditionStyle(styleId, hookTitle);
    return NextResponse.json(result);
  } catch (error) {
    const msg = (error as Error).message;
    const status = msg === 'Style not found' ? 404
      : msg.startsWith('No image generation key') ? 500
      : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
