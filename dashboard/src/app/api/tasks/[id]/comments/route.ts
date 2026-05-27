import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { syncPrStatus } from '@/services/githubSync';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDb();
  const { id } = await params;

  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(Number(id));
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  const comments = db
    .prepare('SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC')
    .all(Number(id));

  // Auto-sync PR statuses in the background (non-blocking)
  const prComments = (comments as Array<{ id: number; type: string; metadata: string | null }>)
    .filter((c) => c.type === 'pr' && c.metadata);
  if (prComments.length > 0) {
    syncPrStatus(prComments as Array<{ id: number; metadata: string }>).catch(() => {});
  }

  return NextResponse.json({ comments });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDb();
  const { id } = await params;
  const body = await request.json();

  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(Number(id));
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  const { author = 'hermes', type = 'action', content, metadata } = body;

  if (!content?.trim()) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }

  const VALID_TYPES = ['action', 'research', 'discussion', 'pr', 'branch', 'doc', 'analysis', 'note'];
  const VALID_AUTHORS = ['hermes', 'tommy'];
  if (!VALID_TYPES.includes(type)) return NextResponse.json({ error: `invalid type: ${type}` }, { status: 400 });
  if (!VALID_AUTHORS.includes(author)) return NextResponse.json({ error: `invalid author` }, { status: 400 });

  const metaStr = metadata ? JSON.stringify(metadata) : null;

  const result = db
    .prepare('INSERT INTO task_comments (task_id, author, type, content, metadata) VALUES (?, ?, ?, ?, ?)')
    .run(Number(id), author, type, content.trim(), metaStr);

  // If it's a PR comment, immediately fetch status from GitHub
  if (type === 'pr' && metadata?.url) {
    const inserted = db.prepare('SELECT * FROM task_comments WHERE id = ?').get(result.lastInsertRowid);
    await syncPrStatus([inserted as { id: number; metadata: string }]).catch(() => {});
  }

  const inserted = db.prepare('SELECT * FROM task_comments WHERE id = ?').get(result.lastInsertRowid);
  return NextResponse.json(inserted, { status: 201 });
}
