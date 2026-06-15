import { NextResponse } from 'next/server';
import { getCurrentVersions, refreshVersionsViaWeb } from '@/services/modelVersionRegistry';

/** GET — return the maintained current-versions reference list. */
export async function GET() {
  return NextResponse.json({ versions: getCurrentVersions() });
}

/** POST — refresh the reference list from the web (OpenRouter web-search model). */
export async function POST() {
  try {
    const result = await refreshVersionsViaWeb();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
