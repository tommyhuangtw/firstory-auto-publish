import { NextResponse } from 'next/server';

const VOAI_URL = 'https://connect.voai.ai/TTS/generate-dialogue';

export async function POST() {
  const apiKey = process.env.VOAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'VOAI_API_KEY not set' }, { status: 500 });
  }

  const start = Date.now();

  try {
    const res = await fetch(VOAI_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'x-output-format': 'mp3',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        input: {
          dialogue: [
            {
              voai_script_text: '歡迎回到AI懶人報',
              voice: { name: '昱翔', style: '預設', version: 'Neo' },
              audio_config: {
                speed: 1.08,
                pitch_shift: 1.5,
                style_weight: 0.8,
                breath_pause: 0.15,
              },
            },
          ],
        },
      }),
    });

    const latencyMs = Date.now() - start;

    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json({
        ok: false,
        statusCode: res.status,
        error: body,
        latencyMs,
      });
    }

    const contentType = res.headers.get('content-type') || 'unknown';
    return NextResponse.json({
      ok: true,
      latencyMs,
      contentType,
      statusCode: res.status,
    });
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs,
    });
  }
}
