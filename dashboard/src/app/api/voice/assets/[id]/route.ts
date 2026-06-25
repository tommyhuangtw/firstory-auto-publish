import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

/** Edit an asset: content / pinned / status (kept|hidden|draft). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json() as { content?: string; pinned?: boolean; status?: string };

  const sets: string[] = [];
  const values: (string | number)[] = [];
  if (typeof body.content === 'string') { sets.push('content = ?'); values.push(body.content); }
  if (typeof body.pinned === 'boolean') { sets.push('pinned = ?'); values.push(body.pinned ? 1 : 0); }
  if (typeof body.status === 'string' && ['draft', 'kept', 'hidden'].includes(body.status)) {
    sets.push('status = ?'); values.push(body.status);
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: '沒有可更新的欄位' }, { status: 400 });
  }

  sets.push("updated_at = datetime('now')");
  values.push(id);
  const info = getDb().prepare(`UPDATE voice_assets SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  if (info.changes === 0) return NextResponse.json({ error: '找不到該資產' }, { status: 404 });

  return NextResponse.json({ ok: true });
}

/** Delete an asset. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const info = getDb().prepare('DELETE FROM voice_assets WHERE id = ?').run(id);
  if (info.changes === 0) return NextResponse.json({ error: '找不到該資產' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
