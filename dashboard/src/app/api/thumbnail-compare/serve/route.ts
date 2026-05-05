import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs-extra';

const OUTPUT_DIR = path.join(process.cwd(), '..', 'temp', 'thumbnails');

export async function GET(request: NextRequest) {
  const file = request.nextUrl.searchParams.get('file');
  if (!file) {
    return NextResponse.json({ error: 'file parameter required' }, { status: 400 });
  }

  // Sanitize filename to prevent path traversal
  const basename = path.basename(file);
  const filePath = path.join(OUTPUT_DIR, basename);

  if (!(await fs.pathExists(filePath))) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const buffer = await fs.readFile(filePath);
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-cache',
    },
  });
}
