#!/usr/bin/env npx tsx
/**
 * Phase B Smoke Test — verifies planner, PM proposal eval, orchestrator, and daily summary.
 * Run: cd dashboard && npx tsx scripts/agents/test-phase-b.ts
 */

import { getDb } from '@/db';
import {
  generateSessionId,
  logDiscussion,
  createProposal,
  getAgentMemory,
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
  const sessionId = generateSessionId();

  // ── Test 1: Planner imports and data gathering ─────────────────────
  console.log('\n=== Test 1: Planner Module ===');
  const planner = await import('./planner');
  assert('checkAndPropose is function', typeof planner.checkAndPropose === 'function');
  assert('generateProposals is function', typeof planner.generateProposals === 'function');
  assert('conductResearch is function', typeof planner.conductResearch === 'function');

  // ── Test 2: PM proposal evaluation ─────────────────────────────────
  console.log('\n=== Test 2: PM Proposal Evaluation ===');
  const pm = await import('./pm');
  assert('evaluateProposals is function', typeof pm.evaluateProposals === 'function');
  assert('dailySummary is function', typeof pm.dailySummary === 'function');
  assert('reviewPendingTasks is function', typeof pm.reviewPendingTasks === 'function');

  // Test that evaluateProposals handles empty case
  const emptyDecisions = await pm.evaluateProposals(sessionId);
  assert('evaluateProposals returns empty array when no pending proposals', emptyDecisions.length === 0);

  // ── Test 3: Create + read back proposals ───────────────────────────
  console.log('\n=== Test 3: Proposal Lifecycle ===');
  const proposalId = createProposal(sessionId, 'planner', 'content', 'Test: AI 趨勢分析 EP', '深入分析最近 AI 模型發展', 'medium');
  assert('Proposal created', proposalId > 0);

  const proposal = db.prepare('SELECT * FROM agent_proposals WHERE id = ?').get(proposalId) as Record<string, unknown>;
  assert('Proposal saved with correct type', proposal?.proposal_type === 'content');
  assert('Proposal has no decision yet', proposal?.pm_decision === null);

  // Clean up
  db.prepare('DELETE FROM agent_proposals WHERE id = ?').run(proposalId);

  // ── Test 4: Orchestrator module ────────────────────────────────────
  console.log('\n=== Test 4: Orchestrator Module ===');
  // We can't run the full orchestrator (it needs Claude Code CLI), but verify it loads
  // The orchestrator is a script, not a module with exports, so we just verify the file parses
  try {
    // Check that all orchestrator dependencies resolve
    const { checkAndPropose: cp } = await import('./planner');
    const { evaluateProposals: ep, reviewPendingTasks: rpt, dailySummary: ds } = await import('./pm');
    const { executeTask: et, resumeTask: rt } = await import('./engineer');
    assert('Orchestrator dependencies all resolve', true);
    assert('All 3 agents importable from orchestrator',
      typeof cp === 'function' && typeof ep === 'function' && typeof et === 'function');
  } catch (e) {
    assert('Orchestrator dependencies resolve', false);
  }

  // ── Test 5: Cross-agent discussion logging ─────────────────────────
  console.log('\n=== Test 5: Cross-Agent Discussion Flow ===');
  const testSession = generateSessionId();

  // Simulate: 小企 proposes → 懶懶 decides → 小工 reports
  logDiscussion('planner', testSession, 'proposal', '提案: 做一集 Claude 4 分析');
  logDiscussion('pm', testSession, 'decision', '✅ Approved — 主題熱門，受眾有需求');
  logDiscussion('engineer', testSession, 'execution', '開始執行 Task #999');

  const discussions = db.prepare(
    'SELECT agent_name, message_type FROM agent_discussions WHERE session_id = ? ORDER BY created_at'
  ).all(testSession) as Array<{ agent_name: string; message_type: string }>;

  assert('3 discussion entries logged', discussions.length === 3);
  assert('Correct agent sequence: 小企→懶懶→小工',
    discussions[0]?.agent_name === '小企' &&
    discussions[1]?.agent_name === '懶懶' &&
    discussions[2]?.agent_name === '小工',
  );
  assert('Correct message types',
    discussions[0]?.message_type === 'proposal' &&
    discussions[1]?.message_type === 'decision' &&
    discussions[2]?.message_type === 'execution',
  );

  // Clean up
  db.prepare('DELETE FROM agent_discussions WHERE session_id = ?').run(testSession);

  // ── Test 6: Agent memories still intact ────────────────────────────
  console.log('\n=== Test 6: Agent Memories Intact ===');
  for (const agentId of ['pm', 'planner', 'engineer'] as const) {
    const mem = getAgentMemory(agentId);
    assert(`${agentId} has loaded memories`, mem.length > 50);
  }

  // ── Test 7: Lockfile mechanism ─────────────────────────────────────
  console.log('\n=== Test 7: Lockfile ===');
  const lockPath = require('path').join(__dirname, '..', 'data', 'orchestrator.lock');
  const { existsSync } = require('fs');
  assert('No stale orchestrator lock', !existsSync(lockPath));

  // ── Summary ────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Phase B Smoke Test: ${passed} passed, ${failed} failed`);
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
