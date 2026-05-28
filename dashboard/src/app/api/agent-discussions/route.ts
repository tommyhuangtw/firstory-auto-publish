import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const agent = searchParams.get('agent');
  const sessionId = searchParams.get('session_id');
  const taskId = searchParams.get('task_id');
  const limit = parseInt(searchParams.get('limit') || '100', 10);

  const db = getDb();
  let sql = 'SELECT * FROM agent_discussions WHERE 1=1';
  const params: unknown[] = [];

  if (agent) {
    sql += ' AND agent_id = ?';
    params.push(agent);
  }
  if (sessionId) {
    sql += ' AND session_id = ?';
    params.push(sessionId);
  }
  if (taskId) {
    sql += ' AND task_id = ?';
    params.push(parseInt(taskId, 10));
  }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const discussions = db.prepare(sql).all(...params);
  return NextResponse.json({ discussions });
}
