import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs-extra';

export async function GET() {
  try {
    const publicDir = path.join(process.cwd(), '..', 'remotion', 'public');
    const files = await fs.readdir(publicDir);
    const avatars = files
      .filter(f => f.startsWith('sloth_studio_') && f.endsWith('.png'))
      .sort()
      .map(f => ({
        filename: f,
        label: f
          .replace('sloth_studio_', '')
          .replace('.png', '')
          .replace(/^V\d+-/, ''),
        path: path.join(publicDir, f),
      }));
    return NextResponse.json({ avatars });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
