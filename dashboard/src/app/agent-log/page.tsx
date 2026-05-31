'use client';

import { Suspense, useEffect, useState, useCallback, useMemo } from 'react';
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

interface TaskInfo {
  id: number;
  title: string;
  status: string;
  category: string;
}

interface TaskGroup {
  taskId: number | null;
  taskTitle: string;
  taskStatus: string;
  taskCategory: string;
  discussions: Discussion[];
  latestAt: string;
  agents: Set<string>;
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
const agentDot: Record<string, string> = {
  pm: 'bg-amber-500',
  planner: 'bg-blue-500',
  engineer: 'bg-emerald-500',
};
const agentNames: Record<string, string> = {
  pm: '懶懶',
  planner: '小企',
  engineer: '小工',
};
const typeIcons: Record<string, string> = {
  proposal: '💡',
  decision: '⚖️',
  execution: '🔧',
  review: '📋',
  report: '📊',
};
const statusBadge: Record<string, string> = {
  todo: 'bg-zinc-700 text-zinc-400',
  in_progress: 'bg-blue-500/20 text-blue-400',
  blocked: 'bg-red-500/20 text-red-400',
  review: 'bg-amber-500/20 text-amber-400',
  done: 'bg-emerald-500/20 text-emerald-400',
  cancelled: 'bg-zinc-800 text-zinc-500',
};
const decisionBadge: Record<string, string> = {
  approved: 'bg-emerald-500/20 text-emerald-400',
  rejected: 'bg-red-500/20 text-red-400',
  needs_tommy: 'bg-amber-500/20 text-amber-400',
  deferred: 'bg-zinc-700 text-zinc-400',
};

type Tab = 'by-task' | 'timeline' | 'proposals';

export default function AgentLogPage() {
  return (
    <Suspense fallback={<div className="text-zinc-500 text-center py-12">Loading...</div>}>
      <AgentLogContent />
    </Suspense>
  );
}

function AgentLogContent() {
  const searchParams = useSearchParams();
  const initialTab = (['by-task', 'timeline', 'proposals'].includes(searchParams.get('tab') || '')
    ? searchParams.get('tab')
    : 'by-task') as Tab;
  const [tab, setTab] = useState<Tab>(initialTab);
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [taskMap, setTaskMap] = useState<Record<number, TaskInfo>>({});
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [stats, setStats] = useState<ProposalStats>({ total: 0, approved: 0, rejected: 0, pending: 0 });
  const [agentFilter, setAgentFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState<number | null>(null);
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [didAutoExpand, setDidAutoExpand] = useState(false);

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
    if (tab === 'proposals') {
      const res = await fetch('/api/agent-proposals?limit=100');
      const data = await res.json();
      setProposals(data.proposals || []);
      setStats(data.stats || { total: 0, approved: 0, rejected: 0, pending: 0 });
    } else {
      const params = new URLSearchParams();
      if (agentFilter) params.set('agent', agentFilter);
      params.set('limit', '500');
      const [discRes, taskRes] = await Promise.all([
        fetch(`/api/agent-discussions?${params}`),
        fetch('/api/tasks?limit=200'),
      ]);
      const discData = await discRes.json();
      const taskData = await taskRes.json();

      setDiscussions(discData.discussions || []);

      const map: Record<number, TaskInfo> = {};
      for (const t of (taskData.tasks || [])) {
        map[t.id] = { id: t.id, title: t.title, status: t.status, category: t.category };
      }
      setTaskMap(map);
    }
    setLoading(false);
  }, [tab, agentFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Group discussions by task_id
  const taskGroups = useMemo(() => {
    const groups = new Map<string, TaskGroup>();

    for (const d of discussions) {
      const key = d.task_id != null ? String(d.task_id) : '_general';
      if (!groups.has(key)) {
        const info = d.task_id != null ? taskMap[d.task_id] : null;
        groups.set(key, {
          taskId: d.task_id,
          taskTitle: info?.title || (d.task_id != null ? `Task #${d.task_id}` : 'General / No Task'),
          taskStatus: info?.status || '',
          taskCategory: info?.category || '',
          discussions: [],
          latestAt: d.created_at,
          agents: new Set(),
        });
      }
      const group = groups.get(key)!;
      group.discussions.push(d);
      group.agents.add(d.agent_id);
      if (d.created_at > group.latestAt) group.latestAt = d.created_at;
    }

    // Sort groups by latest activity (most recent first)
    return Array.from(groups.values()).sort((a, b) =>
      b.latestAt.localeCompare(a.latestAt)
    );
  }, [discussions, taskMap]);

  const toggleTask = (key: string) => {
    setExpandedTasks(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Auto-expand the most recent task group on first load only
  useEffect(() => {
    if (taskGroups.length > 0 && !didAutoExpand) {
      const key = taskGroups[0].taskId != null ? String(taskGroups[0].taskId) : '_general';
      setExpandedTasks(new Set([key]));
      setDidAutoExpand(true);
    }
  }, [taskGroups, didAutoExpand]);

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleString('zh-TW', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  };

  const formatRelative = (d: string) => {
    const now = Date.now();
    const then = new Date(d).getTime();
    const diff = now - then;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
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
        {([
          { id: 'by-task' as Tab, label: 'By Task' },
          { id: 'timeline' as Tab, label: 'Timeline' },
          { id: 'proposals' as Tab, label: 'Proposals' },
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer ${
              tab === t.id ? 'bg-brand/20 text-brand' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {t.label}
            {t.id === 'proposals' && stats.pending > 0 && (
              <span className="ml-1 text-[10px] text-amber-400">({stats.pending})</span>
            )}
          </button>
        ))}
      </div>

      {/* Agent filter (shared by timeline and by-task) */}
      {(tab === 'timeline' || tab === 'by-task') && (
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
              {id ? (agentNames[id] || id) : 'All'}
            </button>
          ))}
        </div>
      )}

      {/* By Task Tab */}
      {tab === 'by-task' && (
        loading ? (
          <div className="text-zinc-500 text-center py-12">Loading...</div>
        ) : taskGroups.length === 0 ? (
          <div className="text-zinc-500 text-center py-12">No agent discussions yet</div>
        ) : (
          <div className="space-y-3">
            {taskGroups.map((group) => {
              const key = group.taskId != null ? String(group.taskId) : '_general';
              const isExpanded = expandedTasks.has(key);

              return (
                <div key={key} className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
                  {/* Task header — clickable */}
                  <button
                    onClick={() => toggleTask(key)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/50 transition-colors cursor-pointer text-left"
                  >
                    {/* Expand/collapse chevron */}
                    <svg
                      className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>

                    {/* Task info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {group.taskId != null && (
                          <span className="text-[10px] text-zinc-500 font-mono">#{group.taskId}</span>
                        )}
                        <span className="text-sm font-medium text-zinc-100 truncate">
                          {group.taskTitle}
                        </span>
                        {group.taskStatus && (
                          <span className={`px-1.5 py-0.5 text-[10px] rounded ${statusBadge[group.taskStatus] || 'bg-zinc-700 text-zinc-400'}`}>
                            {group.taskStatus}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right side: agent dots + count + time */}
                    <div className="shrink-0 flex items-center gap-3">
                      {/* Agent participation dots */}
                      <div className="flex items-center gap-1">
                        {Array.from(group.agents).map(a => (
                          <span
                            key={a}
                            className={`w-2 h-2 rounded-full ${agentDot[a] || 'bg-zinc-500'}`}
                            title={agentNames[a] || a}
                          />
                        ))}
                      </div>
                      <span className="text-[10px] text-zinc-500">
                        {group.discussions.length} msg{group.discussions.length !== 1 ? 's' : ''}
                      </span>
                      <span className="text-[10px] text-zinc-600">
                        {formatRelative(group.latestAt)}
                      </span>
                    </div>
                  </button>

                  {/* Expanded: show discussions grouped by session */}
                  {isExpanded && (
                    <div className="border-t border-zinc-800">
                      <SessionGroupedDiscussions
                        discussions={group.discussions}
                        formatDate={formatDate}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Timeline Tab */}
      {tab === 'timeline' && (
        loading ? (
          <div className="text-zinc-500 text-center py-12">Loading...</div>
        ) : discussions.length === 0 ? (
          <div className="text-zinc-500 text-center py-12">No agent discussions yet</div>
        ) : (
          <div className="space-y-2">
            {discussions.map((d) => (
              <DiscussionCard key={d.id} d={d} formatDate={formatDate} taskMap={taskMap} />
            ))}
          </div>
        )
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
                          {agentNames[p.proposed_by] || p.proposed_by}
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

/** Groups discussions by session_id within a task, displayed chronologically */
function SessionGroupedDiscussions({
  discussions,
  formatDate,
}: {
  discussions: Discussion[];
  formatDate: (d: string) => string;
}) {
  // Sort chronologically (ASC) for conversation reading order
  const sorted = [...discussions].sort((a, b) => a.created_at.localeCompare(b.created_at));

  // Group by session_id
  const sessions: { sessionId: string; items: Discussion[] }[] = [];
  let currentSession: string | null = null;

  for (const d of sorted) {
    if (d.session_id !== currentSession) {
      sessions.push({ sessionId: d.session_id, items: [] });
      currentSession = d.session_id;
    }
    sessions[sessions.length - 1].items.push(d);
  }

  return (
    <div className="divide-y divide-zinc-800/50">
      {sessions.map((session, si) => (
        <div key={session.sessionId} className="px-4 py-3">
          {/* Session label */}
          {sessions.length > 1 && (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] text-zinc-600 font-mono">
                Session {si + 1}
              </span>
              <span className="flex-1 border-t border-zinc-800/50" />
              <span className="text-[10px] text-zinc-600">
                {formatDate(session.items[0].created_at)}
              </span>
            </div>
          )}
          {/* Discussion messages */}
          <div className="space-y-2">
            {session.items.map((d) => (
              <div
                key={d.id}
                className={`border-l-2 rounded-r-lg p-2.5 ${agentColors[d.agent_id] || 'border-l-zinc-600 bg-zinc-900/50'}`}
              >
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${agentBadge[d.agent_id] || 'bg-zinc-700 text-zinc-400'}`}>
                    {d.agent_name}
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    {typeIcons[d.message_type] || '•'} {d.message_type}
                  </span>
                  <span className="text-[10px] text-zinc-600 ml-auto">{formatDate(d.created_at)}</span>
                  {d.token_usage != null && d.token_usage > 0 && (
                    <span className="text-[10px] text-zinc-600">{d.token_usage.toLocaleString()} tok</span>
                  )}
                </div>
                <p className="text-xs text-zinc-300 whitespace-pre-wrap line-clamp-8">
                  {d.content}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Single discussion card for the flat timeline view */
function DiscussionCard({
  d,
  formatDate,
  taskMap,
}: {
  d: Discussion;
  formatDate: (d: string) => string;
  taskMap: Record<number, TaskInfo>;
}) {
  const taskInfo = d.task_id != null ? taskMap[d.task_id] : null;

  return (
    <div className={`border-l-2 rounded-r-lg p-3 ${agentColors[d.agent_id] || 'border-l-zinc-600 bg-zinc-900/50'}`}>
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${agentBadge[d.agent_id] || 'bg-zinc-700 text-zinc-400'}`}>
          {d.agent_name}
        </span>
        <span className="text-[10px] text-zinc-500">
          {typeIcons[d.message_type] || '•'} {d.message_type}
        </span>
        {d.task_id != null && (
          <a href={`/tasks`} className="text-[10px] text-brand hover:text-brand-light cursor-pointer">
            #{d.task_id} {taskInfo?.title ? `— ${taskInfo.title}` : ''}
          </a>
        )}
        <span className="text-[10px] text-zinc-600 ml-auto">{formatDate(d.created_at)}</span>
        {d.token_usage != null && d.token_usage > 0 && (
          <span className="text-[10px] text-zinc-600">{d.token_usage.toLocaleString()} tok</span>
        )}
      </div>
      <p className="text-xs text-zinc-300 whitespace-pre-wrap line-clamp-6">
        {d.content}
      </p>
    </div>
  );
}
