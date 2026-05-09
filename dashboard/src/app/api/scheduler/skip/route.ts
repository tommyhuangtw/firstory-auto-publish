import { NextRequest, NextResponse } from 'next/server';
import { getScheduler } from '@/services/scheduler';

export async function POST(request: NextRequest) {
  try {
    const { name, action } = await request.json() as {
      name: string;
      action: 'skip' | 'unskip' | 'enable' | 'disable' | 'pause' | 'resume';
    };
    if (!name) {
      return NextResponse.json({ error: 'Job name is required' }, { status: 400 });
    }

    const scheduler = getScheduler();
    const messages: Record<string, () => string> = {
      skip: () => { scheduler.skipNext(name); return `"${name}" 已設定跳過下一集`; },
      unskip: () => { scheduler.unskip(name); return `"${name}" 已取消跳過`; },
      enable: () => { scheduler.enable(name); return `"${name}" 已啟用`; },
      disable: () => { scheduler.disable(name); return `"${name}" 已停用`; },
      pause: () => { scheduler.pause(name); return `"${name}" 已暫停`; },
      resume: () => { scheduler.resume(name); return `"${name}" 已恢復`; },
    };

    const handler = messages[action];
    if (!handler) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    return NextResponse.json({ message: handler() });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
