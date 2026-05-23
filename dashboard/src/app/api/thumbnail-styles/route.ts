import { NextResponse } from 'next/server';
import { getAllStyles } from '@/services/thumbnailStyles';

export async function GET() {
  try {
    const styles = getAllStyles();
    return NextResponse.json({ styles });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
