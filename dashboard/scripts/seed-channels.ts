import { config } from 'dotenv';
import path from 'path';
config({ path: path.join(process.cwd(), '.env.local') });
import { seedDefaultChannels } from '../src/services/inspiration/channelCrawler';
import { getDb } from '../src/db';

(async () => {
  const added = await seedDefaultChannels();
  const rows = getDb().prepare('SELECT handle, title, channel_id FROM channels ORDER BY id').all();
  console.log(`seeded (newly added: ${added}). channels now:`);
  rows.forEach((r: any) => console.log(' ', r.handle, '→', r.title));
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
