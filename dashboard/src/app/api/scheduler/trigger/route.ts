import { NextRequest, NextResponse } from 'next/server';
import { getScheduler } from '@/services/scheduler';

export async function POST(request: NextRequest) {
  try {
    const { name } = await request.json() as { name: string };
    if (!name) {
      return NextResponse.json({ error: 'Job name is required' }, { status: 400 });
    }

    const scheduler = getScheduler();
    await scheduler.triggerManually(name);

    return NextResponse.json({ message: `Job "${name}" triggered successfully` });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
