'use client';

import { useEffect, useState, useCallback } from 'react';
import WeeklyScheduleEditor from './WeeklyScheduleEditor';
import PageHeader from '@/components/PageHeader';

interface Job {
  name: string;
  schedule: string;
  enabled: boolean;
  running: boolean;
  lastRun: string | null;
  lastError: string | null;
  skipNextRun: boolean;
  paused: boolean;
}

const SEGMENT_LABELS: Record<string, string> = {
  daily: 'AI懶人報',
  weekly: 'AI精選週報',
  robot: '機器人週報',
  sysdesign: '系統架構',
};

const SEGMENT_COLORS: Record<string, string> = {
  daily: 'bg-blue-400',
  weekly: 'bg-green-400',
  robot: 'bg-orange-400',
  sysdesign: 'bg-purple-400',
};

interface AgentSchedule {
  enabled: boolean;
  steps: { time: string; label: string }[];
  enableCmd: string;
}

export default function SchedulerClient() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggeringJob, setTriggeringJob] = useState<string | null>(null);
  const [skippingJob, setSkippingJob] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [agent, setAgent] = useState<AgentSchedule | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/scheduler/status');
      const data = await res.json();
      setJobs(data.jobs || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    fetch('/api/system/agent-schedule').then((r) => r.json()).then(setAgent).catch(() => {});
  }, [fetchJobs]);

  async function handleTrigger(name: string) {
    setTriggeringJob(name);
    setMessage('');
    try {
      const res = await fetch('/api/scheduler/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage(`"${name}" 已觸發`);
      fetchJobs();
    } catch (err) {
      setMessage(`錯誤: ${(err as Error).message}`);
    } finally {
      setTriggeringJob(null);
    }
  }

  async function handleSkipToggle(name: string, isSkipped: boolean, actionOverride?: string) {
    setSkippingJob(name);
    setMessage('');
    try {
      const action = actionOverride || (isSkipped ? 'unskip' : 'skip');
      const res = await fetch('/api/scheduler/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage(data.message);
      fetchJobs();
    } catch (err) {
      setMessage(`錯誤: ${(err as Error).message}`);
    } finally {
      setSkippingJob(null);
    }
  }

  if (loading) {
    return <div className="p-6 md:p-8 text-zinc-400 text-sm">載入排程...</div>;
  }

  return (
    <div className="p-6 md:p-8">
      <PageHeader title="排程" subtitle="管理播客自動化排程" />

      <WeeklyScheduleEditor onSaved={fetchJobs} />

      {message && (
        <div className={`mb-3 px-3 py-2 rounded-lg text-xs ${
          message.startsWith('錯誤') ? 'bg-red-950/30 text-red-400' : 'bg-green-950/30 text-green-400'
        }`}>
          {message}
        </div>
      )}

      {/* Job runtime status — split into content vs system */}
      {jobs.length > 0 && (() => {
        const contentJobs = jobs.filter((j) => j.name in SEGMENT_LABELS);
        const systemJobs = jobs.filter((j) => !(j.name in SEGMENT_LABELS));

        function renderJobRow(job: Job, isSystem: boolean) {
          const isSkipped = job.skipNextRun && !job.paused;
          const segLabel = SEGMENT_LABELS[job.name] ?? job.name;
          const dotColor = isSystem ? 'bg-zinc-400' : (SEGMENT_COLORS[job.name] ?? 'bg-brand');

          return (
            <div key={job.name} className="px-4 py-2.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  job.paused ? 'bg-orange-400' : isSkipped ? 'bg-yellow-400' : dotColor
                }`} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{segLabel}</span>
                    <code className="text-[10px] text-zinc-500 bg-zinc-800/80 px-1.5 py-0.5 rounded shrink-0">
                      {job.schedule}
                    </code>
                    {job.paused && (
                      <span className="text-[10px] text-orange-400/80 shrink-0">已暫停</span>
                    )}
                    {!isSystem && isSkipped && (
                      <span className="text-[10px] text-yellow-400/80 shrink-0">將跳過下一集</span>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">
                    {job.lastRun
                      ? `上次: ${new Date(job.lastRun).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                      : '尚未執行'}
                    {!isSystem && isSkipped && <span className="text-yellow-500/60 ml-2">執行一次後自動恢復</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => handleSkipToggle(job.name, false, job.paused ? 'resume' : 'pause')}
                  disabled={skippingJob === job.name}
                  className={`text-[11px] px-2.5 py-1 rounded-md transition-colors cursor-pointer disabled:opacity-50 ${
                    job.paused
                      ? 'bg-orange-900/30 hover:bg-orange-900/50 text-orange-300'
                      : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'
                  }`}
                >
                  {skippingJob === job.name ? '...' : job.paused ? '恢復' : '暫停'}
                </button>
                {!isSystem && !job.paused && (
                  <button
                    onClick={() => handleSkipToggle(job.name, isSkipped)}
                    disabled={skippingJob === job.name}
                    className={`text-[11px] px-2.5 py-1 rounded-md transition-colors cursor-pointer disabled:opacity-50 ${
                      isSkipped
                        ? 'bg-yellow-900/30 hover:bg-yellow-900/50 text-yellow-300'
                        : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'
                    }`}
                  >
                    {skippingJob === job.name ? '...' : isSkipped ? '取消跳過' : '跳過下一集'}
                  </button>
                )}
                <button
                  onClick={() => handleTrigger(job.name)}
                  disabled={triggeringJob === job.name}
                  className="text-[11px] bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-400 px-2.5 py-1 rounded-md transition-colors cursor-pointer"
                >
                  {triggeringJob === job.name ? '執行中...' : '手動觸發'}
                </button>
              </div>
            </div>
          );
        }

        function renderErrorSection(jobList: Job[]) {
          const errJobs = jobList.filter((j) => j.lastError);
          if (errJobs.length === 0) return null;
          return (
            <div className="border-t border-zinc-800/80 px-4 py-2">
              {errJobs.map((job) => (
                <div key={`err-${job.name}`} className="flex items-start gap-2 py-1">
                  <span className="text-[10px] text-red-400 font-medium shrink-0">{SEGMENT_LABELS[job.name] ?? job.name}</span>
                  <p className="text-[10px] text-red-400/70 font-mono truncate">{job.lastError}</p>
                </div>
              ))}
            </div>
          );
        }

        return (
          <>
            {contentJobs.length > 0 && (
              <div className="bg-zinc-900/60 rounded-xl border border-zinc-800/80 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-zinc-800/80">
                  <h2 className="text-sm font-semibold text-zinc-200">內容排程</h2>
                </div>
                <div className="divide-y divide-zinc-800/60">
                  {contentJobs.map((job) => renderJobRow(job, false))}
                </div>
                {renderErrorSection(contentJobs)}
              </div>
            )}

            {systemJobs.length > 0 && (
              <div className="mt-4 bg-zinc-900/60 rounded-xl border border-zinc-800/80 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-zinc-800/80">
                  <h2 className="text-sm font-semibold text-zinc-200">系統任務</h2>
                </div>
                <div className="divide-y divide-zinc-800/60">
                  {systemJobs.map((job) => renderJobRow(job, true))}
                </div>
                {renderErrorSection(systemJobs)}
              </div>
            )}
          </>
        );
      })()}

      {/* Multi-agent orchestrator — launchd-based, shown with its real on/off state */}
      {agent && (
        <div className="mt-4 bg-zinc-900/60 rounded-xl border border-zinc-800/80 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-zinc-800/80 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-200">系統任務 · 多 Agent 自動排程</h2>
            <span className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${
              agent.enabled ? 'bg-green-950/40 text-green-400' : 'bg-zinc-800 text-zinc-400'
            }`}>
              {agent.enabled ? '● 啟用中' : '○ 已關閉'}
            </span>
          </div>
          <div className="px-4 py-3">
            <p className="text-[11px] text-zinc-500 mb-2.5">
              小企提案 → 懶懶評估 → 小工執行 → 早上老闆快報。
              {agent.enabled ? ' 目前每天自動執行。' : ' 目前已停用，需要時再啟用（之後可優化）。'}
            </p>
            <div className="space-y-1">
              {agent.steps.map((s) => (
                <div key={s.time} className="flex items-center gap-2 text-[12px]">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${agent.enabled ? 'bg-zinc-400' : 'bg-zinc-700'}`} />
                  <code className="text-[10px] text-zinc-500 bg-zinc-800/80 px-1.5 py-0.5 rounded shrink-0">{s.time}</code>
                  <span className={agent.enabled ? 'text-zinc-300' : 'text-zinc-600 line-through decoration-zinc-700'}>{s.label}</span>
                </div>
              ))}
            </div>
            {!agent.enabled && (
              <p className="text-[11px] text-zinc-600 mt-3">
                啟用：<code className="bg-zinc-800/80 text-zinc-400 px-1.5 py-0.5 rounded">{agent.enableCmd}</code>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
