import { NextResponse } from 'next/server';
import { runResourceScan } from '@/services/resources/pipeline';

export async function POST() {
  runResourceScan({ trigger: 'manual' }).catch((e) => console.error('resource scan failed', e));
  return NextResponse.json({ ok: true, started: true });
}
