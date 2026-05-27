import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET(request: NextRequest) {
  const db = getDb();
  const { searchParams } = request.nextUrl;

  const status = searchParams.get('status');
  const category = searchParams.get('category');
  const auto_execute = searchParams.get('auto_execute');
  const limit = parseInt(searchParams.get('limit') || '100');
  const offset = parseInt(searchParams.get('offset') || '0');

  let query = 'SELECT * FROM tasks WHERE 1=1';
  const params: unknown[] = [];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }
  if (auto_execute !== null) {
    query += ' AND auto_execute = ?';
    params.push(auto_execute === '1' ? 1 : 0);
  }

  query += ' ORDER BY CASE priority WHEN \'urgent\' THEN 0 WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 ELSE 3 END, created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const tasks = db.prepare(query).all(...params);
  const total = db.prepare('SELECT count(*) as count FROM tasks').get() as { count: number };

  return NextResponse.json({ tasks, total: total.count });
}

export async function POST(request: NextRequest) {
  const db = getDb();
  const body = await request.json();

  const {
    title,
    description,
    status = 'todo',
    priority = 'medium',
    category = 'ops',
    scheduled_at,
    auto_execute = 0,
    episode_id,
    created_by = 'telegram',
  } = body;

  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }

  const validStatuses = ['todo', 'in_progress', 'done', 'cancelled'];
  const validPriorities = ['low', 'medium', 'high', 'urgent'];
  const validCategories = ['content', 'infra', 'social_media', 'youtube', 'ig', 'threads', 'research', 'ops', 'growth'];

  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: `status must be one of: ${validStatuses.join(', ')}` }, { status: 400 });
  }
  if (!validPriorities.includes(priority)) {
    return NextResponse.json({ error: `priority must be one of: ${validPriorities.join(', ')}` }, { status: 400 });
  }
  if (!validCategories.includes(category)) {
    return NextResponse.json({ error: `category must be one of: ${validCategories.join(', ')}` }, { status: 400 });
  }

  const result = db.prepare(`
    INSERT INTO tasks (title, description, status, priority, category, scheduled_at, auto_execute, episode_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, description ?? null, status, priority, category, scheduled_at ?? null, auto_execute ? 1 : 0, episode_id ?? null, created_by);

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);
  return NextResponse.json(task, { status: 201 });
}
