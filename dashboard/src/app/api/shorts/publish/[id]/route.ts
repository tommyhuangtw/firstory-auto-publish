import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { uploadToCloudinary, uploadVideoToCloudinary } from '@/services/cloudinary';
import { postReelToInstagram } from '@/services/instagram';
import { publishShortsToYouTube } from '@/services/shortsPipeline';

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
    const body = await request.json().catch(() => ({})) as {
      caption?: string;
      platform?: 'ig' | 'yt' | 'all';
    };
    const platform = body.platform || 'ig';

    const db = getDb();
    const shorts = db.prepare(
      'SELECT video_path, cover_path, ig_caption, ig_post_id, yt_video_id, status FROM shorts WHERE id = ?'
    ).get(shortsId) as {
      video_path: string | null;
      cover_path: string | null;
      ig_caption: string | null;
      ig_post_id: string | null;
      yt_video_id: string | null;
      status: string;
    } | undefined;

    if (!shorts) {
      return NextResponse.json({ error: 'Shorts not found' }, { status: 404 });
    }
    const publishableStatuses = ['completed', 'published', 'headline_ready'];
    if (!publishableStatuses.includes(shorts.status)) {
      return NextResponse.json({ error: `Cannot publish shorts in status: ${shorts.status}` }, { status: 400 });
    }
    if (!shorts.video_path) {
      return NextResponse.json({ error: 'No video file available' }, { status: 400 });
    }

    // Use custom caption if provided, otherwise use auto-generated
    const caption = body.caption || shorts.ig_caption || '';
    if (body.caption) {
      db.prepare('UPDATE shorts SET ig_caption = ? WHERE id = ?').run(caption, shortsId);
    }

    const result: { igPostId?: string; ytVideoId?: string; ytVideoUrl?: string; warning?: string } = {};

    // --- IG publish ---
    if (platform === 'ig' || platform === 'all') {
      const videoUrl = await uploadVideoToCloudinary(shorts.video_path);
      let coverUrl: string | undefined;
      if (shorts.cover_path) {
        coverUrl = await uploadToCloudinary(shorts.cover_path, 'cover.png');
      }
      const postId = await postReelToInstagram(videoUrl, caption, coverUrl);
      db.prepare("UPDATE shorts SET ig_post_id = ? WHERE id = ?").run(postId, shortsId);
      result.igPostId = postId;
    }

    // --- YT publish ---
    if (platform === 'yt' || platform === 'all') {
      try {
        const ytResult = await publishShortsToYouTube(shortsId);
        result.ytVideoId = ytResult.videoId;
        result.ytVideoUrl = ytResult.videoUrl;
      } catch (err) {
        const ytError = (err as Error).message;
        if (platform === 'all') {
          // IG succeeded, YT failed — partial success
          result.warning = `YouTube 上傳失敗: ${ytError}`;
        } else {
          throw err;
        }
      }
    }

    // Update status to published
    db.prepare("UPDATE shorts SET status = 'published' WHERE id = ?").run(shortsId);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
