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

export async function PATCH(request: NextRequest) {
  const db = getDb();
  const body = await request.json();
  const { id, decision, reasoning } = body;

  if (!id || !decision) {
    return NextResponse.json({ error: 'id and decision are required' }, { status: 400 });
  }

  const validDecisions = ['approved', 'rejected', 'deferred'];
  if (!validDecisions.includes(decision)) {
    return NextResponse.json({ error: `decision must be one of: ${validDecisions.join(', ')}` }, { status: 400 });
  }

  // Check proposal exists and is pending
  const proposal = db.prepare('SELECT * FROM agent_proposals WHERE id = ?').get(id) as {
    id: number; title: string; description: string; proposal_type: string;
    priority_suggestion: string | null; pm_decision: string | null;
  } | undefined;

  if (!proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }
  if (proposal.pm_decision) {
    return NextResponse.json({ error: 'Proposal already decided' }, { status: 409 });
  }

  // Update decision
  db.prepare(
    'UPDATE agent_proposals SET pm_decision = ?, pm_reasoning = ? WHERE id = ?'
  ).run(decision, reasoning || null, id);

  let taskId: number | null = null;

  // If approved, create a ticket
  if (decision === 'approved') {
    const categoryMap: Record<string, string> = {
      content: 'content', feature: 'infra', optimization: 'infra',
      bugfix: 'infra', research: 'research',
    };
    const category = categoryMap[proposal.proposal_type] || 'ops';
    const priority = proposal.priority_suggestion || 'medium';

    const result = db.prepare(`
      INSERT INTO tasks (title, description, status, priority, category, auto_execute, created_by)
      VALUES (?, ?, 'todo', ?, ?, 1, 'agent-proposal')
    `).run(proposal.title, proposal.description, priority, category);

    taskId = Number(result.lastInsertRowid);

    // Link task back to proposal
    db.prepare('UPDATE agent_proposals SET task_id = ? WHERE id = ?').run(taskId, id);
  }

  return NextResponse.json({ success: true, taskId });
}
