/**
 * Backfill memory data (tools, digests, themes) for episodes missing memory records.
 *
 * Reads English scripts and extracted tools from pipeline_snapshots,
 * then calls the memory services to populate the DB.
 *
 * Usage: npx tsx scripts/backfill-memory.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { getDb } from '../src/db';
import { upsertTools } from '../src/services/memory/memoryService';
import { generateEpisodeDigest, extractAndUpsertThemes } from '../src/services/memory/digestService';
import type { ResolvedTool } from '../src/services/memory/toolExtractor';

interface EpisodeRow {
  id: number;
  episode_number: number | null;
  segment_type: string;
  status: string;
  created_at: string;
}

interface SnapshotRow {
  output_data: string;
}

async function main() {
  const db = getDb();

  // Find all episodes that completed extractTools in the pipeline
  const episodes = db.prepare(`
    SELECT DISTINCT e.id, e.episode_number, e.segment_type, e.status, e.created_at
    FROM episodes e
    JOIN pipeline_runs pr ON pr.episode_id = e.id
    JOIN pipeline_snapshots ps ON ps.pipeline_run_id = pr.id
    WHERE ps.stage = 'extractTools'
      AND pr.status = 'completed'
      AND e.status IN ('published', 'pending_review', 'publishing')
    ORDER BY e.id
  `).all() as EpisodeRow[];

  console.log(`Found ${episodes.length} episodes to process\n`);

  let toolsBackfilled = 0;
  let digestsBackfilled = 0;
  let themesBackfilled = 0;
  let skipped = 0;

  for (const ep of episodes) {
    const label = `EP${ep.episode_number ?? '?'} (id=${ep.id}, ${ep.segment_type})`;
    console.log(`--- Processing ${label} ---`);

    const airedDate = ep.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10);

    // Check if this episode already has tool mentions
    const existingMentions = db.prepare(
      'SELECT COUNT(*) as cnt FROM episode_tool_mentions WHERE episode_id = ?'
    ).get(ep.id) as { cnt: number };

    // Check if this episode already has a digest
    const existingDigest = db.prepare(
      'SELECT COUNT(*) as cnt FROM episode_digests WHERE episode_id = ?'
    ).get(ep.id) as { cnt: number };

    // Step 1: Backfill tool mentions (skip for sysdesign/quickchat)
    const isToolSegment = !['sysdesign', 'quickchat'].includes(ep.segment_type);
    if (isToolSegment && existingMentions.cnt === 0) {
      // Get extracted tools from the latest pipeline snapshot
      const snapshot = db.prepare(`
        SELECT ps.output_data FROM pipeline_snapshots ps
        JOIN pipeline_runs pr ON pr.id = ps.pipeline_run_id
        WHERE pr.episode_id = ? AND ps.stage = 'extractTools' AND pr.status = 'completed'
        ORDER BY ps.id DESC LIMIT 1
      `).get(ep.id) as SnapshotRow | undefined;

      if (snapshot?.output_data) {
        try {
          const data = JSON.parse(snapshot.output_data);
          const tools: ResolvedTool[] = data.extractedTools || [];
          if (tools.length > 0) {
            await upsertTools(ep.id, tools, airedDate);
            console.log(`  Tools: ${tools.length} tools upserted`);
            toolsBackfilled++;
          } else {
            console.log('  Tools: no tools in snapshot');
          }
        } catch (err) {
          console.error(`  Tools: FAILED - ${(err as Error).message}`);
        }
      } else {
        console.log('  Tools: no snapshot found');
      }
    } else if (!isToolSegment) {
      console.log(`  Tools: skipped (${ep.segment_type})`);
    } else {
      console.log(`  Tools: already has ${existingMentions.cnt} mentions`);
      skipped++;
    }

    // Step 2: Backfill episode digest
    if (existingDigest.cnt === 0) {
      // Get English script from scriptEnglish snapshot
      const scriptSnapshot = db.prepare(`
        SELECT ps.output_data FROM pipeline_snapshots ps
        JOIN pipeline_runs pr ON pr.id = ps.pipeline_run_id
        WHERE pr.episode_id = ? AND ps.stage = 'scriptEnglish' AND pr.status = 'completed'
        ORDER BY ps.id DESC LIMIT 1
      `).get(ep.id) as SnapshotRow | undefined;

      if (scriptSnapshot?.output_data) {
        try {
          const data = JSON.parse(scriptSnapshot.output_data);
          const scriptEn: string = data.scriptEn || '';
          if (scriptEn.length >= 100) {
            const digest = await generateEpisodeDigest(ep.id, ep.segment_type, scriptEn, airedDate);
            if (digest) {
              console.log(`  Digest: generated (milestone=${!!digest.is_milestone})`);
              digestsBackfilled++;
            } else {
              console.log('  Digest: LLM returned null');
            }

            // Step 3: Theme extraction (uses same script)
            try {
              await extractAndUpsertThemes(ep.id, scriptEn, airedDate);
              console.log('  Themes: extracted');
              themesBackfilled++;
            } catch (err) {
              console.error(`  Themes: FAILED - ${(err as Error).message}`);
            }
          } else {
            console.log('  Digest/Themes: script too short');
          }
        } catch (err) {
          console.error(`  Digest: FAILED - ${(err as Error).message}`);
        }
      } else {
        console.log('  Digest/Themes: no script snapshot found');
      }
    } else {
      console.log(`  Digest: already exists`);
    }

    console.log();
  }

  console.log('\n=== Summary ===');
  console.log(`Episodes processed: ${episodes.length}`);
  console.log(`Tools backfilled: ${toolsBackfilled}`);
  console.log(`Digests backfilled: ${digestsBackfilled}`);
  console.log(`Themes backfilled: ${themesBackfilled}`);
  console.log(`Skipped (already had data): ${skipped}`);

  // Show final state
  const toolCount = (db.prepare('SELECT COUNT(*) as cnt FROM tools').get() as { cnt: number }).cnt;
  const mentionCount = (db.prepare('SELECT COUNT(*) as cnt FROM episode_tool_mentions').get() as { cnt: number }).cnt;
  const digestCount = (db.prepare('SELECT COUNT(*) as cnt FROM episode_digests').get() as { cnt: number }).cnt;
  const themeCount = (db.prepare('SELECT COUNT(*) as cnt FROM themes').get() as { cnt: number }).cnt;

  console.log(`\nDB state: ${toolCount} tools, ${mentionCount} mentions, ${digestCount} digests, ${themeCount} themes`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
