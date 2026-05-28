import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const RESEARCH_DIR = path.join(process.cwd(), 'data', 'research');

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  // Sanitize: only allow alphanumeric, hyphens, underscores, dots
  if (!/^[\w\-.]+\.md$/.test(filename)) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
  }

  const filePath = path.join(RESEARCH_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const markdown = fs.readFileSync(filePath, 'utf-8');

  return new NextResponse(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `inline; filename="${filename}"`,
    },
  });
}
