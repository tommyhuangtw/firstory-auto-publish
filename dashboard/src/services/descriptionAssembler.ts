/**
 * Assembles final descriptions for YouTube and Podcast from parts:
 *   ad content (from active ad_preset) + main description + footer + hashtags
 */

import { getDb } from '@/db';

export function getSetting(key: string): string {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value || '';
}

function getActiveAdContent(): string {
  const db = getDb();
  const row = db.prepare('SELECT content FROM ad_presets WHERE is_active = 1 LIMIT 1').get() as { content: string } | undefined;
  return row?.content || '';
}

export function assembleYoutubeDescription(
  mainDescription: string,
  tags: string[],
): string {
  const adContent = getActiveAdContent();
  const footer = getSetting('youtube_footer');

  const hashtags = (tags || [])
    .slice(0, 15)
    .map(t => '#' + t.replace(/\s+/g, ''))
    .join(' ');

  const parts: string[] = [];

  if (adContent.trim()) parts.push(adContent.trim());
  parts.push(mainDescription.trim());
  if (footer.trim()) parts.push(footer.trim());
  if (hashtags) parts.push(hashtags);

  return parts.join('\n\n');
}

export function assemblePodcastDescription(
  mainDescription: string,
): string {
  const adContent = getActiveAdContent();
  const footer = getSetting('podcast_footer');

  const parts: string[] = [];

  if (adContent.trim()) parts.push(adContent.trim());
  parts.push(mainDescription.trim());
  if (footer.trim()) parts.push(footer.trim());

  return parts.join('\n\n');
}
