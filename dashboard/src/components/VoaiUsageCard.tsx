'use client';

import { useEffect, useState } from 'react';

interface VoaiUsage {
  total: number;
  current: number;
  expiration: string;
}

export default function VoaiUsageCard() {
  const [usage, setUsage] = useState<VoaiUsage | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/voai/usage')
      .then((r) => r.json())
      .then((data) => {
        if (data.data) setUsage(data.data);
        else setError(true);
      })
      .catch(() => setError(true));
  }, []);

  if (error) {
    return (
      <div className="bg-zinc-900 rounded-lg p-6 border border-zinc-800 hover:border-brand/30 transition-colors">
        <h2 className="text-sm font-medium text-brand-taupe uppercase tracking-wider">VoAI TTS</h2>
        <p className="text-sm text-zinc-500 mt-2">無法連線</p>
      </div>
    );
  }

  if (!usage) {
    return (
      <div className="bg-zinc-900 rounded-lg p-6 border border-zinc-800 animate-pulse">
        <div className="h-3 bg-zinc-800 rounded w-16 mb-3" />
        <div className="h-7 bg-zinc-800 rounded w-24 mb-2" />
        <div className="h-3 bg-zinc-800 rounded w-32" />
      </div>
    );
  }

  const used = usage.total - usage.current;
  const pct = Math.round((used / usage.total) * 100);
  const remaining = usage.current;

  // Color coding: green < 50%, yellow 50-80%, red > 80%
  const barColor = pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-yellow-500' : 'bg-green-500';
  const textColor = pct > 80 ? 'text-red-400' : pct > 50 ? 'text-yellow-400' : 'text-green-400';

  const expDate = new Date(usage.expiration);
  const expStr = `${expDate.getFullYear()}/${expDate.getMonth() + 1}/${expDate.getDate()}`;

  return (
    <div className="bg-zinc-900 rounded-lg p-6 border border-zinc-800 hover:border-brand/30 transition-colors">
      <h2 className="text-sm font-medium text-brand-taupe uppercase tracking-wider">VoAI TTS</h2>
      <p className={`text-2xl font-bold mt-2 ${textColor}`}>
        {remaining.toLocaleString()}
      </p>
      <p className="text-zinc-400 text-sm mt-1">
        / {usage.total.toLocaleString()} 字
      </p>
      {/* Usage bar */}
      <div className="mt-3 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-zinc-500 text-xs mt-1.5">
        已用 {pct}% &middot; 到期 {expStr}
      </p>
    </div>
  );
}
