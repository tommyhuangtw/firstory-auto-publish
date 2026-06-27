'use client';

import { useState, useCallback } from 'react';
import PageHeader from '@/components/PageHeader';

interface DraftScore {
  viralProb: number;
  relativeScore: number;
  authorMedianLikes: number | null;
  authorP90Likes: number | null;
}
interface WriteResult {
  draft: string;
  stories: { content: string; sim: number }[];
  score?: DraftScore | null;
}
interface BestOfNResult {
  best: WriteResult;
  candidates: WriteResult[];
  scored: boolean;
}
type RefineOp = 'short' | 'medium' | 'long' | 'smooth';

export default function WritePage() {
  const [mode, setMode] = useState<'rewrite' | 'autonomous'>('rewrite');
  const [idea, setIdea] = useState('');
  const [useStories, setUseStories] = useState(false);
  const [viral, setViral] = useState(false);
  const [scoreMode, setScoreMode] = useState(true); // 生 N 版挑最爆
  const [loading, setLoading] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [diceCategory, setDiceCategory] = useState('');
  const [insightSrc, setInsightSrc] = useState('');
  const [result, setResult] = useState<WriteResult | null>(null);
  const [candidates, setCandidates] = useState<WriteResult[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [predictorOff, setPredictorOff] = useState(false);
  const [draft, setDraft] = useState('');
  const [refining, setRefining] = useState<RefineOp | null>(null);
  const [copied, setCopied] = useState(false);
  const [showRefs, setShowRefs] = useState(false);
  const [showCandidates, setShowCandidates] = useState(false);
  const [error, setError] = useState('');

  const switchMode = useCallback((m: 'rewrite' | 'autonomous') => {
    setMode(m);
    setUseStories(m === 'autonomous'); // story default per mode
  }, []);

  function showCandidate(idx: number, list: WriteResult[]) {
    setSelectedIdx(idx);
    setResult(list[idx]);
    setDraft(list[idx].draft);
  }

  async function generate() {
    setError('');
    setLoading(true);
    setResult(null);
    setCandidates([]);
    setPredictorOff(false);
    try {
      const res = await fetch('/api/voice/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, idea, useStories, viral, bestOf: scoreMode ? 5 : 0 }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || '生成失敗'); return; }
      // best-of-N response has `candidates`; single-draft response is a WriteResult.
      if (Array.isArray(data.candidates)) {
        const list = data.candidates as WriteResult[];
        setCandidates(list);
        setPredictorOff(!data.scored);
        showCandidate(0, list);
      } else {
        setCandidates([]);
        setResult(data);
        setDraft(data.draft);
        setSelectedIdx(0);
      }
    } catch {
      setError('生成失敗,請重試');
    } finally {
      setLoading(false);
    }
  }

  // Post-hoc rewrite of the current draft: change length (短/中/長) or smooth wording.
  async function refine(op: RefineOp) {
    if (!draft.trim() || refining) return;
    setRefining(op);
    setError('');
    try {
      const res = await fetch('/api/voice/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft, op }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || '改寫失敗'); return; }
      setDraft(data.draft);
      setResult(r => (r ? { ...r, draft: data.draft } : r));
    } catch {
      setError('改寫失敗,請重試');
    } finally {
      setRefining(null);
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
      const catParam = diceCategory ? `&category=${encodeURIComponent(diceCategory)}` : '';
      const d = await fetch(`/api/inspiration/insights?sort=random&limit=1${catParam}`).then(r => r.json());
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

  const draftLen = [...draft].length; // count by code point (emoji = 1), like Threads
  const over = draftLen > 500;

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <PageHeader title="寫文章" />

      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 mb-6 space-y-4">
        {/* Mode */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 w-16">模式</span>
          <div className="flex-1 grid grid-cols-2 gap-2 md:flex md:flex-none">
            <Seg active={mode === 'rewrite'} onClick={() => switchMode('rewrite')}>改寫我的想法</Seg>
            <Seg active={mode === 'autonomous'} onClick={() => switchMode('autonomous')}>讓 AI 自己寫</Seg>
          </div>
        </div>

        {/* Idea */}
        <div>
          <div className="flex flex-col gap-2 items-start md:flex-row md:items-center md:justify-between">
            <label className="text-xs text-zinc-500">
              {mode === 'rewrite' ? '你的想法 / mindset（會用你的口吻延伸）' : '主題／角度（可留空，讓 AI 自由發揮）'}
            </label>
            <div className="flex items-center gap-1.5">
              <select
                value={diceCategory}
                onChange={e => setDiceCategory(e.target.value)}
                className="text-xs px-1.5 py-1 rounded-lg bg-zinc-800 text-zinc-300 border border-zinc-700 outline-none focus:border-brand cursor-pointer"
                title="限定骰靈感的分類"
              >
                <option value="">全部分類</option>
                <option value="mindset">心法（觀點・原則）</option>
                <option value="contrarian">反直覺（顛覆常識的看法）</option>
                <option value="tactic">戰術（具體做法・步驟）</option>
                <option value="story">故事（案例・經歷）</option>
              </select>
              <button
                onClick={rollDice}
                disabled={rolling}
                className="text-xs px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-50"
                title="從靈感庫隨機骰一個今天有 feel 的點"
              >
                {rolling ? '🎲 …' : '🎲 骰一個靈感'}
              </button>
            </div>
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

        {/* Toggles */}
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-xs text-zinc-400 cursor-pointer select-none">
            <input type="checkbox" checked={useStories} onChange={e => setUseStories(e.target.checked)} className="accent-[var(--brand,#e0a96d)] mt-0.5 shrink-0" />
            帶入個人故事（只在主題相關時才會用，不會硬塞）
          </label>
          <label className="flex items-start gap-2 text-xs cursor-pointer select-none">
            <input type="checkbox" checked={viral} onChange={e => setViral(e.target.checked)} className="accent-[var(--brand,#e0a96d)] mt-0.5 shrink-0" />
            <span className={viral ? 'text-brand' : 'text-zinc-400'}>🔥 爆文模式（套用高流量寫法：狠 hook、一句一行、具體數字、互惠 CTA）</span>
          </label>
          <label className="flex items-start gap-2 text-xs cursor-pointer select-none">
            <input type="checkbox" checked={scoreMode} onChange={e => setScoreMode(e.target.checked)} className="accent-[var(--brand,#e0a96d)] mt-0.5 shrink-0" />
            <span className={scoreMode ? 'text-brand' : 'text-zinc-400'}>🎯 爆文評分（生 5 版、用 AI 模型挑「最可能爆」的那版）</span>
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={generate}
            disabled={loading}
            className="w-full md:w-auto text-center px-4 py-2 text-sm font-medium rounded-lg bg-brand text-white disabled:opacity-50 transition-colors"
          >
            {loading ? (scoreMode ? '生成 5 版並評分中…（約 20-30 秒）' : '生成中…（約 15-20 秒）') : '生成草稿'}
          </button>
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
      </div>

      {/* Draft */}
      {result && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-zinc-200">草稿</h2>
              {result.score && <ViralBadge score={result.score} />}
              {predictorOff && candidates.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500" title="評分服務未啟動,已回傳第一版未評分草稿">評分服務離線</span>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap text-xs">
              <span className={over ? 'text-red-400' : 'text-zinc-500'}>{draftLen}/500 字</span>
              <button onClick={copyDraft} className="px-3 py-2 md:px-2.5 md:py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200">
                {copied ? '已複製 ✓' : '複製'}
              </button>
              <a
                href={`https://www.threads.net/intent/post?text=${encodeURIComponent(draft)}`}
                target="_blank" rel="noreferrer"
                className="px-2.5 py-1 rounded-lg bg-brand/90 hover:bg-brand text-white"
              >
                去 Threads 發文 →
              </a>
            </div>
          </div>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={12}
            className={`w-full bg-zinc-950 border rounded-lg p-3 text-sm text-zinc-200 whitespace-pre-wrap focus:border-brand outline-none ${over ? 'border-red-500/50' : 'border-zinc-700'}`}
          />

          {/* Refine toolbar — rewrite the current draft in place */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-zinc-500">調整長度</span>
            <RefineBtn onClick={() => refine('short')} busy={refining === 'short'} disabled={!!refining}>短</RefineBtn>
            <RefineBtn onClick={() => refine('medium')} busy={refining === 'medium'} disabled={!!refining}>中</RefineBtn>
            <RefineBtn onClick={() => refine('long')} busy={refining === 'long'} disabled={!!refining}>長</RefineBtn>
            <span className="w-px h-4 bg-zinc-700 mx-1" />
            <RefineBtn onClick={() => refine('smooth')} busy={refining === 'smooth'} disabled={!!refining} accent>✨ 更通順自然</RefineBtn>
            {refining && <span className="text-[11px] text-zinc-500">改寫中…</span>}
          </div>

          {/* Candidate ranking (best-of-N) */}
          {candidates.length > 1 && (
            <div className="mt-3">
              <button onClick={() => setShowCandidates(v => !v)} className="text-xs text-zinc-500 hover:text-zinc-300">
                {showCandidates ? '▾' : '▸'} 全部 {candidates.length} 版（依爆文機率排序，點擊切換）
              </button>
              {showCandidates && (
                <div className="mt-2 space-y-1.5">
                  {candidates.map((c, i) => (
                    <button
                      key={i}
                      onClick={() => showCandidate(i, candidates)}
                      className={`w-full text-left rounded-lg border p-2.5 transition-colors ${i === selectedIdx ? 'border-brand/60 bg-brand/5' : 'border-zinc-800 bg-zinc-950/50 hover:border-zinc-700'}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`shrink-0 w-5 h-5 rounded-full grid place-items-center text-[10px] font-bold ${i === 0 ? 'bg-brand/20 text-brand' : 'bg-zinc-800 text-zinc-500'}`}>{i + 1}</span>
                        {c.score && <ViralBadge score={c.score} small />}
                        {i === 0 && <span className="text-[10px] text-brand">★ 推薦</span>}
                      </div>
                      <p className="text-[11px] text-zinc-400 line-clamp-2 whitespace-pre-wrap">{c.draft}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

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

function RefineBtn({ onClick, busy, disabled, accent, children }: {
  onClick: () => void; busy?: boolean; disabled?: boolean; accent?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-2 md:px-2.5 md:py-1 text-xs rounded-lg transition-colors disabled:opacity-50 ${accent ? 'bg-brand/15 text-brand hover:bg-brand/25' : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'}`}
    >
      {busy ? '…' : children}
    </button>
  );
}

/** Viral-probability badge. Colour ramps with the predicted chance of beating the author's P90. */
function ViralBadge({ score, small }: { score: DraftScore; small?: boolean }) {
  const pct = Math.round(score.viralProb * 100);
  const tone = pct >= 25 ? 'bg-red-500/20 text-red-300' : pct >= 12 ? 'bg-amber-500/20 text-amber-300' : 'bg-zinc-700/40 text-zinc-400';
  const title = score.authorP90Likes != null
    ? `預估超越你 P90（≈${Math.round(score.authorP90Likes)} 讚）的機率。相對分 ${score.relativeScore >= 0 ? '+' : ''}${score.relativeScore.toFixed(2)}`
    : '預估爆文機率';
  return (
    <span title={title} className={`${small ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'} rounded font-semibold ${tone}`}>
      🔥 爆文機率 {pct}%
    </span>
  );
}
