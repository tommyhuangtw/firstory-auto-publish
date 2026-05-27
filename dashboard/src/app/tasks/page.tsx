'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type Priority = 'low' | 'medium' | 'high' | 'urgent';
type Status = 'todo' | 'in_progress' | 'done' | 'cancelled';
type Category = 'content' | 'infra' | 'social_media' | 'youtube' | 'ig' | 'threads' | 'research' | 'ops' | 'growth';

interface Task {
  id: number;
  title: string;
  description?: string;
  status: Status;
  priority: Priority;
  category: Category;
  scheduled_at?: string;
  auto_execute: number;
  episode_id?: number;
  result_notes?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

const COLUMNS: { key: Status; label: string; dot: string; border: string; bg: string }[] = [
  { key: 'todo',        label: 'Todo',        dot: 'bg-zinc-500',   border: 'border-zinc-700/50', bg: 'bg-zinc-900/50' },
  { key: 'in_progress', label: 'In Progress', dot: 'bg-blue-500',   border: 'border-zinc-700/50', bg: 'bg-zinc-900/50' },
  { key: 'done',        label: 'Done',        dot: 'bg-green-500',  border: 'border-zinc-700/50', bg: 'bg-zinc-900/50' },
  { key: 'cancelled',   label: 'Cancelled',   dot: 'bg-zinc-700',   border: 'border-zinc-700/50', bg: 'bg-zinc-900/30' },
];

const PRIORITY_DOT: Record<Priority, string> = {
  urgent: 'bg-red-500',
  high:   'bg-orange-400',
  medium: 'bg-yellow-400',
  low:    'bg-zinc-500',
};

const CATEGORY_COLOR: Record<Category, string> = {
  content:      'text-purple-400 bg-purple-500/10',
  infra:        'text-zinc-400 bg-zinc-500/10',
  social_media: 'text-pink-400 bg-pink-500/10',
  youtube:      'text-red-400 bg-red-500/10',
  ig:           'text-fuchsia-400 bg-fuchsia-500/10',
  threads:      'text-sky-400 bg-sky-500/10',
  research:     'text-teal-400 bg-teal-500/10',
  ops:          'text-amber-400 bg-amber-500/10',
  growth:       'text-green-400 bg-green-500/10',
};

const CATEGORIES: Category[] = ['content', 'infra', 'social_media', 'youtube', 'ig', 'threads', 'research', 'ops', 'growth'];
const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];

// ─── Shared form fields component ─────────────────────────────────────────────

function TaskFormFields({
  form,
  onChange,
}: {
  form: {
    title: string;
    description: string;
    priority: Priority;
    category: Category;
    scheduled_at: string;
    auto_execute: boolean;
  };
  onChange: (updates: Partial<typeof form>) => void;
}) {
  return (
    <>
      <div>
        <label className="text-xs text-zinc-500 mb-1 block">標題 *</label>
        <input
          autoFocus
          value={form.title}
          onChange={e => onChange({ title: e.target.value })}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500 placeholder-zinc-600"
          placeholder="Task 名稱..."
        />
      </div>

      <div>
        <label className="text-xs text-zinc-500 mb-1 block">描述</label>
        <textarea
          value={form.description}
          onChange={e => onChange({ description: e.target.value })}
          rows={4}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500 resize-none placeholder-zinc-600"
          placeholder="詳細說明..."
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-zinc-500 mb-1 block">Priority</label>
          <select
            value={form.priority}
            onChange={e => onChange({ priority: e.target.value as Priority })}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none"
          >
            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-zinc-500 mb-1 block">Category</label>
          <select
            value={form.category}
            onChange={e => onChange({ category: e.target.value as Category })}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none"
          >
            {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="text-xs text-zinc-500 mb-1 block">排程時間（選填）</label>
        <input
          type="datetime-local"
          value={form.scheduled_at}
          onChange={e => onChange({ scheduled_at: e.target.value })}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
        />
      </div>

      <label className="flex items-center gap-2.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={form.auto_execute}
          onChange={e => onChange({ auto_execute: e.target.checked })}
          className="w-4 h-4 rounded accent-teal-500"
        />
        <span className="text-sm text-zinc-400">🤖 懶懶自動執行</span>
      </label>
    </>
  );
}

// ─── New Task Modal (with AI Refine) ──────────────────────────────────────────

function NewTaskModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [mode, setMode] = useState<'ai' | 'manual'>('ai');
  const [aiInput, setAiInput] = useState('');
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState('');
  const [form, setForm] = useState({
    title: '', description: '', priority: 'medium' as Priority,
    category: 'ops' as Category, scheduled_at: '', auto_execute: false,
  });
  const [loading, setLoading] = useState(false);

  const handleRefine = async () => {
    if (!aiInput.trim()) return;
    setRefining(true);
    setRefineError('');
    try {
      const res = await fetch('/api/tasks/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: aiInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRefineError(data.error ?? '發生錯誤');
      } else {
        setForm(f => ({
          ...f,
          title: data.title ?? f.title,
          description: data.description ?? f.description,
          priority: data.priority ?? f.priority,
          category: data.category ?? f.category,
          auto_execute: data.auto_execute ?? f.auto_execute,
        }));
        setMode('manual'); // switch to review mode
      }
    } catch {
      setRefineError('無法連線到 AI 服務');
    }
    setRefining(false);
  };

  const submit = async () => {
    if (!form.title.trim()) return;
    setLoading(true);
    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        auto_execute: form.auto_execute ? 1 : 0,
        scheduled_at: form.scheduled_at || null,
        created_by: 'manual',
      }),
    });
    setLoading(false);
    onCreated();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-xl w-full max-w-md p-5 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>

        {/* Header + mode tabs */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-100">新增 Task</h2>
          <div className="flex rounded-lg border border-zinc-700 overflow-hidden text-xs">
            <button
              onClick={() => setMode('ai')}
              className={`px-3 py-1.5 transition-colors ${mode === 'ai' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              ✨ AI 填寫
            </button>
            <button
              onClick={() => setMode('manual')}
              className={`px-3 py-1.5 transition-colors ${mode === 'manual' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              手動
            </button>
          </div>
        </div>

        {/* AI mode */}
        {mode === 'ai' && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">用口語描述你想做什麼</label>
              <textarea
                autoFocus
                value={aiInput}
                onChange={e => setAiInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRefine();
                }}
                rows={5}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500 resize-none placeholder-zinc-600"
                placeholder={`例如：「幫我研究一下 Threads API 有哪些發文功能，看看能不能自動排程，這個比較緊急」\n\n⌘↵ 或按下方按鈕讓 AI 整理成 ticket`}
              />
            </div>
            {refineError && (
              <p className="text-xs text-red-400">{refineError}</p>
            )}
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-400 transition-colors">
                取消
              </button>
              <button
                onClick={handleRefine}
                disabled={refining || !aiInput.trim()}
                className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {refining ? (
                  <>
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    AI 整理中...
                  </>
                ) : '✨ AI 整理成 Ticket'}
              </button>
            </div>
          </div>
        )}

        {/* Manual / Review mode */}
        {mode === 'manual' && (
          <>
            {form.title && (
              <div className="text-xs text-teal-400 bg-teal-500/10 border border-teal-500/20 rounded-lg px-3 py-2">
                ✨ AI 已整理完成，可繼續調整以下欄位
              </div>
            )}
            <TaskFormFields form={form} onChange={updates => setForm(f => ({ ...f, ...updates }))} />
            <div className="flex gap-2 pt-1">
              <button onClick={onClose} className="flex-1 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-400 transition-colors">
                取消
              </button>
              <button
                onClick={submit}
                disabled={loading || !form.title.trim()}
                className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-40"
              >
                {loading ? '建立中...' : '建立'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Edit Task Modal ───────────────────────────────────────────────────────────

function EditTaskModal({ task, onClose, onUpdated }: { task: Task; onClose: () => void; onUpdated: () => void }) {
  const [form, setForm] = useState({
    title: task.title,
    description: task.description ?? '',
    priority: task.priority,
    category: task.category,
    scheduled_at: task.scheduled_at
      ? new Date(task.scheduled_at).toISOString().slice(0, 16)
      : '',
    auto_execute: task.auto_execute === 1,
  });
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!form.title.trim()) return;
    setLoading(true);
    await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        auto_execute: form.auto_execute ? 1 : 0,
        scheduled_at: form.scheduled_at || null,
      }),
    });
    setLoading(false);
    onUpdated();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-xl w-full max-w-md p-5 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-100">編輯 Task</h2>
          <span className="text-xs text-zinc-600">#{task.id}</span>
        </div>

        <TaskFormFields form={form} onChange={updates => setForm(f => ({ ...f, ...updates }))} />

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-400 transition-colors">
            取消
          </button>
          <button
            onClick={submit}
            disabled={loading || !form.title.trim()}
            className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-40"
          >
            {loading ? '儲存中...' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sortable Task Card ───────────────────────────────────────────────────────

function TaskCard({ task, onUpdate, onEdit, isDragging = false }: {
  task: Task;
  onUpdate: () => void;
  onEdit: (task: Task) => void;
  isDragging?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging: isSortableDragging,
  } = useSortable({ id: `task-${task.id}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging ? 0.35 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative bg-zinc-800/60 border border-zinc-700/40 rounded-lg p-3 
        hover:border-zinc-600/60 hover:bg-zinc-800/80 transition-all duration-150
        ${isDragging ? 'shadow-2xl shadow-black/60 border-zinc-500/60 bg-zinc-700/80 rotate-1 scale-[1.02]' : ''}
      `}
    >
      {/* Drag handle — top strip */}
      <div
        {...attributes}
        {...listeners}
        className="absolute top-0 left-0 right-0 h-6 cursor-grab active:cursor-grabbing rounded-t-lg"
        title="拖拉移動"
      />

      {/* Priority dot + Title */}
      <div className="flex items-start gap-2 mt-1">
        <span className={`mt-[5px] shrink-0 w-2 h-2 rounded-full ${PRIORITY_DOT[task.priority]}`} />
        <p
          className="text-sm font-medium text-zinc-100 leading-snug cursor-pointer flex-1"
          onClick={() => setExpanded(e => !e)}
        >
          {task.title}
        </p>
        {task.auto_execute === 1 && (
          <span className="text-[10px] text-teal-400 shrink-0 mt-0.5" title="懶懶自動執行">🤖</span>
        )}
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1 mt-2 ml-4">
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${CATEGORY_COLOR[task.category]}`}>
          {task.category.replace('_', ' ')}
        </span>
        {task.episode_id && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400">
            EP{task.episode_id}
          </span>
        )}
        {task.scheduled_at && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-400">
            ⏰ {new Date(task.scheduled_at).toLocaleDateString('zh-TW')}
          </span>
        )}
      </div>

      {/* Expanded */}
      {expanded && (
        <div className="mt-2 ml-4 space-y-1.5 border-t border-zinc-700/40 pt-2">
          {task.description && (
            <p className="text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap">{task.description}</p>
          )}
          {task.result_notes && (
            <div className="bg-zinc-900/60 rounded p-2">
              <p className="text-[10px] text-zinc-500 mb-0.5">執行結果</p>
              <p className="text-xs text-zinc-300">{task.result_notes}</p>
            </div>
          )}
          <p className="text-[10px] text-zinc-600">
            {new Date(task.created_at).toLocaleDateString('zh-TW')} · {task.created_by}
          </p>
          <div className="flex gap-3 items-center">
            <button
              onClick={() => onEdit(task)}
              className="text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              ✏️ 編輯
            </button>
            <button
              onClick={async () => {
                await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
                onUpdate();
              }}
              className="text-[10px] text-red-500/60 hover:text-red-400 transition-colors"
            >
              刪除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Drag Overlay Card (floating while dragging) ──────────────────────────────

function DragOverlayCard({ task }: { task: Task }) {
  return <TaskCard task={task} onUpdate={() => {}} onEdit={() => {}} isDragging />;
}

// ─── Column ───────────────────────────────────────────────────────────────────

function KanbanColumn({
  col, tasks, onUpdate, onEdit, isOver,
}: {
  col: typeof COLUMNS[0];
  tasks: Task[];
  onUpdate: () => void;
  onEdit: (task: Task) => void;
  isOver: boolean;
}) {
  const taskIds = tasks.map(t => `task-${t.id}`);

  return (
    <div className={`flex flex-col rounded-xl border ${col.border} ${col.bg} transition-colors duration-150
      ${isOver ? 'border-blue-500/40 bg-blue-500/5' : ''}
    `}>
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-700/30">
        <span className={`w-2 h-2 rounded-full ${col.dot}`} />
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{col.label}</span>
        <span className="ml-auto text-xs text-zinc-600 bg-zinc-800/60 px-1.5 py-0.5 rounded">
          {tasks.length}
        </span>
      </div>

      {/* Cards */}
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <div
          className={`flex-1 p-2 space-y-2 min-h-[120px] transition-colors duration-150
            ${isOver ? 'bg-blue-500/5 rounded-b-xl' : ''}
          `}
        >
          {tasks.length === 0 ? (
            <div className={`flex items-center justify-center h-20 rounded-lg border border-dashed
              ${isOver ? 'border-blue-500/40 text-blue-400/60' : 'border-zinc-700/30 text-zinc-700'}
              text-xs transition-colors duration-150`}
            >
              {isOver ? '放開以移入' : '— 空的 —'}
            </div>
          ) : (
            tasks.map(task => (
              <TaskCard key={task.id} task={task} onUpdate={onUpdate} onEdit={onEdit} />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [overColumnKey, setOverColumnKey] = useState<Status | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/tasks?limit=200');
    const data = await res.json();
    setTasks(data.tasks || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const filtered = filterCategory === 'all' ? tasks : tasks.filter(t => t.category === filterCategory);
  const byStatus = (status: Status) => filtered.filter(t => t.status === status);

  // ── Drag handlers ──────────────────────────────────────────────────────────

  const handleDragStart = (event: DragStartEvent) => {
    const id = Number(String(event.active.id).replace('task-', ''));
    setActiveTask(tasks.find(t => t.id === id) ?? null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const overId = String(event.over?.id ?? '');
    if (overId.startsWith('col-')) {
      setOverColumnKey(overId.replace('col-', '') as Status);
    } else if (overId.startsWith('task-')) {
      const taskId = Number(overId.replace('task-', ''));
      const overTask = tasks.find(t => t.id === taskId);
      if (overTask) setOverColumnKey(overTask.status);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTask(null);
    setOverColumnKey(null);

    if (!over) return;

    const taskId = Number(String(active.id).replace('task-', ''));
    const overId = String(over.id);

    let newStatus: Status | null = null;

    if (overId.startsWith('col-')) {
      newStatus = overId.replace('col-', '') as Status;
    } else if (overId.startsWith('task-')) {
      const overTaskId = Number(overId.replace('task-', ''));
      const overTask = tasks.find(t => t.id === overTaskId);
      if (overTask) newStatus = overTask.status;
    }

    if (!newStatus) return;

    const draggedTask = tasks.find(t => t.id === taskId);
    if (!draggedTask || draggedTask.status === newStatus) return;

    // Optimistic update
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus! } : t));

    // Persist to API
    await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
  };

  const counts = {
    todo: tasks.filter(t => t.status === 'todo').length,
    in_progress: tasks.filter(t => t.status === 'in_progress').length,
  };

  return (
    <div className="min-h-screen bg-[#0f1011] text-zinc-100">
      {showModal && <NewTaskModal onClose={() => setShowModal(false)} onCreated={fetchTasks} />}
      {editingTask && <EditTaskModal task={editingTask} onClose={() => setEditingTask(null)} onUpdated={fetchTasks} />}

      {/* Header */}
      <div className="border-b border-zinc-800/60 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">🦥 懶懶 Task Board</h1>
            <p className="text-xs text-zinc-600 mt-0.5">
              {counts.todo} open · {counts.in_progress} in progress
            </p>
          </div>
          <button onClick={() => setShowModal(true)}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5">
            <span className="text-base leading-none">+</span> New Task
          </button>
        </div>

        {/* Category filter */}
        <div className="flex gap-1.5 mt-3 flex-wrap">
          {['all', ...CATEGORIES].map(cat => (
            <button key={cat} onClick={() => setFilterCategory(cat)}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                filterCategory === cat
                  ? 'bg-zinc-700 text-zinc-100 font-medium'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60'
              }`}>
              {cat === 'all' ? 'All' : cat.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Kanban Board */}
      {loading ? (
        <div className="flex items-center justify-center h-64 text-zinc-600 text-sm">載入中...</div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 items-start">
            {COLUMNS.map(col => (
              <ColumnDropZone key={col.key} colKey={col.key}>
                <KanbanColumn
                  col={col}
                  tasks={byStatus(col.key)}
                  onUpdate={fetchTasks}
                  onEdit={setEditingTask}
                  isOver={overColumnKey === col.key}
                />
              </ColumnDropZone>
            ))}
          </div>

          <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
            {activeTask ? <DragOverlayCard task={activeTask} /> : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

// ─── Column Drop Zone wrapper (makes the whole column a drop target) ──────────

function ColumnDropZone({ colKey, children }: { colKey: Status; children: React.ReactNode }) {
  const { setNodeRef } = useSortable({ id: `col-${colKey}` });
  return <div ref={setNodeRef}>{children}</div>;
}
