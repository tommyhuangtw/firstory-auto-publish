'use client';

import { useEffect, useState } from 'react';

interface Job {
  name: string;
  schedule: string;
  enabled: boolean;
  running: boolean;
  lastRun: string | null;
  lastError: string | null;
  skippedUntil: string | null;
}

export default function SchedulerClient() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggeringJob, setTriggeringJob] = useState<string | null>(null);
  const [skippingJob, setSkippingJob] = useState<string | null>(null);
  const [togglingJob, setTogglingJob] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  async function fetchJobs() {
    try {
      const res = await fetch('/api/scheduler/status');
      const data = await res.json();
      setJobs(data.jobs || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchJobs();
  }, []);

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

  async function handleEnableToggle(name: string, isEnabled: boolean) {
    setTogglingJob(name);
    setMessage('');
    try {
      const res = await fetch('/api/scheduler/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, action: isEnabled ? 'disable' : 'enable' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage(data.message);
      fetchJobs();
    } catch (err) {
      setMessage(`錯誤: ${(err as Error).message}`);
    } finally {
      setTogglingJob(null);
    }
  }

  async function handleSkipToggle(name: string, isSkipped: boolean) {
    setSkippingJob(name);
    setMessage('');
    try {
      const res = await fetch('/api/scheduler/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, action: isSkipped ? 'unskip' : 'skip' }),
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
    return <div className="p-8 text-zinc-400">Loading scheduler...</div>;
  }

  return (
    <div className="p-6 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <span className="w-1 h-6 rounded-full bg-brand" />
          排程管理
        </h1>
        <p className="text-brand-taupe text-sm mt-1">管理 cron 排程任務</p>
      </header>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          message.startsWith('錯誤') ? 'bg-red-950/30 text-red-400' : 'bg-green-950/30 text-green-400'
        }`}>
          {message}
        </div>
      )}

      {jobs.length === 0 ? (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-400">尚未註冊任何排程任務。</p>
          <p className="text-zinc-400 text-xs mt-1">
            在程式碼中使用 scheduler.register() 來新增任務
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => {
            const isSkipped = !!job.skippedUntil;
            const isDisabled = !job.enabled;
            return (
              <div
                key={job.name}
                className={`bg-zinc-900 rounded-lg border p-4 ${
                  isDisabled ? 'border-zinc-800 opacity-60'
                    : isSkipped ? 'border-yellow-900/40'
                    : 'border-zinc-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full ${
                      isDisabled ? 'bg-zinc-600'
                        : isSkipped ? 'bg-yellow-400'
                        : job.running ? 'bg-brand'
                        : 'bg-brand'
                    }`} />
                    <span className={`font-medium text-sm ${isDisabled ? 'text-zinc-500' : ''}`}>{job.name}</span>
                    <code className="text-xs text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded">
                      {job.schedule}
                    </code>
                    {isDisabled ? (
                      <span className="text-xs text-red-400">已停用</span>
                    ) : isSkipped ? (
                      <span className="text-xs text-yellow-400">已跳過今天</span>
                    ) : (
                      <span className="text-xs text-brand">啟用</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Enable / Disable */}
                    <button
                      onClick={() => handleEnableToggle(job.name, job.enabled)}
                      disabled={togglingJob === job.name}
                      className={`text-xs px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50 ${
                        isDisabled
                          ? 'bg-green-900/30 hover:bg-green-900/50 text-green-300'
                          : 'bg-red-900/20 hover:bg-red-900/40 text-red-300'
                      }`}
                    >
                      {togglingJob === job.name ? '處理中...' : isDisabled ? '啟用' : '停用'}
                    </button>
                    {/* Skip today (only when enabled) */}
                    {!isDisabled && (
                      <button
                        onClick={() => handleSkipToggle(job.name, isSkipped)}
                        disabled={skippingJob === job.name}
                        className={`text-xs px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50 ${
                          isSkipped
                            ? 'bg-yellow-900/30 hover:bg-yellow-900/50 text-yellow-300'
                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                        }`}
                      >
                        {skippingJob === job.name ? '處理中...' : isSkipped ? '恢復排程' : '跳過今天'}
                      </button>
                    )}
                    {/* Manual trigger */}
                    <button
                      onClick={() => handleTrigger(job.name)}
                      disabled={triggeringJob === job.name}
                      className="text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                    >
                      {triggeringJob === job.name ? '執行中...' : '手動觸發'}
                    </button>
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-4 text-xs text-zinc-400">
                  {job.lastRun && (
                    <span>上次執行: {new Date(job.lastRun).toLocaleString('zh-TW')}</span>
                  )}
                  {!job.lastRun && <span>尚未執行過</span>}
                  {isSkipped && (
                    <span className="text-yellow-400/70">午夜後自動恢復</span>
                  )}
                </div>

                {job.lastError && (
                  <div className="mt-2 bg-red-950/30 border border-red-900/50 rounded p-2">
                    <p className="text-xs text-red-400 font-mono">{job.lastError}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
