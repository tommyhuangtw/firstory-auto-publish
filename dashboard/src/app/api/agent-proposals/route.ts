import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const decision = searchParams.get('decision'); // 'approved' | 'rejected' | 'pending' etc.
  const proposedBy = searchParams.get('proposed_by');
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  const db = getDb();
  let sql = 'SELECT * FROM agent_proposals WHERE 1=1';
  const params: unknown[] = [];

  if (decision === 'pending') {
    sql += ' AND pm_decision IS NULL';
  } else if (decision) {
    sql += ' AND pm_decision = ?';
    params.push(decision);
  }
  if (proposedBy) {
    sql += ' AND proposed_by = ?';
    params.push(proposedBy);
  }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const proposals = db.prepare(sql).all(...params);

  // Stats
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN pm_decision = 'approved' THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN pm_decision = 'rejected' THEN 1 ELSE 0 END) as rejected,
      SUM(CASE WHEN pm_decision IS NULL THEN 1 ELSE 0 END) as pending
    FROM agent_proposals
  `).get() as { total: number; approved: number; rejected: number; pending: number };

  return NextResponse.json({ proposals, stats });
}
