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
