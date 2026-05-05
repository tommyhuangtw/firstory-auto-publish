'use client';

import { useEffect, useState } from 'react';

interface ScheduleSlot {
  day: number;
  segment: string;
  time: string;
}

interface WeeklyScheduleConfig {
  slots: ScheduleSlot[];
}

const DAYS = [
  { day: 1, label: '一' },
  { day: 2, label: '二' },
  { day: 3, label: '三' },
  { day: 4, label: '四' },
  { day: 5, label: '五' },
  { day: 6, label: '六' },
  { day: 0, label: '日' },
];

const SEGMENTS: Array<{ value: string; label: string; color: string; bg: string; dot: string }> = [
  { value: 'daily',     label: 'AI懶人報',   color: 'text-blue-400',   bg: 'bg-blue-500/20 border-blue-500/30', dot: 'bg-blue-400' },
  { value: 'weekly',    label: 'AI精選週報',  color: 'text-green-400',  bg: 'bg-green-500/20 border-green-500/30', dot: 'bg-green-400' },
  { value: 'robot',     label: '機器人週報',  color: 'text-orange-400', bg: 'bg-orange-500/20 border-orange-500/30', dot: 'bg-orange-400' },
  { value: 'sysdesign', label: '系統架構',    color: 'text-purple-400', bg: 'bg-purple-500/20 border-purple-500/30', dot: 'bg-purple-400' },
];

function getSegmentInfo(value: string) {
  return SEGMENTS.find((s) => s.value === value);
}

export default function WeeklyScheduleEditor({ onSaved }: { onSaved?: () => void }) {
  const [slots, setSlots] = useState<Map<number, ScheduleSlot>>(new Map());
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetch('/api/scheduler/schedule')
      .then((r) => r.json())
      .then((data: WeeklyScheduleConfig) => {
        const map = new Map<number, ScheduleSlot>();
        for (const slot of data.slots) {
          map.set(slot.day, slot);
        }
        setSlots(map);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function setSlot(day: number, segment: string, time: string) {
    setSlots((prev) => {
      const next = new Map(prev);
      next.set(day, { day, segment, time });
      return next;
    });
    setDirty(true);
  }

  function clearSlot(day: number) {
    setSlots((prev) => {
      const next = new Map(prev);
      next.delete(day);
      return next;
    });
    setDirty(true);
    setEditingDay(null);
  }

  async function handleSave() {
    setSaving(true);
    setMessage('');
    try {
      const config: WeeklyScheduleConfig = {
        slots: Array.from(slots.values()),
      };
      const res = await fetch('/api/scheduler/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage(data.message);
      setDirty(false);
      onSaved?.();
    } catch (err) {
      setMessage(`錯誤: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-zinc-900/60 rounded-xl border border-zinc-800/80 p-4 mb-4 animate-pulse">
        <div className="h-4 bg-zinc-800 rounded w-20 mb-3" />
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-14 bg-zinc-800/50 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900/60 rounded-xl border border-zinc-800/80 p-4 mb-4">
      {/* Header row with title + save button inline */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-200">週間排程</h2>
          <p className="text-zinc-500 text-[11px] mt-0.5">點擊日期設定單元與時間</p>
        </div>
        <div className="flex items-center gap-2">
          {message && (
            <span className={`text-xs ${message.startsWith('錯誤') ? 'text-red-400' : 'text-green-400'}`}>
              {message}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="bg-brand hover:bg-brand/80 disabled:opacity-30 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {saving ? '儲存中...' : '儲存排程'}
          </button>
        </div>
      </div>

      {/* Weekly grid — compact with integrated day labels */}
      <div className="grid grid-cols-7 gap-1.5">
        {DAYS.map(({ day, label }) => {
          const slot = slots.get(day);
          const info = slot ? getSegmentInfo(slot.segment) : null;
          const isEditing = editingDay === day;

          return (
            <div key={day} className="relative">
              <button
                onClick={() => setEditingDay(isEditing ? null : day)}
                className={`w-full rounded-lg border transition-all cursor-pointer px-1.5 py-2 ${
                  isEditing
                    ? 'border-brand ring-1 ring-brand/30'
                    : slot && info
                      ? `${info.bg} hover:brightness-125`
                      : 'border-zinc-700/60 bg-zinc-800/40 hover:bg-zinc-800 hover:border-zinc-600'
                }`}
              >
                {/* Day label always on top */}
                <div className={`text-[10px] font-medium mb-0.5 ${
                  slot ? 'text-zinc-400' : 'text-zinc-500'
                }`}>
                  {label}
                </div>
                {slot && info ? (
                  <>
                    <div className={`text-xs font-medium leading-tight ${info.color}`}>{info.label}</div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">{slot.time}</div>
                  </>
                ) : (
                  <div className="text-zinc-700 text-xs py-0.5">--</div>
                )}
              </button>

              {/* Popover editor */}
              {isEditing && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-20 bg-zinc-800 border border-zinc-700 rounded-lg p-2.5 shadow-xl min-w-[160px]">
                  <div className="space-y-1 mb-2">
                    {SEGMENTS.map((seg) => (
                      <button
                        key={seg.value}
                        onClick={() => setSlot(day, seg.value, slot?.time ?? '11:00')}
                        className={`w-full text-left text-xs px-2 py-1.5 rounded flex items-center gap-2 transition-colors cursor-pointer ${
                          slot?.segment === seg.value
                            ? `${seg.bg} ${seg.color} font-medium`
                            : 'text-zinc-300 hover:bg-zinc-700'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${seg.dot}`} />
                        {seg.label}
                      </button>
                    ))}
                  </div>

                  {slot && (
                    <div className="mb-2">
                      <input
                        type="time"
                        value={slot.time}
                        onChange={(e) => setSlot(day, slot.segment, e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-200 [color-scheme:dark]"
                      />
                    </div>
                  )}

                  <div className="flex gap-1.5 border-t border-zinc-700 pt-2">
                    {slot && (
                      <button
                        onClick={() => clearSlot(day)}
                        className="flex-1 text-[11px] text-red-400 hover:bg-red-900/30 rounded py-1 transition-colors cursor-pointer"
                      >
                        清除
                      </button>
                    )}
                    <button
                      onClick={() => setEditingDay(null)}
                      className="flex-1 text-[11px] text-zinc-400 hover:bg-zinc-700 rounded py-1 transition-colors cursor-pointer"
                    >
                      關閉
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
