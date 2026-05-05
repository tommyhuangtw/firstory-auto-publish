/**
 * kie.ai Image Generation Service
 *
 * Generates podcast cover images via kie.ai (GPT Image 2).
 * Ported from src/services/kieAi.js
 */

import fs from 'fs-extra';
import path from 'path';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('kieai');

const BASE_URL = 'https://api.kie.ai';
const POLL_INTERVAL = 5000; // 5s
const MAX_WAIT = 180000; // 3 min

interface KieAiResponse {
  code: number;
  message?: string;
  data: {
    taskId?: string;
    state?: string;
    resultJson?: string;
    failMsg?: string;
  };
}

async function request(method: string, endpoint: string, body?: Record<string, unknown>): Promise<KieAiResponse['data']> {
  const apiKey = process.env.KIE_AI_API_KEY;
  if (!apiKey) throw new Error('KIE_AI_API_KEY not set');

  const resp = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data: KieAiResponse = await resp.json();
  if (data.code !== 200) {
    throw new Error(`kie.ai API error: ${data.message || JSON.stringify(data)}`);
  }
  return data.data;
}

/**
 * Create an image generation task and poll until complete.
 * Returns the first result image URL.
 */
export async function generateCoverImage(prompt: string, options: {
  model?: string;
  aspectRatio?: string;
  resolution?: string;
  referenceImages?: string[];
} = {}): Promise<string> {
  const model = options.model || 'gpt-image-2-image-to-image';
  log.info({ model }, 'Creating kie.ai image task');

  const input: Record<string, unknown> = {
    prompt,
    aspect_ratio: options.aspectRatio || '1:1',
    resolution: options.resolution || '2K',
  };

  if (options.referenceImages?.length) {
    input.input_urls = options.referenceImages;
  }

  const result = await request('POST', '/api/v1/jobs/createTask', { model, input });
  const taskId = result.taskId;
  if (!taskId) throw new Error('No taskId returned');

  log.info({ taskId }, 'Task created, polling...');
  return pollTask(taskId);
}

async function pollTask(taskId: string): Promise<string> {
  const start = Date.now();

  while (Date.now() - start < MAX_WAIT) {
    const task = await request('GET', `/api/v1/jobs/recordInfo?taskId=${taskId}`);

    if (task.state === 'success' && task.resultJson) {
      const parsed = JSON.parse(task.resultJson);
      const urls: string[] = parsed.resultUrls || [];
      if (urls.length === 0) throw new Error('No result URLs');
      log.info({ taskId }, 'Image generated');
      return urls[0];
    }

    if (task.state === 'fail') {
      throw new Error(`kie.ai task failed: ${task.failMsg || 'unknown'}`);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }

  throw new Error(`kie.ai task timed out after ${MAX_WAIT / 1000}s`);
}

/**
 * Download image from URL to local path.
 */
export async function downloadImage(imageUrl: string, outputPath: string): Promise<string> {
  const resp = await fetch(imageUrl);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);

  const buffer = Buffer.from(await resp.arrayBuffer());
  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, buffer);

  log.info({ path: outputPath }, 'Image downloaded');
  return outputPath;
}
