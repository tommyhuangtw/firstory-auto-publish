/**
 * Unified Image Generation Service
 *
 * Tries kie.ai first, falls back to fal.ai if kie.ai fails or is unavailable.
 * Re-exports downloadImage (provider-agnostic URL downloader).
 */

import * as kieai from '@/services/kieai';
import * as falai from '@/services/falai';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('imageService');

export type ImageProvider = 'kieai' | 'falai';

export interface GenerateImageResult {
  url: string;
  provider: ImageProvider;
}

export interface GenerateImageOptions {
  model?: string;
  aspectRatio?: string;
  resolution?: string;
  referenceImages?: string[];
}

/**
 * Generate an image with automatic fallback.
 * Tries kie.ai first (if KIE_AI_API_KEY is set), then fal.ai (if FAL_KEY is set).
 */
export async function generateCoverImage(
  prompt: string,
  options: GenerateImageOptions = {},
): Promise<GenerateImageResult> {
  const hasKieai = !!process.env.KIE_AI_API_KEY;
  const hasFalai = !!process.env.FAL_KEY;

  if (!hasKieai && !hasFalai) {
    throw new Error('No image generation service available (set KIE_AI_API_KEY or FAL_KEY)');
  }

  // Try kie.ai first
  if (hasKieai) {
    try {
      const url = await kieai.generateCoverImage(prompt, options);
      return { url, provider: 'kieai' };
    } catch (err) {
      const msg = (err as Error).message;
      log.warn({ error: msg }, 'kie.ai failed');
      if (!hasFalai) {
        throw err; // No fallback available
      }
      log.info('Falling back to fal.ai');
    }
  }

  // Fallback to fal.ai
  const url = await falai.generateCoverImage(prompt, options);
  return { url, provider: 'falai' };
}

// Re-export downloadImage — it's provider-agnostic (just downloads a URL to disk)
export { downloadImage } from '@/services/kieai';
