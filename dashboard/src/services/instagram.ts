/**
 * Instagram Posting via Facebook Graph API v22.0
 *
 * Posts images with captions to an Instagram Business Account.
 */

import { createChildLogger } from '@/lib/logger';
import { withRetry } from '@/lib/retry';

const log = createChildLogger('instagram');
const GRAPH_API = 'https://graph.facebook.com/v22.0';

/**
 * Post an image to Instagram.
 * @param imageUrl - Public URL of the image (must be accessible by Facebook servers)
 * @param caption - Post caption text
 * @returns Instagram post ID
 */
export async function postToInstagram(imageUrl: string, caption: string): Promise<string> {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
  if (!accessToken || !accountId) throw new Error('INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_ACCOUNT_ID required');

  // Step 1: Create media container
  log.info('Creating media container');
  const containerResp = await withRetry(
    async () => {
      const r = await fetch(`${GRAPH_API}/${accountId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: imageUrl,
          caption,
          access_token: accessToken,
        }),
      });
      if (!r.ok) {
        const err = await r.text();
        throw new Error(`IG container creation failed: ${r.status} ${err}`);
      }
      return r;
    },
    { label: 'ig-container' },
  );

  const container = await containerResp.json();
  const containerId = container.id;
  log.info({ containerId }, 'Media container created');

  // Wait for processing (IG needs time to process the image)
  await new Promise((r) => setTimeout(r, 5000));

  // Step 2: Publish
  const publishResp = await withRetry(
    async () => {
      const r = await fetch(`${GRAPH_API}/${accountId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: containerId,
          access_token: accessToken,
        }),
      });
      if (!r.ok) {
        const err = await r.text();
        throw new Error(`IG publish failed: ${r.status} ${err}`);
      }
      return r;
    },
    { label: 'ig-publish' },
  );

  const published = await publishResp.json();
  log.info({ postId: published.id }, 'Posted to Instagram');
  return published.id;
}

/**
 * Post a Reel (video) to Instagram.
 * @param videoUrl - Public URL of the video (must be accessible by Facebook servers)
 * @param caption - Post caption text
 * @param coverUrl - Optional public URL of cover/thumbnail image
 * @returns Instagram post ID
 */
export async function postReelToInstagram(videoUrl: string, caption: string, coverUrl?: string): Promise<string> {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
  if (!accessToken || !accountId) throw new Error('INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_ACCOUNT_ID required');

  // Step 1: Create REELS media container
  log.info('Creating Reels media container');
  const containerResp = await withRetry(
    async () => {
      const r = await fetch(`${GRAPH_API}/${accountId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_type: 'REELS',
          video_url: videoUrl,
          caption,
          ...(coverUrl ? { cover_url: coverUrl } : {}),
          access_token: accessToken,
        }),
      });
      if (!r.ok) {
        const err = await r.text();
        throw new Error(`IG Reels container creation failed: ${r.status} ${err}`);
      }
      return r;
    },
    { label: 'ig-reels-container' },
  );

  const container = await containerResp.json();
  const containerId = container.id;
  log.info({ containerId }, 'Reels container created');

  // Step 2: Poll for video processing (videos take longer than images)
  await pollContainerStatus(containerId, accessToken);

  // Step 3: Publish
  const publishResp = await withRetry(
    async () => {
      const r = await fetch(`${GRAPH_API}/${accountId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: containerId,
          access_token: accessToken,
        }),
      });
      if (!r.ok) {
        const err = await r.text();
        throw new Error(`IG Reels publish failed: ${r.status} ${err}`);
      }
      return r;
    },
    { label: 'ig-reels-publish' },
  );

  const published = await publishResp.json();
  log.info({ postId: published.id }, 'Reel posted to Instagram');
  return published.id;
}

/**
 * Poll IG container status until FINISHED (video processing can take 30-120s).
 */
async function pollContainerStatus(containerId: string, accessToken: string, maxWaitMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const r = await fetch(
      `${GRAPH_API}/${containerId}?fields=status_code&access_token=${accessToken}`
    );
    const data = await r.json();
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR') {
      throw new Error(`IG video processing failed: ${JSON.stringify(data)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error('IG video processing timed out');
}
