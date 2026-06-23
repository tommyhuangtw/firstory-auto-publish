/**
 * Smoke test: generate a Substack draft for the most recent episode that has a
 * Chinese script, then read it back. Run: npx tsx scripts/test-substack-draft.ts
 */
import { getDb } from '../src/db';
import { generateDraftForEpisode, getDraftByEpisode } from '../src/services/substackDraftService';

async function main() {
  const db = getDb();
  const ep = db
    .prepare(
      "SELECT id, episode_number FROM episodes WHERE script_zh IS NOT NULL AND script_zh != '' ORDER BY id DESC LIMIT 1",
    )
    .get() as { id: number; episode_number: number | null } | undefined;
  if (!ep) {
    console.error('No episode with a Chinese script found. Seed an episode first.');
    process.exit(1);
  }

  console.log(`Generating Substack draft for episode ${ep.id} (EP${ep.episode_number})...`);
  const draft = await generateDraftForEpisode(ep.id);

  console.log('\n=== SEO TITLE ===\n' + draft.seoTitle);
  console.log('\n=== DECK ===\n' + draft.deck);
  console.log('\n=== SEO DESCRIPTION ===\n' + draft.seoDescription);
  console.log('\n=== BODY (first 600 chars) ===\n' + draft.bodyMarkdown.slice(0, 600));
  console.log(`\n=== BODY LENGTH: ${draft.bodyMarkdown.length} chars ===`);

  const readBack = getDraftByEpisode(ep.id);
  console.log('\nRead-back id matches:', readBack?.id === draft.id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
