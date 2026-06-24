import { config } from 'dotenv';
import path from 'path';
config({ path: path.join(process.cwd(), '.env.local') });
import { resolveChannel, listLatestVideos } from '../src/services/inspiration/channelCrawler';

(async () => {
  const c = await resolveChannel('https://www.youtube.com/@AlexHormozi');
  console.log('resolved:', c.handle, c.channelId, c.title);
  const vids = await listLatestVideos(c.uploadsPlaylistId, 5);
  console.log('latest videos:', vids.length);
  vids.forEach((v) => console.log(' ', v.publishedAt?.slice(0, 10), v.videoId, v.title.slice(0, 50)));
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
