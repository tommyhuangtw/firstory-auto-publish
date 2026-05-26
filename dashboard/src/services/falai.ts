/**
 * fal.ai Image Generation Service
 *
 * Backup provider for image generation via fal.ai (GPT Image 2).
 * API docs: https://fal.ai/models/openai/gpt-image-2/api
 */

import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('falai');

const T2I_URL = 'https://fal.run/openai/gpt-image-2';
const I2I_URL = 'https://fal.run/openai/gpt-image-2/edit';

interface FalImageResponse {
  images: Array<{
    url: string;
    content_type: string;
    file_name: string;
    width: number;
    height: number;
  }>;
}

function mapImageSize(aspectRatio?: string): string | { width: number; height: number } {
  switch (aspectRatio) {
    case '1:1':
      return 'square_hd';
    case '16:9':
      return { width: 1920, height: 1080 };
    case '4:3':
      return 'landscape_4_3';
    case '9:16':
      return { width: 1080, height: 1920 };
    default:
      return 'square_hd';
  }
}

function mapQuality(resolution?: string): string {
  // kie.ai uses '1K', '2K' etc. Map to fal.ai quality tiers.
  switch (resolution) {
    case '2K':
    case '4K':
      return 'high';
    case '1K':
      return 'high';
    default:
      return 'high';
  }
}

/**
 * Generate an image via fal.ai GPT Image 2.
 * Accepts the same options interface as kieai.generateCoverImage.
 */
export async function generateCoverImage(prompt: string, options: {
  model?: string;
  aspectRatio?: string;
  resolution?: string;
  referenceImages?: string[];
} = {}): Promise<string> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) throw new Error('FAL_KEY not set');

  const isI2I = options.model?.includes('image-to-image') && options.referenceImages?.length;
  const url = isI2I ? I2I_URL : T2I_URL;
  const imageSize = mapImageSize(options.aspectRatio);
  const quality = mapQuality(options.resolution);

  const body: Record<string, unknown> = {
    prompt,
    image_size: imageSize,
    quality,
    num_images: 1,
    output_format: 'png',
  };

  if (isI2I && options.referenceImages?.length) {
    body.image_urls = options.referenceImages;
  }

  log.info({ endpoint: isI2I ? 'edit' : 't2i', aspectRatio: options.aspectRatio }, 'Calling fal.ai');

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`fal.ai API error (${resp.status}): ${text}`);
  }

  const data: FalImageResponse = await resp.json();
  if (!data.images?.length || !data.images[0].url) {
    throw new Error('fal.ai returned no images');
  }

  log.info('Image generated via fal.ai');
  return data.images[0].url;
}
