import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { detectModelVersions, detectUngroundedVersions } from '@/services/llm/versionGuard';
import { verifyVersionClaims } from '@/services/modelVersionRegistry';

/**
 * On-demand version verification for an episode (powers the review-page "重新用網路驗證" button).
 * Detects model-version mentions in the title + description, web-verifies them, stores the
 * result to episodes.version_check, and returns it.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const episodeId = parseInt(id);
    if (isNaN(episodeId)) {
      return NextResponse.json({ error: 'Invalid episode id' }, { status: 400 });
    }

    const db = getDb();
    const ep = db.prepare(
      'SELECT selected_title, candidate_titles, description, script_summary, script_zh FROM episodes WHERE id = ?',
    ).get(episodeId) as
      | { selected_title: string | null; candidate_titles: string | null; description: string | null; script_summary: string | null; script_zh: string | null }
      | undefined;
    if (!ep) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    const candidateTitles: string[] = ep.candidate_titles ? JSON.parse(ep.candidate_titles) : [];
    const userFacing = [ep.selected_title, ...candidateTitles, ep.description].filter(Boolean).join('\n');
    const source = `${ep.script_summary || ''}\n${ep.script_zh || ''}`;

    const detected = detectModelVersions(userFacing);
    const ungrounded = detectUngroundedVersions(userFacing, source);

    let verdicts: { claim: string; isOutdated: boolean; current: string; note: string }[] = [];
    let model: string | null = null;
    if (detected.length > 0) {
      const r = await verifyVersionClaims(detected, ep.script_summary || undefined);
      verdicts = r.verdicts;
      model = r.model;
    }

    const payload = { detected, ungrounded, verdicts, checkedAt: new Date().toISOString(), model };
    db.prepare('UPDATE episodes SET version_check = ? WHERE id = ?').run(JSON.stringify(payload), episodeId);

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
