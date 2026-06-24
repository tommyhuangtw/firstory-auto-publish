import { config } from 'dotenv';
import path from 'path';
config({ path: path.join(process.cwd(), '.env.local') });
import { getDb } from '../src/db';
import { deriveThemes, tagAllInsights } from '../src/services/inspiration/themeService';

(async () => {
  const n = await deriveThemes();
  console.log('themes derived:', n);
  const { tagged } = tagAllInsights();
  console.log('insights tagged:', tagged);
  const rows = getDb().prepare('SELECT name, insight_count FROM inspiration_themes ORDER BY insight_count DESC').all();
  rows.forEach((r: any) => console.log(`  ${String(r.insight_count).padStart(4)}  ${r.name}`));
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
