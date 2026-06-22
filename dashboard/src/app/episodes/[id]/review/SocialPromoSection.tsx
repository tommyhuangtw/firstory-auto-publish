'use client';

import { useState, useCallback } from 'react';

interface PromoPost {
  targetAudience: string;
  body: string;
}

interface Choice {
  question: string;
  options: string[];
}

interface Props {
  episodeId: number;
  canEdit: boolean;
}

const THREADS_LIMIT = 450;

type Step =
  | 'idle'
  | 'loading-questions'
  | 'loading-choices'
  | 'answering'
  | 'choosing'
  | 'loading-post'
  | 'done';

// per-question selection: option index, 'other' (free text), or null (unanswered)
type Selection = number | 'other' | null;

export default function SocialPromoSection({ episodeId, canEdit }: Props) {
  const [step, setStep] = useState<Step>('idle');
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [otherTexts, setOtherTexts] = useState<string[]>([]);
  const [post, setPost] = useState<PromoPost | null>(null);
  const [editedBody, setEditedBody] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  // ── Core: generate post from a list of answer strings ──
  const generateWithAnswers = useCallback(async (answerList: string[], fallbackStep: Step) => {
    setStep('loading-post');
    setMessage('');
    try {
      const res = await fetch(`/api/episodes/${episodeId}/generate-promo-posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'generate', answers: answerList }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPost(data.post);
      setEditedBody(data.post.body);
      setStep('done');
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
      setStep(fallbackStep);
    }
  }, [episodeId]);

  // ── Path 1: direct generation, no questions ──
  const handleGenerateDirect = useCallback(() => {
    generateWithAnswers([], 'idle');
  }, [generateWithAnswers]);

  // ── Path 2: multiple-choice ──
  const handleStartChoices = useCallback(async () => {
    setStep('loading-choices');
    setMessage('');
    setChoices([]);
    setSelections([]);
    setOtherTexts([]);
    setPost(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/generate-promo-posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'choices' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setChoices(data.choices);
      setSelections(data.choices.map(() => null));
      setOtherTexts(data.choices.map(() => ''));
      setStep('choosing');
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
      setStep('idle');
    }
  }, [episodeId]);

  const handleSelect = useCallback((qIdx: number, sel: Selection) => {
    setSelections(prev => {
      const next = [...prev];
      next[qIdx] = sel;
      return next;
    });
  }, []);

  const handleOtherTextChange = useCallback((qIdx: number, value: string) => {
    setOtherTexts(prev => {
      const next = [...prev];
      next[qIdx] = value;
      return next;
    });
  }, []);

  const handleGenerateFromChoices = useCallback(() => {
    const answerList = choices
      .map((c, i) => {
        const sel = selections[i];
        if (sel === 'other') {
          const t = otherTexts[i]?.trim();
          return t ? `${c.question}：${t}` : '';
        }
        if (typeof sel === 'number') {
          return `${c.question}：${c.options[sel]}`;
        }
        return '';
      })
      .filter(Boolean);
    generateWithAnswers(answerList, 'choosing');
  }, [choices, selections, otherTexts, generateWithAnswers]);

  // ── Path 3: free-text Q&A (original flow) ──
  const handleStartQuestions = useCallback(async () => {
    setStep('loading-questions');
    setMessage('');
    setQuestions([]);
    setAnswers([]);
    setPost(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/generate-promo-posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'questions' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setQuestions(data.questions);
      setAnswers(data.questions.map(() => ''));
      setStep('answering');
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
      setStep('idle');
    }
  }, [episodeId]);

  const handleAnswerChange = useCallback((idx: number, value: string) => {
    setAnswers(prev => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  }, []);

  const handleGenerateFromAnswers = useCallback(() => {
    generateWithAnswers(answers.filter(a => a.trim().length > 0), 'answering');
  }, [answers, generateWithAnswers]);

  const handleCopy = useCallback(async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      setMessage('Error: 複製失敗');
    }
  }, []);

  const handleReset = useCallback(() => {
    setStep('idle');
    setQuestions([]);
    setAnswers([]);
    setChoices([]);
    setSelections([]);
    setOtherTexts([]);
    setPost(null);
    setEditedBody('');
    setMessage('');
  }, []);

  const isLoading = step === 'loading-questions' || step === 'loading-choices' || step === 'loading-post';
  const hasAnyAnswer = answers.some(a => a.trim().length > 0);
  const hasAnySelection = selections.some((s, i) => s !== null && (s !== 'other' || otherTexts[i]?.trim().length > 0));
  const isOverLimit = editedBody.length > THREADS_LIMIT;

  const loadingText =
    step === 'loading-choices' ? 'AI 正在讀這集內容，準備幾個選擇題...'
    : step === 'loading-questions' ? 'AI 正在讀這集內容，準備問你問題...'
    : 'AI 正在撰寫貼文...';

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-zinc-800/50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2.5">
          <svg className="w-4 h-4 text-orange-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
          </svg>
          <h3 className="text-sm font-medium text-zinc-300">社群行銷貼文</h3>
          {post && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-orange-500/15 text-orange-400">
              已生成
            </span>
          )}
        </div>
        <svg className={`w-4 h-4 text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-zinc-800">

          {/* ── Idle state ── */}
          {step === 'idle' && (
            <p className="text-sm text-zinc-500 pt-2">一鍵直接生成 Threads 貼文，或用選擇題 / 自己打字加入你的觀點</p>
          )}

          {/* ── Loading state ── */}
          {isLoading && (
            <div className="pt-2">
              <div className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-4 min-h-[120px] flex flex-col items-center justify-center gap-3">
                <div className="flex gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-orange-400 animate-bounce [animation-delay:0ms]" />
                  <div className="w-2 h-2 rounded-full bg-orange-400 animate-bounce [animation-delay:150ms]" />
                  <div className="w-2 h-2 rounded-full bg-orange-400 animate-bounce [animation-delay:300ms]" />
                </div>
                <p className="text-sm text-zinc-400">{loadingText}</p>
              </div>
            </div>
          )}

          {/* ── Multiple-choice ── */}
          {step === 'choosing' && (
            <div className="pt-2 space-y-4">
              <p className="text-xs text-zinc-400">選出最接近你的答案，AI 會把你的觀點融入貼文。沒選的題目會自動略過。</p>
              {choices.map((c, qIdx) => (
                <div key={qIdx} className="space-y-2">
                  <label className="text-xs text-zinc-300 font-medium">Q{qIdx + 1}. {c.question}</label>
                  <div className="flex flex-col gap-1.5">
                    {c.options.map((opt, oIdx) => {
                      const active = selections[qIdx] === oIdx;
                      return (
                        <button
                          key={oIdx}
                          onClick={() => handleSelect(qIdx, active ? null : oIdx)}
                          className={`text-left px-3 py-2 rounded-lg text-xs border transition-colors cursor-pointer ${
                            active
                              ? 'bg-orange-500/15 border-orange-500/50 text-orange-200'
                              : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-600'
                          }`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                    {/* 其他 */}
                    <button
                      onClick={() => handleSelect(qIdx, selections[qIdx] === 'other' ? null : 'other')}
                      className={`text-left px-3 py-2 rounded-lg text-xs border transition-colors cursor-pointer ${
                        selections[qIdx] === 'other'
                          ? 'bg-orange-500/15 border-orange-500/50 text-orange-200'
                          : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'
                      }`}
                    >
                      其他（自己寫）
                    </button>
                    {selections[qIdx] === 'other' && (
                      <textarea
                        value={otherTexts[qIdx] || ''}
                        onChange={(e) => handleOtherTextChange(qIdx, e.target.value)}
                        rows={2}
                        placeholder="你的回答..."
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-xs text-zinc-300 resize-y focus:outline-none focus:border-orange-500/50 placeholder:text-zinc-600"
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Free-text Q&A ── */}
          {step === 'answering' && (
            <div className="pt-2 space-y-4">
              <p className="text-xs text-zinc-400">回答以下問題，AI 會把你的觀點融入貼文中。可以跳過不想回答的題目。</p>
              {questions.map((q, idx) => (
                <div key={idx} className="space-y-1.5">
                  <label className="text-xs text-zinc-300 font-medium">Q{idx + 1}. {q}</label>
                  <textarea
                    value={answers[idx] || ''}
                    onChange={(e) => handleAnswerChange(idx, e.target.value)}
                    rows={2}
                    placeholder="你的回答..."
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-xs text-zinc-300 resize-y focus:outline-none focus:border-orange-500/50 placeholder:text-zinc-600"
                  />
                </div>
              ))}
            </div>
          )}

          {/* ── Show generated post ── */}
          {step === 'done' && post && (
            <div className="pt-2 space-y-4">
              <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-zinc-700/50 text-zinc-400 border border-zinc-600/30">
                    {post.targetAudience}
                  </span>
                </div>

                <textarea
                  value={editedBody}
                  onChange={(e) => setEditedBody(e.target.value)}
                  rows={12}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-xs text-zinc-300 resize-y focus:outline-none focus:border-orange-500/50"
                />

                <div className="flex items-center justify-between">
                  <p className={`text-[11px] tabular-nums ${isOverLimit ? 'text-red-400 font-medium' : 'text-zinc-500'}`}>
                    {editedBody.length}/{THREADS_LIMIT}
                  </p>
                  <CopyButton
                    text={editedBody}
                    field="body"
                    copiedField={copiedField}
                    onCopy={handleCopy}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Action buttons ── */}
          {canEdit && (
            <div className="flex flex-wrap gap-2 items-center">
              {step === 'idle' && (
                <>
                  <button
                    onClick={handleGenerateDirect}
                    className="px-4 py-2.5 rounded-lg bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white text-sm font-medium transition-all cursor-pointer"
                  >
                    直接生成貼文
                  </button>
                  <button
                    onClick={handleStartChoices}
                    className="px-4 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:border-zinc-600 text-sm font-medium transition-colors cursor-pointer"
                  >
                    用選擇題加入觀點
                  </button>
                  <button
                    onClick={handleStartQuestions}
                    className="px-3 py-2.5 text-zinc-500 hover:text-zinc-300 text-sm transition-colors cursor-pointer"
                  >
                    自己打字回答
                  </button>
                </>
              )}
              {step === 'choosing' && (
                <>
                  <button
                    onClick={handleGenerateFromChoices}
                    disabled={!hasAnySelection}
                    className="px-4 py-2.5 rounded-lg bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 disabled:opacity-50 text-white text-sm font-medium transition-all cursor-pointer"
                  >
                    生成貼文
                  </button>
                  <button
                    onClick={handleReset}
                    className="px-4 py-2.5 rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-sm transition-colors cursor-pointer"
                  >
                    取消
                  </button>
                </>
              )}
              {step === 'answering' && (
                <>
                  <button
                    onClick={handleGenerateFromAnswers}
                    disabled={!hasAnyAnswer}
                    className="px-4 py-2.5 rounded-lg bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 disabled:opacity-50 text-white text-sm font-medium transition-all cursor-pointer"
                  >
                    生成貼文
                  </button>
                  <button
                    onClick={handleReset}
                    className="px-4 py-2.5 rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-sm transition-colors cursor-pointer"
                  >
                    取消
                  </button>
                </>
              )}
              {step === 'done' && (
                <button
                  onClick={handleReset}
                  className="px-4 py-2.5 rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-sm transition-colors cursor-pointer"
                >
                  重新開始
                </button>
              )}
            </div>
          )}

          {/* Message */}
          {message && (
            <p className={`text-[11px] ${message.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
              {message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CopyButton({ text, field, copiedField, onCopy }: {
  text: string;
  field: string;
  copiedField: string | null;
  onCopy: (text: string, field: string) => void;
}) {
  const isCopied = copiedField === field;
  return (
    <button
      onClick={() => onCopy(text, field)}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-[11px] font-medium transition-colors cursor-pointer"
    >
      {isCopied ? (
        <>
          <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          已複製
        </>
      ) : (
        <>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
          </svg>
          複製
        </>
      )}
    </button>
  );
}
