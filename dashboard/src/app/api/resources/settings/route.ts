import { NextResponse } from 'next/server';
import { rget, rset, EDITABLE_KEYS, type ResourceSettingKey } from '@/services/resources/settings';

export async function GET() {
  const settings = Object.fromEntries(EDITABLE_KEYS.map((k) => [k, rget(k)]));
  return NextResponse.json({ settings });
}

export async function PATCH(req: Request) {
  const body = await req.json() as { settings?: Record<string, string> };
  const allowed = new Set<string>(EDITABLE_KEYS);
  for (const [k, v] of Object.entries(body.settings ?? {})) {
    if (allowed.has(k) && typeof v === 'string') rset(k as ResourceSettingKey, v);
  }
  return NextResponse.json({ ok: true });
}
