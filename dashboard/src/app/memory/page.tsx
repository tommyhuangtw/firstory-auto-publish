import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import { getAllTools, getToolCategories } from '@/services/memory/memoryService';

// Reads SQLite at render — must render per-request, never statically prerendered at build.
export const dynamic = 'force-dynamic';

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const categoryColors: Record<string, string> = {
  LLM: 'bg-purple-900/50 text-purple-300',
  DevTool: 'bg-blue-900/50 text-blue-300',
  Image: 'bg-pink-900/50 text-pink-300',
  Audio: 'bg-orange-900/50 text-orange-300',
  Video: 'bg-red-900/50 text-red-300',
  Productivity: 'bg-green-900/50 text-green-300',
  Automation: 'bg-yellow-900/50 text-yellow-300',
  Search: 'bg-cyan-900/50 text-cyan-300',
  Database: 'bg-indigo-900/50 text-indigo-300',
  Robotics: 'bg-emerald-900/50 text-emerald-300',
  Company: 'bg-amber-900/50 text-amber-300',
  Platform: 'bg-teal-900/50 text-teal-300',
  Other: 'bg-zinc-800 text-zinc-400',
};

export default function MemoryPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; category?: string }>;
}) {
  // Next.js 16: searchParams is a promise in server components, but we can
  // access it synchronously since this is a dynamic page
  return <MemoryContent searchParamsPromise={searchParams} />;
}

async function MemoryContent({
  searchParamsPromise,
}: {
  searchParamsPromise: Promise<{ search?: string; category?: string }>;
}) {
  const { search, category } = await searchParamsPromise;
  const tools = getAllTools({ search, category, sortBy: 'mention_count' });
  const categories = getToolCategories();

  return (
    <div className="p-6 md:p-8">
      <PageHeader
        title="工具記憶"
        subtitle={`已追蹤 ${tools.length} 個工具`}
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Link
          href="/memory"
          className={`px-3 py-1 rounded-full text-xs transition-colors ${
            !category ? 'bg-brand text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
          }`}
        >
          全部
        </Link>
        {categories.map((cat) => (
          <Link
            key={cat}
            href={`/memory?category=${cat}`}
            className={`px-3 py-1 rounded-full text-xs transition-colors ${
              category === cat
                ? 'bg-brand text-white'
                : categoryColors[cat] || 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            {cat}
          </Link>
        ))}
      </div>

      {/* Search */}
      <form className="mb-6">
        <input
          type="text"
          name="search"
          defaultValue={search}
          placeholder="搜尋工具..."
          className="w-full sm:w-72 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
        />
      </form>

      {/* Tool List */}
      {tools.length === 0 ? (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-400">
            {search || category
              ? '沒有符合篩選條件的工具。'
              : '尚無追蹤的工具。執行流程後開始建立知識庫。'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {tools.map((tool) => (
            <Link
              key={tool.id}
              href={`/memory/${encodeURIComponent(tool.canonical_name)}`}
              className="bg-zinc-900 rounded-lg border border-zinc-800 p-4 hover:border-brand/30 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-zinc-200">{tool.canonical_name}</h3>
                  {tool.latest_version_detail && (
                    <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 text-[10px]">
                      {tool.latest_version_detail}
                    </span>
                  )}
                </div>
                {tool.category && (
                  <span className={`px-2 py-0.5 rounded-full text-xs ${categoryColors[tool.category] || categoryColors.Other}`}>
                    {tool.category}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 text-xs text-zinc-400">
                <span>{tool.mention_count}x mentioned</span>
                {tool.first_seen_date && <span>{formatShortDate(tool.first_seen_date)}</span>}
                {tool.latest_seen_date && tool.latest_seen_date !== tool.first_seen_date && (
                  <span>→ {formatShortDate(tool.latest_seen_date)}</span>
                )}
              </div>
              {(tool.current_summary || tool.evolving_summary) && (
                <p className="mt-2 text-xs text-zinc-400 line-clamp-2">
                  {(tool.current_summary || tool.evolving_summary || '').slice(0, 150)}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
