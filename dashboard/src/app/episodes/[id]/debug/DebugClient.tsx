'use client';

import { useState, useEffect } from 'react';

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
  input_messages: string | null;
  output_content: string | null;
  created_at: string;
}

interface Stage {
  name: string;
  label: string;
  elapsed_ms: number | null;
  started_at: string | null;
  outputData: Record<string, unknown> | null;
  llmCalls: LlmCall[];
}

interface WrittenTool {
  canonicalName: string;
  rawName: string;
  category: string;
  mentionType: string;
  significanceScore: number;
  versionDetail: string;
  contextSnippet: string;
}

interface DebugData {
  episode: { id: number; episode_number: number | null; selected_title: string | null; status: string; segment_type: string; created_at: string };
  pipelineRun: { id: number; status: string; current_stage: string | null; started_at: string; completed_at: string | null; error_log: string | null } | null;
  stages: Stage[];
  memory: {
    read: { knownToolNames: string[]; briefForScriptGen: string } | null;
    written: WrittenTool[];
  };
}

const MENTION_TYPE_COLORS: Record<string, string> = {
  new: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  update: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  deep_dive: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  brief: 'bg-zinc-700/50 text-zinc-400 border-zinc-600/30',
};

export default function DebugClient({ episodeId }: { episodeId: number }) {
  const [data, setData] = useState<DebugData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/episodes/${episodeId}/debug`)
      .then((r) => r.json())
      .then((d) => { if (d.error) throw new Error(d.error); setData(d); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [episodeId]);

  if (loading) return <div className="text-zinc-400 text-sm">Loading...</div>;
  if (error) return <div className="text-red-400 text-sm">Error: {error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Pipeline Run Summary */}
      {data.pipelineRun && (
        <div className="flex items-center gap-4 text-xs text-zinc-400">
          <span>Run #{data.pipelineRun.id}</span>
          <span className={data.pipelineRun.status === 'completed' ? 'text-emerald-400' : data.pipelineRun.status === 'failed' ? 'text-red-400' : 'text-yellow-400'}>
            {data.pipelineRun.status}
          </span>
          {data.pipelineRun.started_at && <span>{data.pipelineRun.started_at.replace('T', ' ').slice(0, 19)}</span>}
        </div>
      )}

      {/* Memory Section */}
      <MemorySection memory={data.memory} />

      {/* Pipeline Stages */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800">
        <div className="px-4 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-300">Pipeline Stages</h2>
        </div>
        <div className="divide-y divide-zinc-800/50">
          {data.stages.map((stage) => (
            <StageRow key={stage.name} stage={stage} />
          ))}
        </div>
        {data.stages.length === 0 && (
          <div className="px-4 py-8 text-center text-zinc-500 text-sm">No pipeline snapshots found</div>
        )}
      </div>
    </div>
  );
}

function MemorySection({ memory }: { memory: DebugData['memory'] }) {
  const [showBrief, setShowBrief] = useState(false);

  if (!memory.read && memory.written.length === 0) {
    return (
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 px-4 py-6 text-center text-zinc-500 text-sm">
        No memory data (pipeline may predate memory system)
      </div>
    );
  }

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
      <h2 className="text-sm font-medium text-zinc-300 mb-4">Memory</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Read */}
        <div>
          <h3 className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
            Read ({memory.read?.knownToolNames.length ?? 0} tools matched)
          </h3>
          {memory.read && memory.read.knownToolNames.length > 0 ? (
            <div className="space-y-1.5">
              {memory.read.knownToolNames.map((name) => (
                <div key={name} className="text-sm text-zinc-300 px-2 py-1 bg-zinc-800 rounded">
                  {name}
                </div>
              ))}
              <button
                onClick={() => setShowBrief(!showBrief)}
                className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors mt-2 cursor-pointer"
              >
                {showBrief ? 'Hide prompt context' : 'Show prompt context'}
              </button>
              {showBrief && memory.read.briefForScriptGen && (
                <pre className="mt-2 text-[11px] text-zinc-400 bg-zinc-950 rounded p-3 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
                  {memory.read.briefForScriptGen}
                </pre>
              )}
            </div>
          ) : (
            <p className="text-xs text-zinc-500">No tools matched from memory</p>
          )}
        </div>

        {/* Written */}
        <div>
          <h3 className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
            Written ({memory.written.length} tools)
          </h3>
          {memory.written.length > 0 ? (
            <div className="space-y-2">
              {memory.written.map((tool, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="text-zinc-200 font-medium min-w-0 truncate">{tool.canonicalName}</span>
                  <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border ${MENTION_TYPE_COLORS[tool.mentionType] || MENTION_TYPE_COLORS.brief}`}>
                    {tool.mentionType}
                  </span>
                  {tool.significanceScore > 0 && (
                    <div className="shrink-0 w-12 h-1.5 bg-zinc-800 rounded-full overflow-hidden" title={`Significance: ${tool.significanceScore}`}>
                      <div
                        className="h-full bg-brand rounded-full"
                        style={{ width: `${Math.round(tool.significanceScore * 100)}%` }}
                      />
                    </div>
                  )}
                  {tool.versionDetail && (
                    <span className="shrink-0 text-[10px] text-zinc-500">{tool.versionDetail}</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-500">No tools extracted</p>
          )}
        </div>
      </div>
    </div>
  );
}

function StageRow({ stage }: { stage: Stage }) {
  const [expanded, setExpanded] = useState(false);
  const hasLlmCalls = stage.llmCalls.length > 0;
  const hasFailed = stage.llmCalls.some((c) => !c.success);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-800/30 transition-colors cursor-pointer text-left"
      >
        {/* Status icon */}
        <span className="shrink-0 text-sm">
          {stage.outputData ? (hasFailed ? '!' : 'v') : 'o'}
        </span>

        {/* Stage name */}
        <span className="text-sm text-zinc-200 min-w-[120px]">{stage.label}</span>

        {/* Elapsed time */}
        <span className="text-xs text-zinc-500 tabular-nums min-w-[50px]">
          {stage.elapsed_ms != null ? `${(stage.elapsed_ms / 1000).toFixed(1)}s` : '--'}
        </span>

        {/* LLM call count */}
        {hasLlmCalls && (
          <span className={`text-[11px] px-1.5 py-0.5 rounded ${hasFailed ? 'bg-red-500/10 text-red-400' : 'bg-zinc-800 text-zinc-400'}`}>
            {stage.llmCalls.length} LLM call{stage.llmCalls.length > 1 ? 's' : ''}
            {hasFailed ? ' (failed)' : ''}
          </span>
        )}

        {/* Total cost */}
        {hasLlmCalls && (
          <span className="text-[11px] text-zinc-500 tabular-nums ml-auto">
            ${stage.llmCalls.reduce((sum, c) => sum + (c.cost_usd || 0), 0).toFixed(4)}
          </span>
        )}

        {/* Expand chevron */}
        <svg
          className={`w-3.5 h-3.5 text-zinc-500 transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Output snapshot */}
          {stage.outputData && (
            <OutputViewer data={stage.outputData} />
          )}

          {/* LLM Calls */}
          {stage.llmCalls.map((call) => (
            <LlmCallCard key={call.id} call={call} />
          ))}

          {!stage.outputData && stage.llmCalls.length === 0 && (
            <p className="text-xs text-zinc-500">No data for this stage</p>
          )}
        </div>
      )}
    </div>
  );
}

function OutputViewer({ data }: { data: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  const preview = JSON.stringify(data, null, 2);
  const isLong = preview.length > 500;

  return (
    <div className="bg-zinc-950 rounded-lg border border-zinc-800/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 cursor-pointer"
      >
        <span className="text-[11px] text-zinc-500">Output Snapshot</span>
        <span className="text-[10px] text-zinc-600">{expanded ? 'Collapse' : 'Expand'}</span>
      </button>
      {expanded && (
        <pre className={`px-3 pb-3 text-[11px] text-zinc-400 overflow-x-auto whitespace-pre-wrap ${isLong ? 'max-h-96 overflow-y-auto' : ''}`}>
          {preview}
        </pre>
      )}
    </div>
  );
}

function LlmCallCard({ call }: { call: LlmCall }) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [showResponse, setShowResponse] = useState(false);

  // Parse input_messages to display nicely
  let promptText = call.input_messages || '';
  if (promptText) {
    try {
      const messages = JSON.parse(promptText);
      if (Array.isArray(messages)) {
        promptText = messages.map((m: { role: string; content: string }) => `[${m.role}]\n${m.content}`).join('\n\n---\n\n');
      }
    } catch { /* use raw */ }
  }

  return (
    <div className={`rounded-lg border ${call.success ? 'border-zinc-800/50 bg-zinc-900/50' : 'border-red-900/30 bg-red-950/10'} p-3`}>
      {/* Header */}
      <div className="flex items-center gap-3 text-xs">
        <span className="text-zinc-400 font-medium">{call.stage}</span>
        <span className="text-zinc-500">{call.model?.split('/').pop()}</span>
        {call.cost_usd != null && (
          <span className="text-zinc-500 tabular-nums">${call.cost_usd.toFixed(4)}</span>
        )}
        {call.latency_ms != null && (
          <span className="text-zinc-500 tabular-nums">{(call.latency_ms / 1000).toFixed(1)}s</span>
        )}
        {call.input_tokens != null && call.output_tokens != null && (
          <span className="text-zinc-600 tabular-nums text-[10px]">{call.input_tokens}+{call.output_tokens} tok</span>
        )}
        {!call.success && (
          <span className="text-red-400 text-[10px]">FAILED</span>
        )}
      </div>

      {/* Error */}
      {call.error_message && (
        <p className="text-[11px] text-red-300 mt-1 font-mono">{call.error_message}</p>
      )}

      {/* Toggle buttons */}
      <div className="flex gap-2 mt-2">
        {promptText && (
          <button
            onClick={() => setShowPrompt(!showPrompt)}
            className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
          >
            {showPrompt ? 'Hide Prompt' : 'Prompt'}
          </button>
        )}
        {call.output_content && (
          <button
            onClick={() => setShowResponse(!showResponse)}
            className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
          >
            {showResponse ? 'Hide Response' : 'Response'}
          </button>
        )}
        {!promptText && !call.output_content && (
          <span className="text-[10px] text-zinc-600">No prompt/response stored (pre-logging pipeline run)</span>
        )}
      </div>

      {/* Prompt content */}
      {showPrompt && promptText && (
        <pre className="mt-2 text-[11px] text-zinc-400 bg-zinc-950 rounded p-3 overflow-x-auto whitespace-pre-wrap max-h-80 overflow-y-auto">
          {promptText}
        </pre>
      )}

      {/* Response content */}
      {showResponse && call.output_content && (
        <pre className="mt-2 text-[11px] text-zinc-300 bg-zinc-950 rounded p-3 overflow-x-auto whitespace-pre-wrap max-h-80 overflow-y-auto">
          {call.output_content}
        </pre>
      )}
    </div>
  );
}
