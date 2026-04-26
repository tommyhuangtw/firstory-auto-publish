import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const ALLOWED_DIRS = [
  path.resolve(process.cwd(), '..', 'output'),
  path.resolve(process.cwd(), '..', 'temp'),
  path.resolve(process.cwd(), 'data'),
];

const ALLOWED_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.png', '.jpg', '.jpeg', '.webp'];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: pathSegments } = await params;
  const filePath = path.resolve('/', ...pathSegments);

  // Security: only allow files from allowed directories
  const isAllowed = ALLOWED_DIRS.some((dir) => filePath.startsWith(dir));
  if (!isAllowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Security: only allow audio/image file extensions
  const ext = path.extname(filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 400 });
  }

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const MIME_TYPES: Record<string, string> = {
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
    '.aac': 'audio/aac', '.ogg': 'audio/ogg',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  };
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

  const range = request.headers.get('range');

  if (range) {
    // Range request (required for mobile Safari <audio>)
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    const stream = fs.createReadStream(filePath, { start, end });
    const readable = new ReadableStream({
      start(controller) {
        let closed = false;
        stream.on('data', (chunk) => { if (!closed) controller.enqueue(chunk); });
        stream.on('end', () => { if (!closed) { closed = true; controller.close(); } });
        stream.on('error', (err) => { if (!closed) { closed = true; controller.error(err); } });
        stream.once('close', () => { closed = true; });
      },
      cancel() {
        stream.destroy();
      },
    });

    return new Response(readable, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkSize),
        'Content-Type': mimeType,
      },
    });
  }

  // Full file response
  const stream = fs.createReadStream(filePath);
  const readable = new ReadableStream({
    start(controller) {
      let closed = false;
      stream.on('data', (chunk) => { if (!closed) controller.enqueue(chunk); });
      stream.on('end', () => { if (!closed) { closed = true; controller.close(); } });
      stream.on('error', (err) => { if (!closed) { closed = true; controller.error(err); } });
      stream.once('close', () => { closed = true; });
    },
    cancel() {
      stream.destroy();
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Length': String(fileSize),
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
    },
  });
}
