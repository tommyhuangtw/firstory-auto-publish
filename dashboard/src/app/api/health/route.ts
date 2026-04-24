import { NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET() {
  try {
    const db = getDb();
    const tableCount = db
      .prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table'")
      .get() as { count: number };

    return NextResponse.json({
      status: 'ok',
      db: 'connected',
      tables: tableCount.count,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { status: 'error', db: 'disconnected', error: (error as Error).message },
      { status: 500 }
    );
  }
}
