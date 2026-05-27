import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDb();
  const { id } = await params;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(id));
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  return NextResponse.json(task);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDb();
  const { id } = await params;
  const body = await request.json();

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(id));
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  const allowedFields = ['title', 'description', 'status', 'priority', 'category', 'scheduled_at', 'auto_execute', 'episode_id', 'result_notes', 'completed_by'];
  const updates: string[] = [];
  const values: unknown[] = [];

  for (const field of allowedFields) {
    if (field in body) {
      updates.push(`${field} = ?`);
      values.push(body[field] === undefined ? null : body[field]);
    }
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  // Auto-set completed_at when done or moved to review
  if (body.status === 'done' || body.status === 'review') {
    updates.push('completed_at = ?');
    values.push(new Date().toISOString());
  }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(Number(id));

  db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(id));
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDb();
  const { id } = await params;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(id));
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  db.prepare('DELETE FROM tasks WHERE id = ?').run(Number(id));
  return NextResponse.json({ success: true });
}
