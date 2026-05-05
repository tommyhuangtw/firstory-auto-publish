import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getToolByName, getToolMentions } from '@/services/memory/memoryService';

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default async function ToolDetailPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const decodedName = decodeURIComponent(name);
  const tool = getToolByName(decodedName);
  if (!tool) notFound();

  const mentions = getToolMentions(tool.id);
  const aliases: string[] = tool.aliases ? JSON.parse(tool.aliases) : [];

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto">
      <Link href="/memory" className="text-sm text-zinc-400 hover:text-zinc-300 mb-4 inline-block">
        ← Back to tools
      </Link>

      <header className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{tool.canonical_name}</h1>
          {tool.latest_version_detail && (
            <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-500 text-xs">
              {tool.latest_version_detail}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-2">
          {tool.category && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-zinc-800 text-zinc-400">
              {tool.category}
            </span>
          )}
          <span className="text-sm text-zinc-400">{tool.mention_count}x mentioned</span>
        </div>
        {aliases.length > 0 && (
          <p className="text-xs text-zinc-400 mt-1">
            Also known as: {aliases.join(', ')}
          </p>
        )}
      </header>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-3 text-center">
          <p className="text-2xl font-bold">{tool.mention_count}</p>
          <p className="text-xs text-zinc-400">Mentions</p>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-3 text-center">
          <p className="text-2xl font-bold">{formatDate(tool.first_seen_date)}</p>
          <p className="text-xs text-zinc-400">First seen</p>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-3 text-center">
          <p className="text-2xl font-bold">{formatDate(tool.latest_seen_date)}</p>
          <p className="text-xs text-zinc-400">Latest</p>
        </div>
      </div>

      {/* Compacted Summary */}
      {(tool.current_summary || tool.evolving_summary) && (
        <section className="mb-6 bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider">
              Summary
            </h2>
            {tool.summary_version > 0 && (
              <span className="text-[10px] text-zinc-500">
                v{tool.summary_version} compaction
              </span>
            )}
          </div>
          <p className="text-sm text-zinc-300 whitespace-pre-wrap">
            {tool.current_summary || tool.evolving_summary}
          </p>
        </section>
      )}

      {/* Mention Timeline */}
      <section>
        <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider mb-3">
          Mention History ({mentions.length})
        </h2>
        {mentions.length === 0 ? (
          <p className="text-zinc-400 text-sm">No mention records yet.</p>
        ) : (
          <div className="space-y-2">
            {mentions.map((m) => (
              <div
                key={m.id}
                className="bg-zinc-900 rounded-lg border border-zinc-800 p-3"
              >
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-mono text-sm text-zinc-300">
                    {formatDate(m.aired_date)}
                  </span>
                  {m.mention_type && (
                    <MentionTypeBadge type={m.mention_type} />
                  )}
                  {m.segment_type && (
                    <span className="text-xs text-zinc-400">{m.segment_type}</span>
                  )}
                  {m.version_detail && (
                    <span className="text-xs text-zinc-500">v{m.version_detail}</span>
                  )}
                  {m.significance > 0.7 && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-amber-900/50 text-amber-300">
                      significant
                    </span>
                  )}
                </div>
                {m.context_snippet && (
                  <p className="text-xs text-zinc-400">{m.context_snippet}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MentionTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    new: 'bg-green-900/50 text-green-300',
    update: 'bg-blue-900/50 text-blue-300',
    deep_dive: 'bg-purple-900/50 text-purple-300',
    brief: 'bg-zinc-800 text-zinc-400',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs ${colors[type] || colors.brief}`}>
      {type}
    </span>
  );
}
