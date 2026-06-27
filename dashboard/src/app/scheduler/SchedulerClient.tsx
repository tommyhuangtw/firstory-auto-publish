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

export default function SchedulerClient() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggeringJob, setTriggeringJob] = useState<string | null>(null);
  const [skippingJob, setSkippingJob] = useState<string | null>(null);
  const [message, setMessage] = useState('');

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
    </div>
  );
}
