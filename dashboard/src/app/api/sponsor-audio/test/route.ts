import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs-extra';
import {
  buildChunks,
  synthesizeChunk,
  concatMp3s,
  probeDuration,
  getSponsorAudioConfig,
} from '@/services/pipeline/nodes/tts';

const OUTPUT_DIR = path.join(process.cwd(), '..', 'temp', 'tts');

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { scriptText, speed } = body as { scriptText?: string; speed?: number };

  if (!scriptText?.trim()) {
    return NextResponse.json({ error: 'scriptText is required' }, { status: 400 });
  }

  const apiKey = process.env.VOAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'VOAI_API_KEY not configured' }, { status: 500 });
  }

  await fs.ensureDir(OUTPUT_DIR);
  const now = new Date();
  const ts = `${now.toISOString().slice(0, 10)}_${now.toTimeString().slice(0, 5).replace(':', '')}`;
  const outPath = path.join(OUTPUT_DIR, `sponsor_test_${ts}_${Date.now()}.mp3`);

  const text = scriptText
    .replace(/`/g, '')
    .replace(/(\\\n)+/g, ' ')
    .replace(/(\n)+/g, ' ')
    .replace(/(\\\t)+/g, ' ')
    .replace(/(\t)+/g, ' ')
    .trim();

  const baseConfig = getSponsorAudioConfig();
  const audioConfig = speed != null
    ? { ...baseConfig, speed }
    : baseConfig;

  const chunks = buildChunks(text);

  if (chunks.length === 1) {
    await synthesizeChunk(chunks[0], outPath, apiKey, audioConfig);
  } else {
    const chunkDir = path.join(OUTPUT_DIR, `.sponsor_chunks_${Date.now()}`);
    await fs.ensureDir(chunkDir);
    try {
      const chunkPaths: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunkPath = path.join(chunkDir, `chunk_${String(i).padStart(3, '0')}.mp3`);
        await synthesizeChunk(chunks[i], chunkPath, apiKey, audioConfig);
        chunkPaths.push(chunkPath);
        if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 3000));
      }
      await concatMp3s(chunkPaths, outPath);
    } finally {
      await fs.remove(chunkDir).catch(() => {});
    }
  }

  const durationSec = await probeDuration(outPath);

  return NextResponse.json({ audioPath: outPath, durationSec });
}
