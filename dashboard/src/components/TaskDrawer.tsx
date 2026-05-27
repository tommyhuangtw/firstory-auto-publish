'use client';

import { useState, useEffect, useRef } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type CommentType = 'action' | 'research' | 'discussion' | 'pr' | 'branch' | 'doc' | 'analysis' | 'note';

export interface CommentMeta {
  url?: string;
  title?: string;
  branch?: string;
  branch_name?: string;
  repo?: string;
  status?: 'open' | 'merged' | 'closed';
  summary?: string;
}

export interface TaskComment {
  id: number;
  task_id: number;
  author: 'hermes' | 'tommy';
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

// ─── Helpers ───────────────────────────────────────────────────────────────────

const TYPE_META: Record<CommentType, { icon: string; label: string; color: string }> = {
  action:     { icon: '🔧', label: 'Action',     color: 'text-zinc-400' },
  research:   { icon: '📄', label: 'Research',   color: 'text-teal-400' },
  discussion: { icon: '💬', label: 'Discussion', color: 'text-amber-400' },
  pr:         { icon: '🔀', label: 'PR',         color: 'text-indigo-400' },
  branch:     { icon: '🌿', label: 'Branch',     color: 'text-green-400' },
  doc:        { icon: '📎', label: 'Doc',        color: 'text-blue-400' },
  analysis:   { icon: '📊', label: 'Analysis',   color: 'text-purple-400' },
  note:       { icon: '📌', label: 'Note',       color: 'text-zinc-400' },
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
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '剛剛';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ─── Comment Item ──────────────────────────────────────────────────────────────

function CommentItem({ comment }: { comment: TaskComment }) {
  const meta = parseMeta(comment.metadata);
  const typeMeta = TYPE_META[comment.type] ?? TYPE_META.note;
  const isHermes = comment.author === 'hermes';

  return (
    <div className="flex gap-3 group">
      {/* Avatar */}
      <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mt-0.5
        ${isHermes ? 'bg-indigo-600/30 text-indigo-300' : 'bg-zinc-700 text-zinc-300'}`}>
        {isHermes ? '🤖' : '👤'}
      </div>

      <div className="flex-1 min-w-0 space-y-1">
        {/* Header */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-zinc-300">{isHermes ? '懶懶' : 'Tommy'}</span>
          <span className={`text-[10px] ${typeMeta.color}`}>{typeMeta.icon} {typeMeta.label}</span>
          <span className="text-[10px] text-zinc-600 ml-auto">{formatTime(comment.created_at)}</span>
        </div>

        {/* PR card */}
        {comment.type === 'pr' && meta.url && (
          <a href={meta.url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 p-2 rounded-lg border border-zinc-700/50 bg-zinc-800/60 hover:border-zinc-600 transition-colors group/pr">
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

        {/* Branch pill */}
        {comment.type === 'branch' && (meta.branch_name || meta.branch) && (
          <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-green-500/10 border border-green-500/20">
            <span className="text-green-400 text-xs">🌿</span>
            <code className="text-xs text-green-300">{meta.branch_name ?? meta.branch}</code>
            {meta.repo && <span className="text-[10px] text-zinc-500">· {meta.repo}</span>}
          </div>
        )}

        {/* Doc link */}
        {comment.type === 'doc' && meta.url && (
          <a href={meta.url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors">
            📎 {meta.title ?? meta.url}
          </a>
        )}

        {/* Content body */}
        {comment.content && (
          <div className={`text-sm leading-relaxed whitespace-pre-wrap
            ${comment.type === 'discussion' ? 'text-amber-200/80' : 'text-zinc-300'}
            ${comment.type === 'research' || comment.type === 'analysis' ? 'bg-zinc-800/40 rounded-lg p-3 border border-zinc-700/30 text-xs' : ''}
          `}>
            {comment.content}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── New Comment Form ──────────────────────────────────────────────────────────

const COMMENT_TYPES: CommentType[] = ['action', 'research', 'discussion', 'pr', 'branch', 'doc', 'analysis', 'note'];

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
    <div className="border-t border-zinc-800 pt-3 space-y-2">
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

      {/* URL field (for pr/doc/branch) */}
      {needsUrl && (
        <input value={url} onChange={e => setUrl(e.target.value)}
          placeholder={type === 'pr' ? 'GitHub PR URL...' : type === 'branch' ? 'branch-name...' : 'https://...'}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500 placeholder-zinc-600"
        />
      )}

      {/* Content */}
      <div className="relative">
        <textarea ref={textareaRef}
          value={content} onChange={e => setContent(e.target.value)} onKeyDown={handleKey}
          rows={3} placeholder={`${TYPE_META[type].icon} ${type === 'discussion' ? '有什麼需要討論的...' : '加入備注... (⌘↵ 送出)'}`}
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
    // Scroll to bottom on new comments
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments.length]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const isOpen = !!task;

  if (!isOpen || !task) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Modal — Jira-style: wide, two-panel layout */}
      <div
        className="relative z-10 w-full max-w-4xl max-h-[88vh] bg-zinc-900 border border-zinc-700/60 rounded-xl shadow-2xl flex flex-col overflow-hidden"
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
        <div className="flex flex-1 min-h-0 divide-x divide-zinc-800/60">

          {/* Left: description + result notes */}
          <div className="w-80 shrink-0 overflow-y-auto px-6 py-4 space-y-4">
            {task.description && (
              <div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 font-medium">描述</p>
                <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">{task.description}</p>
              </div>
            )}

            {task.result_notes && (
              <div className="p-3 rounded-lg bg-green-500/8 border border-green-500/20">
                <p className="text-[10px] text-green-500/70 mb-1 font-medium">📋 執行結果</p>
                <p className="text-xs text-green-200/80 whitespace-pre-wrap leading-relaxed">{task.result_notes}</p>
              </div>
            )}

            {/* Meta fields */}
            <div className="space-y-2 text-xs text-zinc-500 border-t border-zinc-800/60 pt-3">
              <div className="flex justify-between">
                <span>Priority</span>
                <span className="text-zinc-300">{task.priority}</span>
              </div>
              <div className="flex justify-between">
                <span>Category</span>
                <span className="text-zinc-300">{task.category.replace('_', ' ')}</span>
              </div>
              {task.auto_execute === 1 && (
                <div className="flex justify-between">
                  <span>執行者</span>
                  <span className="text-teal-400">🤖 懶懶</span>
                </div>
              )}
              {task.scheduled_at && (
                <div className="flex justify-between">
                  <span>排程</span>
                  <span className="text-zinc-300">{new Date(task.scheduled_at).toLocaleDateString('zh-TW')}</span>
                </div>
              )}
              {task.completed_at && (
                <div className="flex justify-between">
                  <span>完成時間</span>
                  <span className="text-zinc-300">{new Date(task.completed_at).toLocaleDateString('zh-TW')}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>建立者</span>
                <span className="text-zinc-300">{task.created_by}</span>
              </div>
            </div>
          </div>

          {/* Right: activity / comments */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-6 pt-4 pb-2 shrink-0">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Activity</p>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-5">
              {loadingComments ? (
                <p className="text-xs text-zinc-600 text-center py-8">載入中...</p>
              ) : comments.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-zinc-700 text-sm">還沒有任何紀錄</p>
                  <p className="text-zinc-800 text-xs mt-1">懶懶執行 task 時會自動新增 log</p>
                </div>
              ) : (
                comments.map(c => <CommentItem key={c.id} comment={c} />)
              )}
              <div ref={commentsEndRef} />
            </div>

            {/* Comment input */}
            <div className="px-6 pb-5 border-t border-zinc-800/60 pt-3 shrink-0">
              <NewCommentForm taskId={task.id} onAdded={() => { fetchComments(); onTaskUpdated(); }} />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
