'use client';

import { useEffect, useState } from 'react';

interface Job {
  name: string;
  schedule: string;
  enabled: boolean;
  running: boolean;
  lastRun: string | null;
  lastError: string | null;
}

export default function SchedulerClient() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggeringJob, setTriggeringJob] = useState<string | null>(null);
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

  if (loading) {
    return <div className="p-8 text-zinc-400">Loading scheduler...</div>;
  }

  return (
    <div className="p-6 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">排程管理</h1>
        <p className="text-zinc-400 text-sm mt-1">管理 cron 排程任務</p>
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
          {jobs.map((job) => (
            <div
              key={job.name}
              className="bg-zinc-900 rounded-lg border border-zinc-800 p-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${
                    job.running ? 'bg-green-400' : job.enabled ? 'bg-yellow-400' : 'bg-zinc-600'
                  }`} />
                  <span className="font-medium text-sm">{job.name}</span>
                  <code className="text-xs text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded">
                    {job.schedule}
                  </code>
                  <span className={`text-xs ${job.enabled ? 'text-green-400' : 'text-zinc-400'}`}>
                    {job.enabled ? '啟用' : '停用'}
                  </span>
                </div>
                <button
                  onClick={() => handleTrigger(job.name)}
                  disabled={triggeringJob === job.name}
                  className="text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors"
                >
                  {triggeringJob === job.name ? '執行中...' : '手動觸發'}
                </button>
              </div>

              <div className="mt-2 flex items-center gap-4 text-xs text-zinc-400">
                {job.lastRun && (
                  <span>上次執行: {new Date(job.lastRun).toLocaleString('zh-TW')}</span>
                )}
                {!job.lastRun && <span>尚未執行過</span>}
              </div>

              {job.lastError && (
                <div className="mt-2 bg-red-950/30 border border-red-900/50 rounded p-2">
                  <p className="text-xs text-red-400 font-mono">{job.lastError}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
