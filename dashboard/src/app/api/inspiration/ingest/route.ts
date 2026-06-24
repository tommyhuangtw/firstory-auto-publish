import { NextRequest, NextResponse } from 'next/server';
import { createSourceRow, runIngest } from '@/services/inspiration/pipeline';
import { createChildLogger } from '@/lib/logger';
import type { IngestInput } from '@/services/inspiration/types';

const log = createChildLogger('api:inspiration-ingest');

/** Body: { url?, text?, title?, userPoints? }. Starts ingest in background, returns sourceId. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as IngestInput;
  if (!body.url && !body.text) return NextResponse.json({ error: 'url or text required' }, { status: 400 });
  const sourceId = createSourceRow(body);
  runIngest(sourceId, body).catch((e) => log.error({ sourceId, err: (e as Error).message }, 'background ingest failed'));
  return NextResponse.json({ sourceId, status: 'processing' });
}
