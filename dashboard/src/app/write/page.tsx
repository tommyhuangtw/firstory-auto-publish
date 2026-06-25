'use client';

import { useState, useCallback } from 'react';

interface WriteResult {
  draft: string;
  stories: { content: string; sim: number }[];
}

export default function WritePage() {
  const [mode, setMode] = useState<'rewrite' | 'autonomous'>('rewrite');
  const [idea, setIdea] = useState('');
  const [useStories, setUseStories] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [insightSrc, setInsightSrc] = useState('');
  const [result, setResult] = useState<WriteResult | null>(null);
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [showRefs, setShowRefs] = useState(false);
  const [error, setError] = useState('');

  const switchMode = useCallback((m: 'rewrite' | 'autonomous') => {
    setMode(m);
    setUseStories(m === 'autonomous'); // story default per mode
  }, []);

  async function generate() {
    setError('');
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/voice/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, idea, useStories }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || '生成失敗'); return; }
      setResult(data);
      setDraft(data.draft);
    } catch {
      setError('生成失敗,請重試');
    } finally {
      setLoading(false);
    }
  }

  async function copyDraft() {
    await navigator.clipboard.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // 🎲 Roll a random insight from the inspiration library as today's mindset.
  async function rollDice() {
    setRolling(true);
    setError('');
    try {
      const d = await fetch('/api/inspiration/insights?sort=random&limit=1').then(r => r.json());
      const ins = (d.insights || [])[0];
      if (!ins) { setError('靈感庫沒有可用的靈感'); return; }
      setIdea(`${ins.hook}${ins.idea ? `\n${ins.idea}` : ''}`);
      setInsightSrc(ins.hook);
    } catch {
      setError('骰靈感失敗,請重試');
    } finally {
      setRolling(false);
    }
  }

  const over = draft.length > 500;

  return (
    <div className="p-6 md:p-8 max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight mb-6 flex items-center gap-2">
        <span className="w-1 h-6 rounded-full bg-brand" />
        寫文章
      </h1>

      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 mb-6 space-y-4">
        {/* Mode */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 w-16">模式</span>
          <Seg active={mode === 'rewrite'} onClick={() => switchMode('rewrite')}>改寫我的想法</Seg>
          <Seg active={mode === 'autonomous'} onClick={() => switchMode('autonomous')}>讓 AI 自己寫</Seg>
        </div>

        {/* Idea */}
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs text-zinc-500">
              {mode === 'rewrite' ? '你的想法 / mindset（會用你的口吻延伸）' : '主題／角度（可留空，讓 AI 自由發揮）'}
            </label>
            <button
              onClick={rollDice}
              disabled={rolling}
              className="text-xs px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-50"
              title="從靈感庫隨機骰一個今天有 feel 的點"
            >
              {rolling ? '🎲 …' : '🎲 骰一個靈感'}
            </button>
          </div>
          {insightSrc && (
            <div className="mt-1 text-[11px] text-brand/80">💡 來自靈感庫：{insightSrc.slice(0, 50)}</div>
          )}
          <textarea
            value={idea}
            onChange={e => { setIdea(e.target.value); if (insightSrc) setInsightSrc(''); }}
            rows={4}
            placeholder={mode === 'rewrite' ? '把你想講的東西寫下來，或按右上角骰一個靈感…' : '例如：AI 接案怎麼開始接第一個客戶（留空也行）'}
            className="mt-1 w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-sm text-zinc-200 focus:border-brand outline-none"
          />
        </div>

        {/* Story toggle */}
        <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
          <input type="checkbox" checked={useStories} onChange={e => setUseStories(e.target.checked)} className="accent-[var(--brand,#e0a96d)]" />
          帶入個人故事（只在主題相關時才會用，不會硬塞）
        </label>

        <div className="flex items-center gap-3">
          <button
            onClick={generate}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-brand text-white disabled:opacity-50 transition-colors"
          >
            {loading ? '生成中…（約 15-20 秒）' : '生成草稿'}
          </button>
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
      </div>

      {/* Draft */}
      {result && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-medium text-zinc-200">草稿</h2>
            <div className="flex items-center gap-3 text-xs">
              <span className={over ? 'text-red-400' : 'text-zinc-500'}>{draft.length}/500 字</span>
              <button onClick={copyDraft} className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200">
                {copied ? '已複製 ✓' : '複製'}
              </button>
            </div>
          </div>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={12}
            className={`w-full bg-zinc-950 border rounded-lg p-3 text-sm text-zinc-200 whitespace-pre-wrap focus:border-brand outline-none ${over ? 'border-red-500/50' : 'border-zinc-700'}`}
          />

          {/* Transparency */}
          <button onClick={() => setShowRefs(v => !v)} className="mt-3 text-xs text-zinc-500 hover:text-zinc-300">
            {showRefs ? '▾' : '▸'} 背景故事（{result.stories.length}）— 僅供 AI 理解你的視角,不會被複述
          </button>
          {showRefs && (
            <div className="mt-2 space-y-2 text-[11px]">
              {result.stories.map((s, i) => (
                <div key={i} className="text-zinc-500"><span className="text-amber-400">故事</span> sim {s.sim.toFixed(2)}：{s.content.slice(0, 70)}</div>
              ))}
              {result.stories.length === 0 && <div className="text-zinc-600">（這次沒有帶入故事）</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${active ? 'bg-brand/20 text-brand' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>{children}</button>
  );
}
