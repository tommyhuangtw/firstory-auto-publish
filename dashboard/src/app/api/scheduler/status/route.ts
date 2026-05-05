import { NextResponse } from 'next/server';
import { getScheduler } from '@/services/scheduler';

export async function GET() {
  const scheduler = getScheduler();
  return NextResponse.json({ jobs: scheduler.getStatus() });
}
