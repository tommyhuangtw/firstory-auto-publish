'use client';

import { useState, useEffect, useRef, useMemo } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type CommentType = 'action' | 'research' | 'discussion' | 'pr' | 'branch' | 'doc' | 'analysis' | 'note' | 'test' | 'review';

export interface CommentMeta {
  url?: string;
  title?: string;
  branch?: string;
  branch_name?: string;
  repo?: string;
  status?: 'open' | 'merged' | 'closed';
  summary?: string;
  knowledgeLink?: string;
  filename?: string;
}

export interface TaskComment {
  id: number;
  task_id: number;
  author: 'hermes' | 'tommy' | 'claude-code' | '小企' | '懶懶' | '小工';
  type: CommentType;
  content: string;
  metadata: string | null; // JSON string
  created_at: string;
}

export interface Task {
  id: number;
  title: string;
  description?: string;
  status: string;
  priority: string;
  category: string;
  scheduled_at?: string;
  auto_execute: number;
  episode_id?: number;
  result_notes?: string;
  completed_by?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

// ─── Linkify ──────────────────────────────────────────────────────────────────

const LINK_REGEX = /(\[([^\]]+)\]\(([^)]+)\))|(https?:\/\/[^\s<]+)/g;

function Linkify({ children, className }: { children: string; className?: string }) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const regex = new RegExp(LINK_REGEX.source, 'g');

  while ((match = regex.exec(children)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={`t${lastIndex}`}>{children.slice(lastIndex, match.index)}</span>);
    }
    if (match[1]) {
      const text = match[2];
      const href = match[3];
      const isExternal = href.startsWith('http');
      parts.push(
        <a key={`l${match.index}`} href={href}
          {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          className="text-blue-400 hover:text-blue-300 underline underline-offset-2">
          {text}
        </a>
      );
    } else {
      const url = match[4];
      parts.push(
        <a key={`l${match.index}`} href={url} target="_blank" rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 underline underline-offset-2 break-all">
          {url.replace(/^https?:\/\/localhost:\d+\/api\/research\//, '📄 ')}
        </a>
      );
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < children.length) {
    parts.push(<span key={`t${lastIndex}`}>{children.slice(lastIndex)}</span>);
  }

  return <span className={className}>{parts}</span>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const TYPE_META: Record<string, { icon: string; label: string; color: string }> = {
  action:     { icon: '🔧', label: 'Action',     color: 'text-zinc-400' },
  research:   { icon: '📄', label: 'Research',   color: 'text-teal-400' },
  discussion: { icon: '💬', label: 'Discussion', color: 'text-amber-400' },
  pr:         { icon: '🔀', label: 'PR',         color: 'text-indigo-400' },
  branch:     { icon: '🌿', label: 'Branch',     color: 'text-green-400' },
  doc:        { icon: '📎', label: 'Doc',        color: 'text-blue-400' },
  analysis:   { icon: '📊', label: 'Analysis',   color: 'text-purple-400' },
  note:       { icon: '📌', label: 'Note',       color: 'text-zinc-400' },
  test:       { icon: '🧪', label: 'Test',       color: 'text-emerald-400' },
  review:     { icon: '✅', label: 'Review',     color: 'text-amber-400' },
};

const PR_STATUS_BADGE: Record<string, string> = {
  open:   'bg-green-500/15 text-green-400 border border-green-500/30',
  merged: 'bg-purple-500/15 text-purple-400 border border-purple-500/30',
  closed: 'bg-zinc-700/40 text-zinc-500 border border-zinc-600/30',
};

function parseMeta(raw: string | null): CommentMeta {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr + (dateStr.includes('T') || dateStr.includes('Z') ? '' : 'Z'));
  return d.toLocaleDateString('zh-TW', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

/** Clean up result_notes: strip branch/commit/diff noise, keep meaningful summary */
function cleanResultNotes(raw: string): string {
  return raw
    .replace(/^Branch:.*\n?/gm, '')
    .replace(/^\d+ commit\(s\).*\n?/gm, '')
    .replace(/^.*\|.*\+{3,}.*\n?/gm, '')     // diff stat lines (... | 364 +++)
    .replace(/^.*\\[0-9]{3}.*\n?/gm, '')     // escaped unicode byte filenames (\347\276...)
    .replace(/^\s*\d+ files? changed.*\n?/gm, '')
    .replace(/^(Everything checks out|Acknowledged|Let me verify).*$/gm, '') // agent self-talk
    .replace(/^Success Criteria.*$/gm, '')
    .replace(/\*\*/g, '')
    .replace(/---+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Review Summary Panel ───────────────────────────────────────────────────

interface ReviewSummaryData {
  branch?: string;
  testPassed?: boolean;
  testContent?: string;
  pmVerdict?: string;
  pmReasoning?: string;
  pmConfidence?: string;
  workSummary?: string;
  docLink?: string;
  docFilename?: string;
  prUrl?: string;
  prStatus?: string;
}

function extractReviewData(task: Task, comments: TaskComment[]): ReviewSummaryData {
  const data: ReviewSummaryData = {};
  const reversed = [...comments].reverse();

  // Branch
  const branchComment = reversed.find(c => c.type === 'branch');
  if (branchComment) {
    const meta = parseMeta(branchComment.metadata);
    data.branch = meta.branch_name || meta.branch || branchComment.content.replace(/^Branch:\s*/i, '').trim();
  }

  // Test
  const testComment = reversed.find(c => c.type === 'test');
  if (testComment) {
    data.testPassed = testComment.content.includes('passed') || testComment.content.includes('✅') || testComment.content.includes('成功') || testComment.content.includes('Build successful');
    data.testContent = testComment.content.replace(/<[^>]+>/g, '').replace(/\*\*/g, '').slice(0, 300);
  }

  // PM review
  const reviewComment = reversed.find(c => (c.author === '懶懶' || c.author === 'hermes' || c.author === 'claude-code') && c.type === 'review');
  if (reviewComment) {
    const verdictMatch = reviewComment.content.match(/(approved|needs_changes|needs_tommy)/i);
    data.pmVerdict = verdictMatch ? verdictMatch[1].toLowerCase() : undefined;
    const confMatch = reviewComment.content.match(/confidence:\s*(high|medium|low)/i);
    data.pmConfidence = confMatch ? confMatch[1] : undefined;
    // Extract reasoning: everything after the verdict line
    data.pmReasoning = reviewComment.content
      .replace(/<[^>]+>/g, '')
      .replace(/\*\*/g, '')
      .replace(/^.*?(approved|needs_changes|needs_tommy).*?\n/i, '')
      .replace(/^.*?confidence:.*?\n/im, '')
      .replace(/^Feedback:\s*/im, '')
      .trim()
      .slice(0, 400);
  }

  // Work summary from result_notes
  if (task.result_notes) {
    data.workSummary = cleanResultNotes(task.result_notes);
  }

  // Doc link
  const docComment = reversed.find(c => c.type === 'doc');
  if (docComment) {
    const meta = parseMeta(docComment.metadata);
    data.docLink = meta.knowledgeLink;
    data.docFilename = meta.filename;
  }

  // PR
  const prComment = reversed.find(c => c.type === 'pr');
  if (prComment) {
    const meta = parseMeta(prComment.metadata);
    data.prUrl = meta.url;
    data.prStatus = meta.status;
  }

  return data;
}

function ReviewSummaryPanel({ task, data }: { task: Task; data: ReviewSummaryData }) {
  const verdictLabel: Record<string, { text: string; style: string }> = {
    approved: { text: '通過', style: 'bg-green-500/15 text-green-400 border-green-500/30' },
    needs_changes: { text: '需修改', style: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
    needs_tommy: { text: '需決策', style: 'bg-red-500/15 text-red-400 border-red-500/30' },
  };
  const confEmoji: Record<string, string> = { high: '🟢', medium: '🟡', low: '🔴' };

  return (
    <div className="space-y-4">
      {/* What this task is about */}
      {task.description && (
        <section>
          <h3 className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 font-medium">這張 ticket 在做什麼</h3>
          <p className="text-sm text-zinc-300 leading-relaxed">{task.description.slice(0, 300)}{task.description.length > 300 ? '...' : ''}</p>
        </section>
      )}

      {/* What was done */}
      {data.workSummary && (
        <section>
          <h3 className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 font-medium">完成了什麼</h3>
          <div className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
            <Linkify>{data.workSummary.slice(0, 500) + (data.workSummary.length > 500 ? '...' : '')}</Linkify>
          </div>
        </section>
      )}

      {/* PM Review Verdict */}
      {data.pmVerdict && (
        <section>
          <h3 className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 font-medium">懶懶 Review</h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${verdictLabel[data.pmVerdict]?.style || 'bg-zinc-700 text-zinc-400 border-zinc-600'}`}>
                {verdictLabel[data.pmVerdict]?.text || data.pmVerdict}
              </span>
              {data.pmConfidence && (
                <span className="text-xs text-zinc-400">
                  {confEmoji[data.pmConfidence] || ''} {data.pmConfidence}
                </span>
              )}
            </div>
            {data.pmReasoning && (
              <p className="text-xs text-zinc-400 leading-relaxed">{data.pmReasoning}</p>
            )}
          </div>
        </section>
      )}

      {/* Test Results */}
      <section>
        <h3 className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 font-medium">測試結果</h3>
        {data.testContent ? (
          <div className={`p-2.5 rounded-lg border text-xs leading-relaxed ${
            data.testPassed
              ? 'bg-green-500/8 border-green-500/20 text-green-200/80'
              : 'bg-red-500/8 border-red-500/20 text-red-200/80'
          }`}>
            <span className="font-medium">{data.testPassed ? '✅ Pass' : '⚠️ Issues'}</span>
            <p className="mt-1 whitespace-pre-wrap opacity-80">{data.testContent.slice(0, 200)}</p>
          </div>
        ) : (
          <p className="text-xs text-zinc-500 italic">無測試紀錄</p>
        )}
      </section>

      {/* Links */}
      <section className="flex flex-col gap-2">
        {data.docLink && (
          <a href={data.docLink}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/10 hover:border-blue-500/30 transition-colors">
            <span className="text-blue-400 text-sm">📄</span>
            <span className="text-xs text-blue-300 font-medium truncate">{data.docFilename || '查看研究文件'}</span>
          </a>
        )}
        {data.branch && (
          <div className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-zinc-800/60 border border-zinc-700/40">
            <span className="text-green-400 text-xs">🌿</span>
            <code className="text-[11px] text-zinc-300 truncate">{data.branch}</code>
          </div>
        )}
        {data.prUrl && (
          <a href={data.prUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-indigo-500/20 bg-indigo-500/5 hover:bg-indigo-500/10 transition-colors">
            <span className="text-indigo-400 text-sm">🔀</span>
            <span className="text-xs text-indigo-300 font-medium">查看 PR</span>
            {data.prStatus && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ml-auto ${PR_STATUS_BADGE[data.prStatus] || ''}`}>
                {data.prStatus}
              </span>
            )}
          </a>
        )}
      </section>

      {/* Meta */}
      <section className="space-y-2 text-xs text-zinc-500 border-t border-zinc-800/60 pt-3">
        <div className="flex justify-between">
          <span>優先度</span>
          <span className="text-zinc-300">{task.priority}</span>
        </div>
        <div className="flex justify-between">
          <span>分類</span>
          <span className="text-zinc-300">{task.category.replace('_', ' ')}</span>
        </div>
        {task.auto_execute === 1 && (
          <div className="flex justify-between">
            <span>執行者</span>
            <span className="text-teal-400">🤖 {task.completed_by || '懶懶'}</span>
          </div>
        )}
        {task.completed_at && (
          <div className="flex justify-between">
            <span>完成時間</span>
            <span className="text-zinc-300">{formatTime(task.completed_at)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>建立者</span>
          <span className="text-zinc-300">{task.created_by}</span>
        </div>
      </section>
    </div>
  );
}

// ─── Default Left Panel (non-review) ────────────────────────────────────────

function DefaultLeftPanel({ task }: { task: Task }) {
  return (
    <div className="space-y-4">
      {task.description && (
        <div>
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 font-medium">描述</p>
          <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{task.description}</p>
        </div>
      )}

      {task.result_notes && (
        <div className={`p-3 rounded-lg border ${
          task.status === 'blocked'
            ? 'bg-red-500/8 border-red-500/20'
            : task.status === 'review'
              ? 'bg-amber-500/8 border-amber-500/20'
              : 'bg-green-500/8 border-green-500/20'
        }`}>
          <p className={`text-[10px] mb-1.5 font-semibold ${
            task.status === 'blocked'
              ? 'text-red-400'
              : task.status === 'review'
                ? 'text-amber-400'
                : 'text-green-500/70'
          }`}>
            {task.status === 'blocked' ? '⛔ 需要你處理' : task.status === 'review' ? '📋 等待你 Review' : '📋 執行結果'}
          </p>
          <p className={`text-xs whitespace-pre-wrap leading-relaxed ${
            task.status === 'blocked'
              ? 'text-red-200/80'
              : task.status === 'review'
                ? 'text-amber-200/80'
                : 'text-green-200/80'
          }`}><Linkify>{task.result_notes}</Linkify></p>
        </div>
      )}

      {/* Meta fields */}
      <div className="space-y-2 text-xs text-zinc-500 border-t border-zinc-800/60 pt-3">
        <div className="flex justify-between">
          <span>優先度</span>
          <span className="text-zinc-300">{task.priority}</span>
        </div>
        <div className="flex justify-between">
          <span>分類</span>
          <span className="text-zinc-300">{task.category.replace('_', ' ')}</span>
        </div>
        {task.auto_execute === 1 && (
          <div className="flex justify-between">
            <span>執行者</span>
            <span className="text-teal-400">🤖 懶懶</span>
          </div>
        )}
        {task.completed_at && (
          <div className="flex justify-between">
            <span>完成時間</span>
            <span className="text-zinc-300">{formatTime(task.completed_at)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>建立者</span>
          <span className="text-zinc-300">{task.created_by}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Comment Item (simplified) ──────────────────────────────────────────────

/** Comments that are noise when reviewing — shown collapsed */
const NOISE_TYPES = new Set(['branch', 'action']);

function CommentItem({ comment, collapsed }: { comment: TaskComment; collapsed?: boolean }) {
  const meta = parseMeta(comment.metadata);
  const typeMeta = TYPE_META[comment.type] ?? TYPE_META.note;
  const isBot = comment.author !== 'tommy';
  const authorDisplay = comment.author === 'tommy' ? 'Tommy'
    : comment.author === '小工' ? '小工'
    : comment.author === '小企' ? '小企'
    : '懶懶';

  if (collapsed) {
    // One-line collapsed view for noise comments
    const preview = comment.content.replace(/<[^>]+>/g, '').replace(/\*\*/g, '').slice(0, 60);
    return (
      <div className="flex items-center gap-2 text-[11px] text-zinc-600 py-0.5">
        <span>{typeMeta.icon}</span>
        <span className="truncate">{preview}</span>
        <span className="text-[10px] text-zinc-700 ml-auto shrink-0">{formatTime(comment.created_at).split(' ')[1]}</span>
      </div>
    );
  }

  return (
    <div className="flex gap-3 group">
      {/* Avatar */}
      <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mt-0.5
        ${isBot ? 'bg-indigo-600/30 text-indigo-300' : 'bg-zinc-700 text-zinc-300'}`}>
        {isBot ? '🤖' : '👤'}
      </div>

      <div className="flex-1 min-w-0 space-y-1">
        {/* Header */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-zinc-300">{authorDisplay}</span>
          <span className={`text-[10px] ${typeMeta.color}`}>{typeMeta.icon} {typeMeta.label}</span>
          <span className="text-[10px] text-zinc-600 ml-auto">{formatTime(comment.created_at)}</span>
        </div>

        {/* PR card */}
        {comment.type === 'pr' && meta.url && (
          <a href={meta.url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 p-2 rounded-lg border border-zinc-700/50 bg-zinc-800/60 hover:border-zinc-600 transition-colors">
            <span className="text-indigo-400 text-sm">🔀</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-zinc-200 font-medium truncate">{meta.title ?? meta.url}</p>
              {meta.branch && <p className="text-[10px] text-zinc-500 truncate">{meta.branch}</p>}
            </div>
            {meta.status && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${PR_STATUS_BADGE[meta.status] ?? PR_STATUS_BADGE.closed}`}>
                {meta.status}
              </span>
            )}
          </a>
        )}

        {/* Doc link */}
        {comment.type === 'doc' && (meta.url || meta.knowledgeLink) && (
          <a href={meta.knowledgeLink ?? meta.url}
            {...((meta.url && !meta.knowledgeLink) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/10 hover:border-blue-500/30 transition-colors">
            <span className="text-blue-400">📄</span>
            <span className="text-sm text-blue-300 font-medium">{meta.filename ?? meta.title ?? '查看研究文件'}</span>
            <span className="text-[10px] text-zinc-500 ml-auto">→</span>
          </a>
        )}

        {/* Content body — hide for doc/branch comments that already have a card */}
        {comment.content && !(comment.type === 'doc' && (meta.knowledgeLink || meta.url)) && comment.type !== 'branch' && (
          <div className={`text-sm leading-relaxed whitespace-pre-wrap
            ${comment.type === 'discussion' ? 'text-amber-200/80' : 'text-zinc-300'}
            ${comment.type === 'research' || comment.type === 'analysis' || comment.type === 'test' || comment.type === 'review'
              ? 'bg-zinc-800/40 rounded-lg p-3 border border-zinc-700/30 text-xs' : ''}
          `}>
            <Linkify>{comment.content}</Linkify>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Smart Comment List ─────────────────────────────────────────────────────

function SmartCommentList({ comments, isReview }: { comments: TaskComment[]; isReview: boolean }) {
  const [showAll, setShowAll] = useState(false);

  // Group: important comments shown fully, noise collapsed
  const { important, noise } = useMemo(() => {
    if (!isReview || showAll) return { important: comments, noise: [] as TaskComment[] };

    const imp: TaskComment[] = [];
    const noi: TaskComment[] = [];

    for (const c of comments) {
      // Always show these
      if (c.author === 'tommy' || c.type === 'review' || c.type === 'test' || c.type === 'research'
        || c.type === 'doc' || c.type === 'pr' || c.type === 'discussion' || c.type === 'note') {
        imp.push(c);
        continue;
      }

      // Action comments: show work logs, hide boilerplate
      if (c.type === 'action') {
        const isBoilerplate = c.content.includes('自動執行開始')
          || c.content.includes('❌')
          || c.content.startsWith('🤖 自動執行')
          || c.content.startsWith('🔧 小工自動執行');
        if (isBoilerplate) { noi.push(c); } else { imp.push(c); }
        continue;
      }

      // Branch comments: always noise (info already shown in left panel)
      if (c.type === 'branch') { noi.push(c); continue; }

      // Default: show
      imp.push(c);
    }

    // If nothing important was found, show everything (don't leave panel empty)
    if (imp.length === 0 && noi.length > 0) {
      return { important: comments, noise: [] as TaskComment[] };
    }

    return { important: imp, noise: noi };
  }, [comments, isReview, showAll]);

  return (
    <div className="space-y-4">
      {/* Collapsed noise */}
      {noise.length > 0 && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full text-left px-3 py-2 rounded-lg bg-zinc-800/30 border border-zinc-800/40 hover:bg-zinc-800/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">{noise.length} 則執行紀錄（已收合）</span>
            <span className="text-[10px] text-zinc-600 ml-auto">點擊展開</span>
          </div>
          {/* Show last 2 noise items as preview */}
          <div className="mt-1.5">
            {noise.slice(-2).map(c => (
              <CommentItem key={c.id} comment={c} collapsed />
            ))}
          </div>
        </button>
      )}

      {/* Important comments */}
      {important.map(c => <CommentItem key={c.id} comment={c} />)}
    </div>
  );
}

// ─── New Comment Form ──────────────────────────────────────────────────────────

const COMMENT_TYPES: CommentType[] = ['note', 'discussion', 'action', 'research', 'pr', 'branch', 'doc', 'analysis', 'test'];

function NewCommentForm({ taskId, onAdded }: { taskId: number; onAdded: () => void }) {
  const [type, setType] = useState<CommentType>('note');
  const [content, setContent] = useState('');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const needsUrl = type === 'pr' || type === 'doc' || type === 'branch';

  const submit = async () => {
    if (!content.trim() && !url.trim()) return;
    setLoading(true);

    let metadata: CommentMeta | undefined;
    if (type === 'pr' && url) metadata = { url };
    else if (type === 'doc' && url) metadata = { url, title: content.split('\n')[0].slice(0, 80) };
    else if (type === 'branch') metadata = { branch_name: url || content.split('\n')[0] };

    await fetch(`/api/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, content: content || url, author: 'tommy', metadata }),
    });

    setContent(''); setUrl(''); setType('note');
    setLoading(false);
    onAdded();
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
  };

  return (
    <div className="space-y-2">
      {/* Type selector */}
      <div className="flex gap-1 flex-wrap">
        {COMMENT_TYPES.map(t => {
          const tm = TYPE_META[t];
          return (
            <button key={t} onClick={() => setType(t)}
              className={`text-[10px] px-2 py-1 rounded-md transition-colors flex items-center gap-1
                ${type === t ? 'bg-zinc-700 text-zinc-100 font-medium' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'}`}>
              {tm.icon} {tm.label}
            </button>
          );
        })}
      </div>

      {needsUrl && (
        <input value={url} onChange={e => setUrl(e.target.value)}
          placeholder={type === 'pr' ? 'GitHub PR URL...' : type === 'branch' ? 'branch-name...' : 'https://...'}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500 placeholder-zinc-600"
        />
      )}

      <div className="relative">
        <textarea ref={textareaRef}
          value={content} onChange={e => setContent(e.target.value)} onKeyDown={handleKey}
          rows={2} placeholder={`${TYPE_META[type].icon} ${type === 'discussion' ? '有什麼需要討論的...' : '加入備注... (⌘↵ 送出)'}`}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500 resize-none placeholder-zinc-600"
        />
      </div>

      <div className="flex justify-end">
        <button onClick={submit} disabled={loading || (!content.trim() && !url.trim())}
          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors disabled:opacity-40 flex items-center gap-1.5">
          {loading ? '送出中...' : '送出'}
        </button>
      </div>
    </div>
  );
}

// ─── Task Drawer ───────────────────────────────────────────────────────────────

interface TaskDrawerProps {
  task: Task | null;
  onClose: () => void;
  onTaskUpdated: () => void;
}

export function TaskDrawer({ task, onClose, onTaskUpdated }: TaskDrawerProps) {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const commentsEndRef = useRef<HTMLDivElement>(null);

  const fetchComments = async () => {
    if (!task) return;
    setLoadingComments(true);
    const res = await fetch(`/api/tasks/${task.id}/comments`);
    const data = await res.json();
    setComments(data.comments ?? []);
    setLoadingComments(false);
  };

  useEffect(() => {
    if (task) fetchComments();
    else setComments([]);
  }, [task?.id]);

  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments.length]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const isReview = task?.status === 'review';
  const reviewData = useMemo(() => {
    if (!task) return {} as ReviewSummaryData;
    return extractReviewData(task, comments);
  }, [task, comments]);

  const handleQuickAction = async (action: 'approve' | 'reject') => {
    if (!task) return;
    setActionLoading(action);
    try {
      const newStatus = action === 'approve' ? 'done' : 'in_progress';
      await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          ...(action === 'approve' ? { completed_at: new Date().toISOString() } : {}),
        }),
      });
      await fetch(`/api/tasks/${task.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author: 'tommy',
          type: 'review',
          content: action === 'approve' ? '已透過儀表板核准' : '已透過儀表板拒絕——退回 Agent 重做',
        }),
      });
      onTaskUpdated();
      onClose();
    } catch (e) {
      console.error('Quick action failed:', e);
    } finally {
      setActionLoading(null);
    }
  };

  if (!task) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />

      <div
        className="relative z-10 w-full md:max-w-4xl h-[95vh] md:h-auto md:max-h-[88vh] bg-zinc-900 border-t md:border border-zinc-700/60 rounded-t-2xl md:rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-6 py-4 border-b border-zinc-800/60 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[10px] text-zinc-500">#{task.id}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium
                ${task.status === 'review'      ? 'bg-amber-500/15 text-amber-400' :
                  task.status === 'done'        ? 'bg-green-500/15 text-green-400' :
                  task.status === 'in_progress' ? 'bg-blue-500/15 text-blue-400'  :
                  task.status === 'blocked'     ? 'bg-red-500/15 text-red-400'    :
                  'bg-zinc-700/60 text-zinc-400'}`}>
                {task.status.replace('_', ' ')}
              </span>
              <span className="text-[10px] text-zinc-500">{task.priority} · {task.category.replace('_', ' ')}</span>
            </div>
            <h2 className="text-lg font-semibold text-zinc-100 leading-snug">{task.title}</h2>
          </div>
          <button onClick={onClose}
            className="shrink-0 p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors text-lg leading-none">
            ✕
          </button>
        </div>

        {/* Body — two columns */}
        <div className="flex flex-col md:flex-row flex-1 min-h-0 md:divide-x divide-zinc-800/60">

          {/* Left: review summary or default */}
          <div className="w-full md:w-80 shrink-0 overflow-y-auto px-4 md:px-6 py-4 border-b md:border-b-0 border-zinc-800/60 max-h-[40vh] md:max-h-none">
            {isReview ? (
              <ReviewSummaryPanel task={task} data={reviewData} />
            ) : (
              <DefaultLeftPanel task={task} />
            )}
          </div>

          {/* Right: activity / comments */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-6 pt-4 pb-2 shrink-0">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">活動紀錄</p>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-4">
              {loadingComments ? (
                <p className="text-xs text-zinc-600 text-center py-8">載入中...</p>
              ) : comments.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-zinc-700 text-sm">還沒有任何紀錄</p>
                  <p className="text-zinc-800 text-xs mt-1">懶懶執行 task 時會自動新增 log</p>
                </div>
              ) : (
                <SmartCommentList comments={comments} isReview={isReview} />
              )}
              <div ref={commentsEndRef} />
            </div>

            {/* Action buttons or comment input */}
            <div className="px-6 pb-5 border-t border-zinc-800/60 pt-3 shrink-0 space-y-3">
              {isReview && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleQuickAction('approve')}
                    disabled={!!actionLoading}
                    className="flex-1 px-4 py-2.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-medium transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {actionLoading === 'approve' ? '處理中...' : '✅ 核准'}
                  </button>
                  <button
                    onClick={() => handleQuickAction('reject')}
                    disabled={!!actionLoading}
                    className="flex-1 px-4 py-2.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm font-medium transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {actionLoading === 'reject' ? '處理中...' : '❌ 拒絕'}
                  </button>
                </div>
              )}
              <NewCommentForm taskId={task.id} onAdded={() => { fetchComments(); onTaskUpdated(); }} />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
