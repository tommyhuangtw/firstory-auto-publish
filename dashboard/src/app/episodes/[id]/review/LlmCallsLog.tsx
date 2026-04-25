'use client';

import { useState } from 'react';

interface LlmCall {
  id: number;
  stage: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  success: number;
  error_message: string | null;
  created_at: string;
}

interface Props {
  calls: LlmCall[];
}

export default function LlmCallsLog({ calls }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (calls.length === 0) return null;

  const totalCost = calls.reduce((sum, c) => sum + (c.cost_usd || 0), 0);
  const totalTokens = calls.reduce((sum, c) => sum + (c.input_tokens || 0) + (c.output_tokens || 0), 0);
  const failedCount = calls.filter((c) => !c.success).length;

  const displayed = expanded ? calls : calls.slice(0, 5);

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-300">LLM Calls</h3>
        <div className="flex items-center gap-3 text-[11px] text-zinc-400">
          <span>{calls.length} calls</span>
          <span className="tabular-nums">{totalTokens.toLocaleString()} tokens</span>
          <span className="tabular-nums">${totalCost.toFixed(4)}</span>
          {failedCount > 0 && (
            <span className="text-red-400">{failedCount} failed</span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-zinc-400 border-b border-zinc-800/50">
              <th className="text-left px-4 py-2 font-medium">Stage</th>
              <th className="text-left px-4 py-2 font-medium">Model</th>
              <th className="text-right px-4 py-2 font-medium">Tokens</th>
              <th className="text-right px-4 py-2 font-medium">Cost</th>
              <th className="text-right px-4 py-2 font-medium">Latency</th>
              <th className="text-center px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/30">
            {displayed.map((call) => (
              <tr key={call.id} className="hover:bg-zinc-800/30 transition-colors">
                <td className="px-4 py-2 text-zinc-400">{call.stage}</td>
                <td className="px-4 py-2 text-zinc-400 font-mono">{call.model.split('/').pop()}</td>
                <td className="px-4 py-2 text-right text-zinc-400 tabular-nums">
                  {((call.input_tokens || 0) + (call.output_tokens || 0)).toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right text-zinc-400 tabular-nums">
                  {call.cost_usd != null ? `$${call.cost_usd.toFixed(4)}` : '-'}
                </td>
                <td className="px-4 py-2 text-right text-zinc-400 tabular-nums">
                  {call.latency_ms != null ? `${(call.latency_ms / 1000).toFixed(1)}s` : '-'}
                </td>
                <td className="px-4 py-2 text-center">
                  {call.success ? (
                    <span className="text-emerald-500">ok</span>
                  ) : (
                    <span className="text-red-400" title={call.error_message || ''}>fail</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {calls.length > 5 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full px-4 py-2 text-xs text-zinc-400 hover:text-zinc-300 border-t border-zinc-800/50 transition-colors cursor-pointer"
        >
          {expanded ? '收起' : `顯示全部 ${calls.length} 筆`}
        </button>
      )}
    </div>
  );
}
