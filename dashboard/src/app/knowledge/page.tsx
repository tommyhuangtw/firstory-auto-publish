import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import { getAllDocs, getDocCategories, getDocContent } from '@/services/knowledgeService';

// Reads SQLite/filesystem at render — must render per-request, never statically prerendered.
export const dynamic = 'force-dynamic';

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

const categoryColors: Record<string, string> = {
  content:      'bg-purple-900/50 text-purple-300',
  infra:        'bg-zinc-800 text-zinc-400',
  social_media: 'bg-pink-900/50 text-pink-300',
  youtube:      'bg-red-900/50 text-red-300',
  ig:           'bg-fuchsia-900/50 text-fuchsia-300',
  threads:      'bg-sky-900/50 text-sky-300',
  research:     'bg-teal-900/50 text-teal-300',
  ops:          'bg-amber-900/50 text-amber-300',
  growth:       'bg-green-900/50 text-green-300',
};

export default function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; category?: string }>;
}) {
  return <KnowledgeContent searchParamsPromise={searchParams} />;
}

async function KnowledgeContent({
  searchParamsPromise,
}: {
  searchParamsPromise: Promise<{ search?: string; category?: string }>;
}) {
  const { search, category } = await searchParamsPromise;
  const docs = getAllDocs({ search, category });
  const categories = getDocCategories();

  return (
    <div className="p-6 md:p-8">
      <PageHeader
        title="知識庫"
        subtitle={`共 ${docs.length} 份研究文件`}
      />

      {/* Category Filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Link
          href="/knowledge"
          className={`px-3 py-1 rounded-full text-xs transition-colors ${
            !category ? 'bg-brand text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
          }`}
        >
          全部
        </Link>
        {categories.map((cat) => (
          <Link
            key={cat}
            href={`/knowledge?category=${cat}`}
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
          placeholder="搜尋文件..."
          className="w-full sm:w-72 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
        />
      </form>

      {/* Document Grid */}
      {docs.length === 0 ? (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-400">
            {search || category
              ? '沒有符合篩選條件的文件。'
              : '尚無研究文件。完成一個研究任務後即可開始。'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {docs.map((doc) => {
            // Get first ~150 chars of content as preview
            const content = getDocContent(doc.filename);
            const preview = content
              ? content.replace(/^#.+\n/m, '').replace(/[#*_\[\]()>`-]/g, '').trim().slice(0, 150)
              : '';

            return (
              <Link
                key={doc.id}
                href={`/knowledge/${encodeURIComponent(doc.filename)}`}
                className="bg-zinc-900 rounded-lg border border-zinc-800 p-4 hover:border-brand/30 transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${categoryColors[doc.category] || 'bg-zinc-800 text-zinc-400'}`}>
                    {doc.category}
                  </span>
                  {doc.task_id && (
                    <span className="text-[10px] text-zinc-500 font-mono">
                      Task #{doc.task_id}
                    </span>
                  )}
                </div>
                <h3 className="font-medium text-zinc-200 line-clamp-2 mb-2">{doc.title}</h3>
                {preview && (
                  <p className="text-xs text-zinc-400 line-clamp-2 mb-3">{preview}</p>
                )}
                <div className="flex items-center gap-3 text-xs text-zinc-500">
                  {doc.word_count && <span>{doc.word_count.toLocaleString()} words</span>}
                  <span>{formatShortDate(doc.created_at)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
