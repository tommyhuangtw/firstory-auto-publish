import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

const VALID_STATUSES = ['pending_review', 'kept', 'rejected', 'format_requested', 'posted_manually'];

/** Edit a draft's text and/or status (manual review actions on the /trends page). */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const draftId = parseInt(id, 10);
  if (isNaN(draftId)) {
    return NextResponse.json({ error: 'Invalid draft id' }, { status: 400 });
  }

  const db = getDb();
  const draft = db.prepare('SELECT * FROM trend_drafts WHERE id = ?').get(draftId);
  if (!draft) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const sets: string[] = [];
  const values: unknown[] = [];

  if (typeof body.draft_text === 'string') {
    sets.push('draft_text = ?', 'char_count = ?');
    values.push(body.draft_text, body.draft_text.length);
  }
  if (typeof body.task_id === 'number') {
    sets.push('task_id = ?');
    values.push(body.task_id);
  }
  if (typeof body.status === 'string') {
    if (!VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
    }
    sets.push('status = ?');
    values.push(body.status);
    if (body.status !== 'pending_review') {
      sets.push('reviewed_at = ?');
      values.push(new Date().toISOString());
    }
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  sets.push("updated_at = datetime('now')");
  values.push(draftId);
  db.prepare(`UPDATE trend_drafts SET ${sets.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM trend_drafts WHERE id = ?').get(draftId);
  return NextResponse.json({ draft: updated });
}
