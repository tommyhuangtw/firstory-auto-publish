import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const agent = searchParams.get('agent');
  const urgency = searchParams.get('urgency');
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  const db = getDb();
  let sql = 'SELECT * FROM alerts WHERE 1=1';
  const params: unknown[] = [];

  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (agent) {
    sql += ' AND source_agent = ?';
    params.push(agent);
  }
  if (urgency) {
    sql += ' AND urgency = ?';
    params.push(urgency);
  }

  sql += ` ORDER BY
    CASE urgency WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
    created_at DESC
    LIMIT ?`;
  params.push(limit);

  const alerts = db.prepare(sql).all(...params);
  const unreadCount = (db.prepare("SELECT COUNT(*) as c FROM alerts WHERE status = 'unread'").get() as { c: number }).c;

  return NextResponse.json({ alerts, unreadCount });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { id, status } = body as { id?: number; status?: string };

  if (!id || !status) {
    return NextResponse.json({ error: 'id and status required' }, { status: 400 });
  }

  const validStatuses = ['unread', 'read', 'actioned', 'dismissed'];
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: `status must be one of: ${validStatuses.join(', ')}` }, { status: 400 });
  }

  const db = getDb();
  const actionedAt = (status === 'actioned' || status === 'dismissed') ? new Date().toISOString() : null;

  db.prepare('UPDATE alerts SET status = ?, actioned_at = COALESCE(?, actioned_at) WHERE id = ?')
    .run(status, actionedAt, id);

  return NextResponse.json({ id, status, message: 'updated' });
}
