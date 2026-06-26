import { NextRequest, NextResponse } from 'next/server';
import { getActiveAdContent, getSetting } from '@/services/descriptionAssembler';

/**
 * Returns the parts needed to preview the final published description on the
 * review page: the resolved sponsor ad text (selected sponsor → its ad_preset,
 * else globally active ad_preset) plus the footers. The main body is assembled
 * client-side so the preview updates live as the user edits.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const episodeId = parseInt(id);

  return NextResponse.json({
    adContent: getActiveAdContent(episodeId),
    podcastFooter: getSetting('podcast_footer'),
    youtubeFooter: getSetting('youtube_footer'),
  });
}
