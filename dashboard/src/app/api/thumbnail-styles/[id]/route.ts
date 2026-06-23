import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const styleId = parseInt(id);
    if (isNaN(styleId)) {
      return NextResponse.json({ error: 'Invalid style id' }, { status: 400 });
    }

    const { isEnabled } = (await request.json()) as { isEnabled: boolean };
    if (typeof isEnabled !== 'boolean') {
      return NextResponse.json({ error: 'isEnabled (boolean) is required' }, { status: 400 });
    }

    const db = getDb();

    // Warn if disabling would leave 0 enabled styles
    if (!isEnabled) {
      const count = (db.prepare(
        'SELECT COUNT(*) as c FROM thumbnail_styles WHERE is_enabled = 1 AND id != ?'
      ).get(styleId) as { c: number }).c;
      if (count === 0) {
        return NextResponse.json({ error: 'Cannot disable the last enabled style' }, { status: 400 });
      }
    }

    db.prepare('UPDATE thumbnail_styles SET is_enabled = ? WHERE id = ?').run(isEnabled ? 1 : 0, styleId);

    const updated = db.prepare('SELECT id, name, is_enabled FROM thumbnail_styles WHERE id = ?').get(styleId) as { id: number; name: string; is_enabled: number } | undefined;
    if (!updated) {
      return NextResponse.json({ error: 'Style not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, style: { id: updated.id, name: updated.name, isEnabled: updated.is_enabled === 1 } });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const styleId = parseInt(id);
    if (isNaN(styleId)) {
      return NextResponse.json({ error: 'Invalid style id' }, { status: 400 });
    }

    const db = getDb();
    const style = db.prepare('SELECT id FROM thumbnail_styles WHERE id = ?').get(styleId) as { id: number } | undefined;

    if (!style) {
      return NextResponse.json({ error: 'Style not found' }, { status: 404 });
    }

    // Seed styles can be dropped too. Deletion persists because re-seeding only
    // fires when the table is completely empty (see seedThumbnailStyles).
    db.prepare('DELETE FROM thumbnail_styles WHERE id = ?').run(styleId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
