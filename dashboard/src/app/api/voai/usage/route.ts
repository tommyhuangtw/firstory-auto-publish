import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const apiKey = process.env.VOAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'VOAI_API_KEY not configured' }, { status: 500 });
  }

  try {
    const res = await fetch('https://connect.voai.ai/Key/Usage', {
      headers: {
        'x-api-key': apiKey,
        'x-output-format': 'wav',
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json({ error: `VoAI ${res.status}: ${text}` }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
