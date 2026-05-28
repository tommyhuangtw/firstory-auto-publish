'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';

interface Discussion {
  id: number;
  task_id: number | null;
  session_id: string;
  agent_id: string;
  agent_name: string;
  message_type: string;
  content: string;
  token_usage: number | null;
  duration_ms: number | null;
  created_at: string;
}

interface Proposal {
  id: number;
  session_id: string;
  proposed_by: string;
  proposal_type: string;
  title: string;
  description: string;
  priority_suggestion: string | null;
  pm_decision: string | null;
  pm_reasoning: string | null;
  task_id: number | null;
  created_at: string;
}

interface ProposalStats {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
}

const agentColors: Record<string, string> = {
  pm: 'border-l-amber-500 bg-amber-500/5',
  planner: 'border-l-blue-500 bg-blue-500/5',
  engineer: 'border-l-emerald-500 bg-emerald-500/5',
};
const agentBadge: Record<string, string> = {
  pm: 'bg-amber-500/20 text-amber-400',
  planner: 'bg-blue-500/20 text-blue-400',
  engineer: 'bg-emerald-500/20 text-emerald-400',
};
const typeIcons: Record<string, string> = {
  proposal: '💡',
  decision: '⚖️',
  execution: '🔧',
  review: '📋',
  report: '📊',
};
const decisionBadge: Record<string, string> = {
  approved: 'bg-emerald-500/20 text-emerald-400',
  rejected: 'bg-red-500/20 text-red-400',
  needs_tommy: 'bg-amber-500/20 text-amber-400',
  deferred: 'bg-zinc-700 text-zinc-400',
};

type Tab = 'timeline' | 'proposals';

export default function AgentLogPage() {
  return (
    <Suspense fallback={<div className="text-zinc-500 text-center py-12">Loading...</div>}>
      <AgentLogContent />
    </Suspense>
  );
}

function AgentLogContent() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') === 'proposals' ? 'proposals' : 'timeline') as Tab;
  const [tab, setTab] = useState<Tab>(initialTab);
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [stats, setStats] = useState<ProposalStats>({ total: 0, approved: 0, rejected: 0, pending: 0 });
  const [agentFilter, setAgentFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState<number | null>(null);

  const decideProposal = async (id: number, decision: string, reasoning?: string) => {
    setDeciding(id);
    try {
      const res = await fetch('/api/agent-proposals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, decision, reasoning }),
      });
      await res.json();
      fetchData();
    } finally {
      setDeciding(null);
    }
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    if (tab === 'timeline') {
      const params = new URLSearchParams();
      if (agentFilter) params.set('agent', agentFilter);
      params.set('limit', '200');
      const res = await fetch(`/api/agent-discussions?${params}`);
      const data = await res.json();
      setDiscussions(data.discussions || []);
    } else {
      const res = await fetch('/api/agent-proposals?limit=100');
      const data = await res.json();
      setProposals(data.proposals || []);
      setStats(data.stats || { total: 0, approved: 0, rejected: 0, pending: 0 });
    }
    setLoading(false);
  }, [tab, agentFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleString('zh-TW', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <h1 className="text-2xl font-semibold tracking-tight mb-6 flex items-center gap-2">
        <span className="w-1 h-6 rounded-full bg-brand" />
        Agent Log
      </h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-zinc-900 rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab('timeline')}
          className={`px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer ${
            tab === 'timeline' ? 'bg-brand/20 text-brand' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Timeline
        </button>
        <button
          onClick={() => setTab('proposals')}
          className={`px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer ${
            tab === 'proposals' ? 'bg-brand/20 text-brand' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Proposals {stats.pending > 0 && <span className="ml-1 text-[10px] text-amber-400">({stats.pending})</span>}
        </button>
      </div>

      {/* Timeline Tab */}
      {tab === 'timeline' && (
        <>
          {/* Agent filter */}
          <div className="flex gap-2 mb-4">
            {['', 'pm', 'planner', 'engineer'].map(id => (
              <button
                key={id}
                onClick={() => setAgentFilter(id)}
                className={`px-3 py-1 text-xs rounded-full transition-colors cursor-pointer ${
                  agentFilter === id
                    ? 'bg-brand/20 text-brand border border-brand/30'
                    : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600'
                }`}
              >
                {id ? ({ pm: '懶懶', planner: '小企', engineer: '小工' }[id]) : 'All'}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="text-zinc-500 text-center py-12">Loading...</div>
          ) : discussions.length === 0 ? (
            <div className="text-zinc-500 text-center py-12">No agent discussions yet</div>
          ) : (
            <div className="space-y-2">
              {discussions.map((d) => (
                <div
                  key={d.id}
                  className={`border-l-2 rounded-r-lg p-3 ${agentColors[d.agent_id] || 'border-l-zinc-600 bg-zinc-900/50'}`}
                >
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${agentBadge[d.agent_id] || 'bg-zinc-700 text-zinc-400'}`}>
                      {d.agent_name}
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      {typeIcons[d.message_type] || '•'} {d.message_type}
                    </span>
                    {d.task_id && (
                      <a href="/tasks" className="text-[10px] text-brand hover:text-brand-light cursor-pointer">
                        Task #{d.task_id}
                      </a>
                    )}
                    <span className="text-[10px] text-zinc-600 ml-auto">{formatDate(d.created_at)}</span>
                    {d.token_usage && (
                      <span className="text-[10px] text-zinc-600">{d.token_usage.toLocaleString()} tokens</span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-300 whitespace-pre-wrap line-clamp-6">
                    {d.content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Proposals Tab */}
      {tab === 'proposals' && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            {[
              { label: 'Total', value: stats.total, color: 'text-zinc-200' },
              { label: 'Approved', value: stats.approved, color: 'text-emerald-400' },
              { label: 'Rejected', value: stats.rejected, color: 'text-red-400' },
              { label: 'Pending', value: stats.pending, color: 'text-amber-400' },
            ].map(s => (
              <div key={s.label} className="bg-zinc-900 rounded-xl border border-zinc-800 p-3 text-center">
                <div className={`text-xl font-semibold ${s.color}`}>{s.value}</div>
                <div className="text-[10px] text-zinc-500 uppercase mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {loading ? (
            <div className="text-zinc-500 text-center py-12">Loading...</div>
          ) : proposals.length === 0 ? (
            <div className="text-zinc-500 text-center py-12">No proposals yet</div>
          ) : (
            <div className="space-y-3">
              {proposals.map((p) => (
                <div key={p.id} className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${agentBadge[p.proposed_by] || 'bg-zinc-700 text-zinc-400'}`}>
                          {{ pm: '懶懶', planner: '小企', engineer: '小工' }[p.proposed_by] || p.proposed_by}
                        </span>
                        <span className="text-[10px] text-zinc-500 uppercase">{p.proposal_type}</span>
                        {p.priority_suggestion && (
                          <span className="text-[10px] text-zinc-500">Priority: {p.priority_suggestion}</span>
                        )}
                        <span className="text-[10px] text-zinc-600">{formatDate(p.created_at)}</span>
                      </div>

                      <h3 className="text-sm font-medium text-zinc-100">{p.title}</h3>
                      <p className="text-xs text-zinc-500 mt-1 whitespace-pre-wrap line-clamp-3">
                        {p.description}
                      </p>

                      {p.pm_reasoning && (
                        <p className="text-xs text-zinc-400 mt-2 italic">
                          懶懶: {p.pm_reasoning}
                        </p>
                      )}

                      {p.task_id && (
                        <a href="/tasks" className="inline-block text-xs text-brand hover:text-brand-light mt-1 cursor-pointer">
                          → Task #{p.task_id}
                        </a>
                      )}
                    </div>

                    <div className="shrink-0 flex flex-col gap-1.5 items-end">
                      {p.pm_decision ? (
                        <span className={`px-2 py-0.5 text-[10px] rounded-full ${decisionBadge[p.pm_decision] || 'bg-zinc-700 text-zinc-400'}`}>
                          {p.pm_decision}
                        </span>
                      ) : (
                        <>
                          <span className="px-2 py-0.5 text-[10px] rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            pending
                          </span>
                          <button
                            disabled={deciding === p.id}
                            onClick={() => decideProposal(p.id, 'approved')}
                            className="px-2.5 py-1 text-[10px] rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            disabled={deciding === p.id}
                            onClick={() => decideProposal(p.id, 'rejected')}
                            className="px-2.5 py-1 text-[10px] rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            Reject
                          </button>
                          <button
                            disabled={deciding === p.id}
                            onClick={() => decideProposal(p.id, 'deferred')}
                            className="px-2.5 py-1 text-[10px] rounded bg-zinc-800 text-zinc-500 hover:bg-zinc-700 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            Defer
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
