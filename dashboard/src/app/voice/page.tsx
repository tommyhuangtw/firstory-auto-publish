'use client';

import { useState, useEffect, useCallback } from 'react';

interface Post {
  post_id: string;
  text: string;
  media_type: string;
  permalink: string | null;
  posted_at: string | null;
  views: number; likes: number; replies: number; reposts: number; quotes: number; shares: number;
  engagement_rate: number;
}

interface Asset {
  id: number;
  type: 'bio' | 'style' | 'story';
  content: string;
  topic_tags: string | null;
  source_post_id: string | null;
  pinned: number;
  status: string;
  updated_at: string;
}

interface Status {
  syncRunning: boolean;
  generateRunning: boolean;
  lastSync: { at: string; result: unknown } | null;
  lastGenerate: { at: string; result: unknown } | null;
}

const TAG_LABELS: Record<string, string> = {
  'ai-freelance': 'AI接案',
  'enterprise-adoption': '企業導入',
  'workplace': '職場',
  'uk-life': '英國生活',
  'us-school': '美國/求學',
  'other': '其他',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}
function fmtRate(r: number): string {
  return `${(r * 100).toFixed(1)}%`;
}

export default function VoicePage() {
  const [tab, setTab] = useState<'posts' | 'assets'>('posts');
  const [status, setStatus] = useState<Status | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState<'like_comment' | 'likes' | 'engagement' | 'recent'>('like_comment');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [tagFilter, setTagFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    const s = await fetch('/api/voice/sync').then(r => r.json()).catch(() => null);
    if (s) setStatus(s);
  }, []);
  const loadPosts = useCallback(async () => {
    const d = await fetch(`/api/voice/posts?sort=${sort}&limit=100`).then(r => r.json()).catch(() => ({ posts: [], total: 0 }));
    setPosts(d.posts); setTotal(d.total);
  }, [sort]);
  const loadAssets = useCallback(async () => {
    const d = await fetch('/api/voice/assets').then(r => r.json()).catch(() => ({ assets: [] }));
    setAssets(d.assets);
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([loadStatus(), loadPosts(), loadAssets()]);
    setLoading(false);
  }, [loadStatus, loadPosts, loadAssets]);
  // Legitimate mount-time data fetch; setLoading runs after the awaited fetches.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadAll(); }, [loadAll]);

  // Poll while a job is running, then refresh data on completion.
  useEffect(() => {
    if (!status?.syncRunning && !status?.generateRunning) return;
    const t = setInterval(async () => {
      const s = await fetch('/api/voice/sync').then(r => r.json()).catch(() => null);
      if (s) {
        const wasRunning = status.syncRunning || status.generateRunning;
        setStatus(s);
        if (wasRunning && !s.syncRunning && !s.generateRunning) {
          loadPosts(); loadAssets();
        }
      }
    }, 3000);
    return () => clearInterval(t);
  }, [status, loadPosts, loadAssets]);

  async function trigger(kind: 'sync' | 'generate') {
    const url = kind === 'sync' ? '/api/voice/sync' : '/api/voice/assets/generate';
    const res = await fetch(url, { method: 'POST' });
    if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || '操作失敗'); return; }
    loadStatus();
  }

  async function patchAsset(id: number, body: Partial<{ content: string; pinned: boolean; status: string }>) {
    await fetch(`/api/voice/assets/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    loadAssets();
  }
  async function deleteAsset(id: number) {
    if (!confirm('確定刪除這則資產?')) return;
    await fetch(`/api/voice/assets/${id}`, { method: 'DELETE' });
    loadAssets();
  }

  const bio = assets.find(a => a.type === 'bio');
  const style = assets.find(a => a.type === 'style');
  const stories = assets.filter(a => a.type === 'story');
  const visibleStories = tagFilter === 'all'
    ? stories
    : stories.filter(s => (JSON.parse(s.topic_tags || '[]') as string[]).includes(tagFilter));

  const running = status?.syncRunning || status?.generateRunning;

  if (loading) {
    return (
      <div className="p-6 md:p-8">
        <Header />
        <p className="text-zinc-400 text-sm">Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      <Header />

      {/* Status / action bar */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 mb-6 flex flex-wrap items-center gap-3">
        <div className="text-sm text-zinc-300 flex-1 min-w-[200px]">
          <span className="font-medium text-zinc-100">{total}</span> 篇貼文
          {status?.lastSync && <span className="text-zinc-500 text-xs"> · 上次同步 {fmtDate(status.lastSync.at)} {status.lastSync.at.slice(11, 16)}</span>}
        </div>
        <button
          onClick={() => trigger('sync')}
          disabled={running}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-50 transition-colors"
        >
          {status?.syncRunning ? '同步中…' : '立即同步'}
        </button>
        <button
          onClick={() => trigger('generate')}
          disabled={running}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-brand/90 hover:bg-brand text-white disabled:opacity-50 transition-colors"
        >
          {status?.generateRunning ? '生成資產中…' : '重新生成風格資產'}
        </button>
      </div>

      {total === 0 ? (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 text-center text-sm text-zinc-400">
          尚無貼文。請先到 <a href="/settings" className="text-brand underline">設定</a> 連結 Threads,再點「立即同步」。
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex gap-1 mb-5 border-b border-zinc-800">
            <TabBtn active={tab === 'posts'} onClick={() => setTab('posts')}>貼文牆</TabBtn>
            <TabBtn active={tab === 'assets'} onClick={() => setTab('assets')}>風格資產</TabBtn>
          </div>

          {tab === 'posts' && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs text-zinc-500">排序：</span>
                <SortBtn active={sort === 'like_comment'} onClick={() => setSort('like_comment')}>讚+留言（觀眾最買單）</SortBtn>
                <SortBtn active={sort === 'likes'} onClick={() => setSort('likes')}>純讚數</SortBtn>
                <SortBtn active={sort === 'engagement'} onClick={() => setSort('engagement')}>互動率</SortBtn>
                <SortBtn active={sort === 'recent'} onClick={() => setSort('recent')}>最新</SortBtn>
              </div>
              <div className="space-y-2">
                {posts.map((p, i) => (
                  <PostRow key={p.post_id} post={p} rank={sort === 'recent' ? undefined : i + 1} />
                ))}
              </div>
            </div>
          )}

          {tab === 'assets' && (
            <div className="space-y-6">
              <AssetCard title="個人背景檔" asset={bio} emptyHint="尚未生成,點「重新生成風格資產」" onSave={patchAsset} onPin={patchAsset} />
              <AssetCard title="寫作風格檔" asset={style} emptyHint="尚未生成,點「重新生成風格資產」" onSave={patchAsset} onPin={patchAsset} mono />

              {/* Story bank */}
              <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-medium text-zinc-200">故事庫 <span className="text-zinc-500">({stories.length})</span></h2>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  <TagBtn active={tagFilter === 'all'} onClick={() => setTagFilter('all')}>全部</TagBtn>
                  {Object.entries(TAG_LABELS).map(([k, label]) => (
                    <TagBtn key={k} active={tagFilter === k} onClick={() => setTagFilter(k)}>{label}</TagBtn>
                  ))}
                </div>
                <div className="space-y-2">
                  {visibleStories.map(s => (
                    <StoryRow key={s.id} story={s} onPin={patchAsset} onDelete={deleteAsset} />
                  ))}
                  {visibleStories.length === 0 && <p className="text-xs text-zinc-500">此分類沒有故事</p>}
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Header() {
  return (
    <h1 className="text-2xl font-semibold tracking-tight mb-6 flex items-center gap-2">
      <span className="w-1 h-6 rounded-full bg-brand" />
      我的風格
    </h1>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${active ? 'border-brand text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}>
      {children}
    </button>
  );
}
function SortBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${active ? 'bg-brand/20 text-brand' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>{children}</button>
  );
}
function TagBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`px-2.5 py-1 text-[11px] rounded-full transition-colors ${active ? 'bg-brand/20 text-brand' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>{children}</button>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <span className="text-zinc-500"><span className="text-zinc-300">{value.toLocaleString()}</span> {label}</span>;
}

function PostRow({ post, rank }: { post: Post; rank?: number }) {
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
      <div className="flex items-start gap-3">
        {rank && (
          <span className={`shrink-0 w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold ${rank <= 3 ? 'bg-brand/20 text-brand' : 'bg-zinc-800 text-zinc-500'}`}>{rank}</span>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-zinc-200 whitespace-pre-wrap line-clamp-4">{post.text || <span className="text-zinc-600 italic">（媒體貼文,無文字）</span>}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px]">
            <span className="px-1.5 py-0.5 rounded bg-brand/15 text-brand font-semibold">互動率 {fmtRate(post.engagement_rate)}</span>
            <Metric label="瀏覽" value={post.views} />
            <Metric label="讚" value={post.likes} />
            <Metric label="回覆" value={post.replies} />
            <Metric label="轉發" value={post.reposts} />
            <Metric label="分享" value={post.shares} />
            <span className="text-zinc-600">{fmtDate(post.posted_at)}</span>
            {post.permalink && <a href={post.permalink} target="_blank" rel="noreferrer" className="text-zinc-500 hover:text-brand underline">原文</a>}
          </div>
        </div>
      </div>
    </div>
  );
}

function AssetCard({ title, asset, emptyHint, onSave, onPin, mono }: {
  title: string;
  asset: Asset | undefined;
  emptyHint: string;
  onSave: (id: number, body: { content: string }) => void;
  onPin: (id: number, body: { pinned: boolean }) => void;
  mono?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  if (!asset) {
    return (
      <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
        <h2 className="text-sm font-medium text-zinc-200 mb-2">{title}</h2>
        <p className="text-xs text-zinc-500">{emptyHint}</p>
      </section>
    );
  }

  return (
    <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-zinc-200">{title}</h2>
          {asset.pinned ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand/20 text-brand">已釘選</span> : null}
          {asset.status === 'draft' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">草稿</span>}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button onClick={() => onPin(asset.id, { pinned: !asset.pinned })} className="text-zinc-500 hover:text-brand">{asset.pinned ? '取消釘選' : '釘選'}</button>
          {!editing && <button onClick={() => { setDraft(asset.content); setEditing(true); }} className="text-zinc-500 hover:text-zinc-200">編輯</button>}
        </div>
      </div>
      {editing ? (
        <div>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={mono ? 14 : 5}
            className={`w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-sm text-zinc-200 focus:border-brand outline-none ${mono ? 'font-mono text-xs' : ''}`} />
          <div className="flex gap-2 mt-2">
            <button onClick={() => { onSave(asset.id, { content: draft }); setEditing(false); }} className="px-3 py-1.5 text-xs rounded-lg bg-brand text-white">儲存（標記為保留）</button>
            <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs rounded-lg bg-zinc-800 text-zinc-400">取消</button>
          </div>
        </div>
      ) : (
        <p className={`text-sm text-zinc-300 whitespace-pre-wrap ${mono ? 'font-mono text-xs leading-relaxed' : ''}`}>{asset.content}</p>
      )}
    </section>
  );
}

function StoryRow({ story, onPin, onDelete }: {
  story: Asset;
  onPin: (id: number, body: { pinned: boolean }) => void;
  onDelete: (id: number) => void;
}) {
  const tags = JSON.parse(story.topic_tags || '[]') as string[];
  return (
    <div className="bg-zinc-950/50 rounded-lg border border-zinc-800 p-3 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-zinc-300">{story.content}</p>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {tags.map(t => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-400">{TAG_LABELS[t] || t}</span>)}
          {story.pinned ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand/20 text-brand">已釘選</span> : null}
        </div>
      </div>
      <div className="flex items-center gap-2 text-[11px] shrink-0">
        <button onClick={() => onPin(story.id, { pinned: !story.pinned })} className="text-zinc-500 hover:text-brand">{story.pinned ? '取消' : '釘選'}</button>
        <button onClick={() => onDelete(story.id)} className="text-zinc-500 hover:text-red-400">刪除</button>
      </div>
    </div>
  );
}
