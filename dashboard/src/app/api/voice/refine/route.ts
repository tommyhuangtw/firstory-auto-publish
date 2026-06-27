import { NextRequest, NextResponse } from 'next/server';
import { refineDraft, type RefineOp } from '@/services/voice/writer';

const OPS: RefineOp[] = ['short', 'medium', 'long', 'smooth'];

/**
 * Rewrite an existing draft in place: adjust length (short/medium/long) or smooth
 * the wording (smooth). Drives the 短/中/長 + 更通順自然 buttons on /write.
 */
export async function POST(req: NextRequest) {
  const body = await req.json() as { draft?: string; op?: string };
  const draft = typeof body.draft === 'string' ? body.draft : '';
  const op = body.op as RefineOp;

  if (!draft.trim()) {
    return NextResponse.json({ error: '沒有可改寫的草稿' }, { status: 400 });
  }
  if (!OPS.includes(op)) {
    return NextResponse.json({ error: '無效的改寫類型' }, { status: 400 });
  }

  try {
    const refined = await refineDraft(draft, op);
    return NextResponse.json({ draft: refined });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
