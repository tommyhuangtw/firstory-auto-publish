import { NextResponse } from 'next/server';
import { deriveThemes, tagAllInsights } from '@/services/inspiration/themeService';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:themes-rederive');

export async function POST() {
  (async () => { await deriveThemes(); tagAllInsights(); })()
    .catch((e) => log.error({ err: (e as Error).message }, 'rederive failed'));
  return NextResponse.json({ started: true });
}
