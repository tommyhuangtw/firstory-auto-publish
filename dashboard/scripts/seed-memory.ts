/**
 * One-time script: Seed tool memory from latest Airtable episodes.
 *
 * Usage: npx tsx scripts/seed-memory.ts
 *
 * Reads podcast scripts from /tmp/airtable_scripts.json (fetched separately),
 * runs tool extraction + upsert for each episode to build baseline memory.
 */

import fs from 'fs';
import { extractToolsFromScript } from '@/services/memory/toolExtractor';
import { upsertTools } from '@/services/memory/memoryService';
import { closeDb } from '@/db';

interface AirtableRecord {
  index: number;
  date: string;
  scriptLength: number;
  script: string;
}

async function main() {
  const raw = fs.readFileSync('/tmp/airtable_scripts.json', 'utf-8');
  const records: AirtableRecord[] = JSON.parse(raw);

  console.log(`Found ${records.length} episodes to process\n`);

  // Process oldest first so memory builds chronologically
  const sorted = [...records].reverse();

  for (const record of sorted) {
    const episodeNumber = 87 - record.index;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`EP${episodeNumber} | ${record.date} | ${record.scriptLength} chars`);
    console.log(`${'='.repeat(60)}`);

    try {
      const tools = await extractToolsFromScript(record.script, episodeNumber);

      if (tools.length === 0) {
        console.log('  → No tools extracted');
        continue;
      }

      console.log(`  → Extracted ${tools.length} tools:`);
      for (const tool of tools) {
        console.log(`    - ${tool.canonicalName} (${tool.category}) [${tool.mentionType}] sig=${tool.significanceScore.toFixed(2)}`);
        if (tool.versionDetail) console.log(`      version: ${tool.versionDetail}`);
        console.log(`      context: ${tool.contextSnippet.slice(0, 100)}...`);
      }

      await upsertTools(episodeNumber, tools);
      console.log(`  → Upserted ${tools.length} tools to DB`);
    } catch (error) {
      console.error(`  ✗ Error processing EP${episodeNumber}:`, (error as Error).message);
    }
  }

  closeDb();
  console.log('\n✓ Memory seeding complete');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
