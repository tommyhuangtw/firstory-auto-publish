import { NextResponse } from 'next/server';
import { getScheduler } from '@/services/scheduler';
import { initializeSchedulerJobs } from '@/lib/schedulerInit';

export async function GET() {
  initializeSchedulerJobs();
  const scheduler = getScheduler();
  return NextResponse.json({ jobs: scheduler.getStatus() });
}
