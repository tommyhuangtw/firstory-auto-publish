/**
 * Cloudinary CDN — unsigned image upload.
 *
 * Used to get a public URL for Instagram posting.
 */

import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('cloudinary');

/**
 * Upload an image (from local path or URL) to Cloudinary.
 * Returns the public secure_url.
 */
export async function uploadToCloudinary(source: string | Buffer, filename?: string): Promise<string> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const preset = process.env.CLOUDINARY_UPLOAD_PRESET;
  if (!cloudName || !preset) throw new Error('CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET required');

  const form = new FormData();
  form.append('upload_preset', preset);

  if (typeof source === 'string' && source.startsWith('http')) {
    form.append('file', source);
  } else {
    const raw = typeof source === 'string'
      ? await import('fs-extra').then((fs) => fs.readFile(source))
      : source;
    const blob = new Blob([new Uint8Array(raw)]);
    form.append('file', blob, filename || 'image.png');
  }

  const resp = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: form,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Cloudinary upload failed: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  log.info({ url: data.secure_url }, 'Uploaded to Cloudinary');
  return data.secure_url;
}
