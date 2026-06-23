import { NextRequest, NextResponse } from 'next/server';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:context-image');

/**
 * Upload a context/reference screenshot for cover regeneration.
 * Stores to Cloudinary and returns a public URL (needed both by the vision LLM
 * and, optionally, by kie.ai as a reference image). Does NOT touch the episode's
 * cover — this is just scratch context for the review-time regenerate flow.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (isNaN(parseInt(id))) {
      return NextResponse.json({ error: 'Invalid episode id' }, { status: 400 });
    }

    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_UPLOAD_PRESET) {
      return NextResponse.json({ error: 'Cloudinary not configured' }, { status: 500 });
    }

    const formData = await request.formData();
    const file = formData.get('image') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No image uploaded' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { uploadToCloudinary } = await import('@/services/cloudinary');
    const url = await uploadToCloudinary(buffer, `context_${id}_${Date.now()}`);

    log.info({ episodeId: id, url }, 'Context image uploaded');
    return NextResponse.json({ url });
  } catch (error) {
    log.error({ error: (error as Error).message }, 'Context image upload failed');
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
