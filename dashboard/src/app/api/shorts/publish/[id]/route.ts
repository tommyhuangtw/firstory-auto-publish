import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { uploadToCloudinary, uploadVideoToCloudinary } from '@/services/cloudinary';
import { postReelToInstagram } from '@/services/instagram';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const shortsId = parseInt(id);
  if (isNaN(shortsId)) {
    return NextResponse.json({ error: 'Invalid shorts ID' }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const db = getDb();
    const shorts = db.prepare(
      'SELECT video_path, cover_path, ig_caption, status FROM shorts WHERE id = ?'
    ).get(shortsId) as { video_path: string | null; cover_path: string | null; ig_caption: string | null; status: string } | undefined;

    if (!shorts) {
      return NextResponse.json({ error: 'Shorts not found' }, { status: 404 });
    }
    if (shorts.status !== 'completed' && shorts.status !== 'published') {
      return NextResponse.json({ error: `Cannot publish shorts in status: ${shorts.status}` }, { status: 400 });
    }
    if (!shorts.video_path) {
      return NextResponse.json({ error: 'No video file available' }, { status: 400 });
    }

    // Use custom caption if provided, otherwise use auto-generated
    const caption = (body as { caption?: string }).caption || shorts.ig_caption || '';

    // Save caption if updated
    if ((body as { caption?: string }).caption) {
      db.prepare('UPDATE shorts SET ig_caption = ? WHERE id = ?').run(caption, shortsId);
    }

    // Upload video to Cloudinary for public URL
    const videoUrl = await uploadVideoToCloudinary(shorts.video_path);

    // Upload cover image to Cloudinary if available
    let coverUrl: string | undefined;
    if (shorts.cover_path) {
      coverUrl = await uploadToCloudinary(shorts.cover_path, 'cover.png');
    }

    // Post as IG Reel (with cover thumbnail)
    const postId = await postReelToInstagram(videoUrl, caption, coverUrl);

    db.prepare(
      "UPDATE shorts SET status = 'published', ig_post_id = ? WHERE id = ?"
    ).run(postId, shortsId);

    return NextResponse.json({ igPostId: postId });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
