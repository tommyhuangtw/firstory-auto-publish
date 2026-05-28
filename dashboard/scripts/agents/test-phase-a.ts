#!/usr/bin/env npx tsx
/**
 * Phase A Smoke Test — verifies all agent infrastructure works.
 * Run: cd dashboard && npx tsx scripts/agents/test-phase-a.ts
 */

import { getDb } from '@/db';
import {
  buildSharedMemory,
  getAgentMemory,
  logDiscussion,
  generateSessionId,
  buildAgentPrompt,
  createAlert,
  createProposal,
  type AgentConfig,
} from './base';

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    failed++;
  }
}

async function main() {
  const db = getDb();

  // ── Test 1: DB Tables ──────────────────────────────────────────────
  console.log('\n=== Test 1: DB Tables ===');
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('agent_discussions','agent_proposals','alerts','agent_memory')"
  ).all() as Array<{ name: string }>;
  const tableNames = tables.map(t => t.name);
  assert('agent_discussions exists', tableNames.includes('agent_discussions'));
  assert('agent_proposals exists', tableNames.includes('agent_proposals'));
  assert('alerts exists', tableNames.includes('alerts'));
  assert('agent_memory exists', tableNames.includes('agent_memory'));

  // ── Test 2: Seed Data ──────────────────────────────────────────────
  console.log('\n=== Test 2: Memory Seed Data ===');
  const memCount = (db.prepare('SELECT COUNT(*) as c FROM agent_memory').get() as { c: number }).c;
  assert('Has seed memories', memCount >= 20);

  const agentCounts = db.prepare(
    'SELECT agent_id, COUNT(*) as c FROM agent_memory GROUP BY agent_id'
  ).all() as Array<{ agent_id: string; c: number }>;
  const countMap = Object.fromEntries(agentCounts.map(a => [a.agent_id, a.c]));
  assert('planner has memories', (countMap['planner'] || 0) >= 5);
  assert('engineer has memories', (countMap['engineer'] || 0) >= 5);
  assert('pm has memories', (countMap['pm'] || 0) >= 5);

  // ── Test 3: getAgentMemory ─────────────────────────────────────────
  console.log('\n=== Test 3: getAgentMemory ===');
  for (const agentId of ['pm', 'planner', 'engineer'] as const) {
    const mem = getAgentMemory(agentId);
    assert(`${agentId} memory is non-empty`, mem.length > 50 && !mem.includes('尚無記憶'));
  }

  // ── Test 4: buildSharedMemory ──────────────────────────────────────
  console.log('\n=== Test 4: buildSharedMemory ===');
  const shared = await buildSharedMemory();
  assert('Shared memory is non-empty', shared.length > 100);
  assert('Has project overview section', shared.includes('專案概覽'));
  assert('Has Task Board section', shared.includes('Task Board'));

  // ── Test 5: logDiscussion ──────────────────────────────────────────
  console.log('\n=== Test 5: logDiscussion (write + read) ===');
  const sessionId = generateSessionId();
  logDiscussion('pm', sessionId, 'decision', 'Test: phase A smoke test entry');
  const row = db.prepare('SELECT * FROM agent_discussions WHERE session_id = ?').get(sessionId) as Record<string, unknown> | undefined;
  assert('Discussion row written', row !== undefined);
  assert('Agent name is 懶懶', row?.agent_name === '懶懶');
  assert('Message type correct', row?.message_type === 'decision');
  // Cleanup
  db.prepare('DELETE FROM agent_discussions WHERE session_id = ?').run(sessionId);

  // ── Test 6: createProposal ─────────────────────────────────────────
  console.log('\n=== Test 6: createProposal ===');
  const proposalId = createProposal(sessionId, 'engineer', 'optimization', 'Test proposal', 'This is a test', 'low');
  assert('Proposal created with ID', proposalId > 0);
  const proposal = db.prepare('SELECT * FROM agent_proposals WHERE id = ?').get(proposalId) as Record<string, unknown> | undefined;
  assert('Proposal row exists', proposal !== undefined);
  assert('Proposed by engineer', proposal?.proposed_by === 'engineer');
  // Cleanup
  db.prepare('DELETE FROM agent_proposals WHERE id = ?').run(proposalId);

  // ── Test 7: createAlert ────────────────────────────────────────────
  console.log('\n=== Test 7: createAlert ===');
  const alertId = await createAlert('pm', 'review_ready', 'Test alert', 'Phase A smoke test', 'normal');
  assert('Alert created with ID', alertId > 0);
  const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(alertId) as Record<string, unknown> | undefined;
  assert('Alert row exists', alert !== undefined);
  assert('Alert status is unread', alert?.status === 'unread');
  // Cleanup
  db.prepare('DELETE FROM alerts WHERE id = ?').run(alertId);

  // ── Test 8: buildAgentPrompt ───────────────────────────────────────
  console.log('\n=== Test 8: buildAgentPrompt ===');
  const config: AgentConfig = {
    id: 'engineer',
    name: '小工',
    role: 'Senior Engineer',
    systemPrompt: 'Test system prompt for smoke test',
  };
  const prompt = await buildAgentPrompt(config, 'Some session context');
  assert('Prompt is non-empty', prompt.length > 200);
  assert('Contains agent name', prompt.includes('小工'));
  assert('Contains shared memory', prompt.includes('專案共享記憶'));
  assert('Contains private memory', prompt.includes('你的個人記憶'));
  assert('Contains session context', prompt.includes('Some session context'));

  // ── Test 9: Agent imports ──────────────────────────────────────────
  console.log('\n=== Test 9: Agent module imports ===');
  const engineer = await import('./engineer');
  assert('engineer.executeTask is function', typeof engineer.executeTask === 'function');
  assert('engineer.resumeTask is function', typeof engineer.resumeTask === 'function');
  assert('engineer.proposeImprovement is function', typeof engineer.proposeImprovement === 'function');

  const pm = await import('./pm');
  assert('pm.reviewTask is function', typeof pm.reviewTask === 'function');
  assert('pm.reviewPendingTasks is function', typeof pm.reviewPendingTasks === 'function');

  // ── Summary ────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Phase A Smoke Test: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('✅ All tests passed!');
  }
}

main().catch(e => {
  console.error('Test runner failed:', e);
  process.exit(1);
});
