'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface SourceInsight { id: number; hook: string; idea: string; category: string | null; resonance: number | null }
interface SourceData {
  id: number; url: string | null; title: string | null; source_type: string; status: string;
  transcript: string | null; channel_title: string | null; error?: string;
  insights: SourceInsight[];
}

export default function SourcePage() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<SourceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/inspiration/sources/${id}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-8 max-w-3xl mx-auto text-zinc-400">載入中…</div>;
  if (!data || data.error) return <div className="p-8 max-w-3xl mx-auto text-zinc-400">找不到這個來源。</div>;

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pb-24">
      <a href="/inspiration" className="text-sm text-zinc-400 hover:text-zinc-200">← 靈感庫</a>
      <h1 className="text-xl font-bold text-zinc-100 mt-2 mb-1">{data.title || '(無標題)'}</h1>
      <div className="text-xs text-zinc-500 mb-6">
        {data.channel_title && <span className="text-brand">{data.channel_title}</span>}
        {data.url && <> · <a href={data.url} target="_blank" className="text-brand hover:underline">來源連結 ↗</a></>}
        {' · '}{data.source_type}
        {data.status !== 'completed' && <> · <span className="text-amber-400">{data.status}</span></>}
      </div>

      {data.insights?.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 mb-6">
          <p className="text-sm font-semibold text-zinc-300 mb-2">從這支內容抽出的 {data.insights.length} 個 insight</p>
          {data.insights.map((i) => (
            <p key={i.id} className="text-sm text-zinc-300 mb-1">• {i.hook}</p>
          ))}
        </div>
      )}

      <h2 className="text-sm font-semibold text-zinc-400 mb-2">原始講稿</h2>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
        {data.transcript || '（沒有逐字稿）'}
      </div>
    </div>
  );
}
