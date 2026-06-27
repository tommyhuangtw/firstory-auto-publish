'use client';

import { useEffect, useState, useCallback } from 'react';
import PageHeader from '@/components/PageHeader';

interface Alert {
  id: number;
  source_agent: string;
  alert_type: string;
  title: string;
  description: string;
  urgency: string;
  status: string;
  related_task_id: number | null;
  related_proposal_id: number | null;
  telegram_sent: number;
  created_at: string;
  actioned_at: string | null;
}

const agentNames: Record<string, string> = { pm: '懶懶', planner: '小企', engineer: '小工' };
const urgencyColors: Record<string, string> = {
  urgent: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  normal: 'bg-zinc-700/50 text-zinc-300 border-zinc-600',
  low: 'bg-zinc-800 text-zinc-500 border-zinc-700',
};
const statusColors: Record<string, string> = {
  unread: 'bg-brand/20 text-brand',
  read: 'bg-zinc-700 text-zinc-400',
  actioned: 'bg-emerald-500/20 text-emerald-400',
  dismissed: 'bg-zinc-800 text-zinc-600',
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState<{ status?: string; agent?: string; urgency?: string }>({});
  const [loading, setLoading] = useState(true);

  const fetchAlerts = useCallback(async () => {
    const params = new URLSearchParams();
    if (filter.status) params.set('status', filter.status);
    if (filter.agent) params.set('agent', filter.agent);
    if (filter.urgency) params.set('urgency', filter.urgency);

    const res = await fetch(`/api/alerts?${params}`);
    const data = await res.json();
    setAlerts(data.alerts || []);
    setUnreadCount(data.unreadCount || 0);
    setLoading(false);
  }, [filter]);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  const updateStatus = async (id: number, status: string) => {
    await fetch('/api/alerts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    fetchAlerts();
  };

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <PageHeader
        title={
          <>
            通知
            {unreadCount > 0 && (
              <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-red-500/20 text-red-400">
                {unreadCount} unread
              </span>
            )}
          </>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        <FilterButton label="All" active={!filter.status} onClick={() => setFilter(f => ({ ...f, status: undefined }))} />
        <FilterButton label="Unread" active={filter.status === 'unread'} onClick={() => setFilter(f => ({ ...f, status: 'unread' }))} />
        <FilterButton label="Actioned" active={filter.status === 'actioned'} onClick={() => setFilter(f => ({ ...f, status: 'actioned' }))} />
        <FilterButton label="Dismissed" active={filter.status === 'dismissed'} onClick={() => setFilter(f => ({ ...f, status: 'dismissed' }))} />
        <span className="w-px h-6 bg-zinc-700 self-center mx-1" />
        <FilterButton label="All Agents" active={!filter.agent} onClick={() => setFilter(f => ({ ...f, agent: undefined }))} />
        <FilterButton label="懶懶" active={filter.agent === 'pm'} onClick={() => setFilter(f => ({ ...f, agent: 'pm' }))} />
        <FilterButton label="小企" active={filter.agent === 'planner'} onClick={() => setFilter(f => ({ ...f, agent: 'planner' }))} />
        <FilterButton label="小工" active={filter.agent === 'engineer'} onClick={() => setFilter(f => ({ ...f, agent: 'engineer' }))} />
      </div>

      {/* Alert List */}
      {loading ? (
        <div className="text-zinc-500 text-center py-12">Loading...</div>
      ) : alerts.length === 0 ? (
        <div className="text-zinc-500 text-center py-12">
          {filter.status || filter.agent ? 'No alerts match filters' : 'No alerts yet'}
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`bg-zinc-900 rounded-xl border p-4 transition-colors ${
                alert.status === 'unread' ? 'border-brand/30' : 'border-zinc-800'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {/* Top row: urgency + type + agent + time */}
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className={`px-1.5 py-0.5 text-[10px] uppercase font-medium rounded border ${urgencyColors[alert.urgency] || urgencyColors.normal}`}>
                      {alert.urgency}
                    </span>
                    <span className="text-[10px] text-zinc-500 uppercase">{alert.alert_type}</span>
                    <span className="text-xs text-zinc-500">
                      {agentNames[alert.source_agent] || alert.source_agent}
                    </span>
                    <span className="text-[10px] text-zinc-600">{formatDate(alert.created_at)}</span>
                    {alert.telegram_sent === 1 && (
                      <span className="text-[10px] text-zinc-600" title="Telegram sent">TG</span>
                    )}
                  </div>

                  {/* Title */}
                  <h3 className={`text-sm font-medium ${alert.status === 'unread' ? 'text-zinc-100' : 'text-zinc-400'}`}>
                    {alert.title}
                  </h3>

                  {/* Description */}
                  <p className="text-xs text-zinc-500 mt-1 whitespace-pre-wrap line-clamp-3">
                    {alert.description}
                  </p>

                  {/* Related links */}
                  {(alert.related_task_id || alert.related_proposal_id) && (
                    <div className="flex gap-3 mt-2">
                      {alert.related_task_id && (
                        <a href={`/tasks`} className="text-xs text-brand hover:text-brand-light transition-colors cursor-pointer">
                          Task #{alert.related_task_id}
                        </a>
                      )}
                      {alert.related_proposal_id && (
                        <a href="/agent-log?tab=proposals" className="text-xs text-brand hover:text-brand-light transition-colors cursor-pointer">
                          Proposal #{alert.related_proposal_id}
                        </a>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-1.5 shrink-0">
                  <span className={`px-2 py-0.5 text-[10px] rounded-full text-center ${statusColors[alert.status] || statusColors.unread}`}>
                    {alert.status}
                  </span>
                  {alert.status === 'unread' && (
                    <>
                      <button
                        onClick={() => updateStatus(alert.id, 'actioned')}
                        className="px-2 py-1 text-[10px] rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors cursor-pointer"
                      >
                        Action
                      </button>
                      <button
                        onClick={() => updateStatus(alert.id, 'dismissed')}
                        className="px-2 py-1 text-[10px] rounded bg-zinc-800 text-zinc-500 hover:bg-zinc-700 transition-colors cursor-pointer"
                      >
                        Dismiss
                      </button>
                    </>
                  )}
                  {alert.status === 'read' && (
                    <button
                      onClick={() => updateStatus(alert.id, 'actioned')}
                      className="px-2 py-1 text-[10px] rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors cursor-pointer"
                    >
                      Action
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-xs rounded-full transition-colors cursor-pointer ${
        active
          ? 'bg-brand/20 text-brand border border-brand/30'
          : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600'
      }`}
    >
      {label}
    </button>
  );
}
