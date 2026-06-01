import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const episodeId = parseInt(id);
  if (isNaN(episodeId)) {
    return NextResponse.json({ error: 'Invalid episode id' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { selectedTitle, description, igCaption, fbCaption, threadsCaption } = body as {
      selectedTitle?: string;
      description?: string;
      igCaption?: string;
      fbCaption?: string;
      threadsCaption?: string;
    };

    const db = getDb();

    // When title changes, auto-replace old title in ig_caption server-side
    // This is the authoritative replacement — no client-side guessing needed
    if (selectedTitle !== undefined) {
      const row = db.prepare('SELECT selected_title, ig_caption FROM episodes WHERE id = ?').get(episodeId) as { selected_title: string | null; ig_caption: string | null } | undefined;
      const oldTitle = row?.selected_title;
      db.prepare('UPDATE episodes SET selected_title = ? WHERE id = ?')
        .run(selectedTitle, episodeId);

      // If title actually changed and no explicit igCaption in payload, do server-side replacement
      if (oldTitle !== selectedTitle && !igCaption && row?.ig_caption) {
        const caption = row.ig_caption;
        let updated: string | null = null;

        // Strategy 1: match 單元標示 line structure (most reliable)
        // Matches: 📰 AI懶人報｜{title}（{date}） or 📋 AI懶人精選週報｜{title}（{date}） etc.
        const unitLinePattern = /((?:📰|📋|🤖|📐|💬)\s*(?:AI懶人報|AI懶人精選週報|機器人觀察週報|系統設計懶懶學|懶懶碎碎念)｜)[^（\n]+/;
        const unitMatch = caption.match(unitLinePattern);
        if (unitMatch) {
          updated = caption.replace(unitLinePattern, `$1${selectedTitle}`);
        }

        // Strategy 2: exact old title match (fallback)
        if (!updated && oldTitle && caption.includes(oldTitle)) {
          updated = caption.replace(oldTitle, selectedTitle);
        }

        if (updated) {
          db.prepare('UPDATE episodes SET ig_caption = ? WHERE id = ?')
            .run(updated, episodeId);
        }
      }
    }
    if (description !== undefined) {
      // Sync both description fields (they share the same content)
      db.prepare('UPDATE episodes SET description = ?, youtube_description = ? WHERE id = ?')
        .run(description, description, episodeId);
    }
    if (igCaption !== undefined) {
      db.prepare('UPDATE episodes SET ig_caption = ? WHERE id = ?')
        .run(igCaption, episodeId);
    }
    if (fbCaption !== undefined) {
      db.prepare('UPDATE episodes SET fb_caption = ? WHERE id = ?')
        .run(fbCaption, episodeId);
    }
    if (threadsCaption !== undefined) {
      db.prepare('UPDATE episodes SET threads_caption = ? WHERE id = ?')
        .run(threadsCaption, episodeId);
    }

    // Return current ig_caption so client can sync without race conditions
    const current = db.prepare('SELECT ig_caption FROM episodes WHERE id = ?').get(episodeId) as { ig_caption: string | null } | undefined;
    return NextResponse.json({ success: true, igCaption: current?.ig_caption ?? null });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
