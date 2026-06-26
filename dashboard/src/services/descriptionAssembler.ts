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

/**
 * Resolve the ad text for an episode's description.
 *
 * Priority:
 *  1. If the episode has a sponsor selected at review (`sponsor_audio_id`), use
 *     that sponsor's linked ad_preset content (even if empty — an explicit choice).
 *  2. Otherwise fall back to the globally active ad_preset, which covers
 *     description-only ads (no口播 audio, but still want ad text in the description).
 */
export function getActiveAdContent(episodeId?: number): string {
  const db = getDb();

  if (episodeId != null) {
    const linked = db.prepare(`
      SELECT a.content
      FROM episodes e
      JOIN sponsor_audio_presets s ON e.sponsor_audio_id = s.id
      JOIN ad_presets a ON s.ad_preset_id = a.id
      WHERE e.id = ? AND e.sponsor_audio_id IS NOT NULL
    `).get(episodeId) as { content: string } | undefined;
    if (linked) return linked.content || '';
  }

  const row = db.prepare('SELECT content FROM ad_presets WHERE is_active = 1 LIMIT 1').get() as { content: string } | undefined;
  return row?.content || '';
}

export function assembleYoutubeDescription(
  mainDescription: string,
  tags: string[],
  episodeId?: number,
): string {
  const adContent = getActiveAdContent(episodeId);
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
  episodeId?: number,
): string {
  const adContent = getActiveAdContent(episodeId);
  const footer = getSetting('podcast_footer');

  const parts: string[] = [];

  if (adContent.trim()) parts.push(adContent.trim());
  parts.push(mainDescription.trim());
  if (footer.trim()) parts.push(footer.trim());

  return parts.join('\n\n');
}
