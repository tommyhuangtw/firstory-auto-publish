import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs-extra';

const REMOTION_DIR = path.join(process.cwd(), '..', 'remotion');
const OUTPUT_DIR = path.join(process.cwd(), '..', 'temp', 'thumbnails');

export async function POST(request: NextRequest) {
  try {
    const { hookText, segmentType } = (await request.json()) as {
      hookText: string;
      segmentType: string;
    };

    if (!hookText?.trim()) {
      return NextResponse.json({ error: 'hookText is required' }, { status: 400 });
    }

    const validTypes = ['daily', 'weekly', 'robot', 'sysdesign'];
    const segment = validTypes.includes(segmentType) ? segmentType : 'daily';

    await fs.ensureDir(OUTPUT_DIR);

    const outputFilename = `remotion_${Date.now()}.png`;
    const outputPath = path.join(OUTPUT_DIR, outputFilename);

    // Write props to temp file
    const propsPath = path.join(OUTPUT_DIR, `props_${Date.now()}.json`);
    await fs.writeJSON(propsPath, { hookText: hookText.trim(), segmentType: segment });

    // Render via Remotion CLI
    const cmd = `cd "${REMOTION_DIR}" && npx remotion still src/index.ts YouTubeThumbnail "${outputPath}" --props="${propsPath}"`;
    execSync(cmd, { timeout: 30_000, stdio: 'pipe' });

    // Clean up props file
    await fs.remove(propsPath);

    return NextResponse.json({
      path: outputPath,
      url: `/api/thumbnail-compare/serve?file=${encodeURIComponent(outputFilename)}`,
      method: 'remotion',
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
