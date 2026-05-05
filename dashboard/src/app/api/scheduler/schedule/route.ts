import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { getScheduleConfig, reloadScheduleFromDb } from '@/lib/schedulerInit';
import type { WeeklyScheduleConfig, ScheduleSlot } from '@/lib/schedulerInit';

const VALID_SEGMENTS = ['daily', 'weekly', 'robot', 'sysdesign'];

function validateConfig(config: unknown): config is WeeklyScheduleConfig {
  if (!config || typeof config !== 'object') return false;
  const c = config as Record<string, unknown>;
  if (!Array.isArray(c.slots)) return false;

  for (const slot of c.slots as unknown[]) {
    if (!slot || typeof slot !== 'object') return false;
    const s = slot as Record<string, unknown>;
    if (typeof s.day !== 'number' || s.day < 0 || s.day > 6) return false;
    if (typeof s.segment !== 'string' || !VALID_SEGMENTS.includes(s.segment)) return false;
    if (typeof s.time !== 'string' || !/^\d{1,2}:\d{2}$/.test(s.time)) return false;
  }

  // Check no duplicate days
  const days = (c.slots as ScheduleSlot[]).map((s) => s.day);
  if (new Set(days).size !== days.length) return false;

  return true;
}

export async function GET() {
  const config = getScheduleConfig();
  return NextResponse.json(config);
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    if (!validateConfig(body)) {
      return NextResponse.json(
        { error: 'Invalid schedule config' },
        { status: 400 }
      );
    }

    const db = getDb();
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('weekly_schedule', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run(JSON.stringify(body));

    reloadScheduleFromDb();

    return NextResponse.json({ message: '排程已更新' });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
