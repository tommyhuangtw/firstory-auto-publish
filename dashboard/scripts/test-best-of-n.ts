/**
 * Smoke test: end-to-end best-of-N voice writing + like-predictor scoring.
 * Requires the scoring service running (experiments/like-predictor/score_service.py).
 *
 *   npx tsx scripts/test-best-of-n.ts
 */
import { config } from 'dotenv';
import path from 'path';
config({ path: path.join(process.cwd(), '.env.local') });

import { writeBestOfN } from '@/services/voice/writer';
import { predictorHealthy } from '@/services/voice/predictorClient';

async function main() {
  const healthy = await predictorHealthy();
  console.log('predictor healthy:', healthy);

  const res = await writeBestOfN(
    { mode: 'rewrite', idea: 'AI 接案要怎麼接到第一個願意付錢的客戶', useStories: false, viral: true },
    5,
  );

  console.log('\nscored:', res.scored, '| candidates:', res.candidates.length);
  console.log('='.repeat(70));
  res.candidates.forEach((c, i) => {
    const s = c.score;
    const tag = i === 0 ? ' ★BEST' : '';
    console.log(
      `\n#${i + 1}${tag}  viral=${s ? (s.viralProb * 100).toFixed(1) + '%' : 'n/a'}  ` +
      `rel=${s ? s.relativeScore.toFixed(3) : 'n/a'}  len=${[...c.draft].length}`,
    );
    console.log(c.draft.slice(0, 120).replace(/\n/g, ' ⏎ ') + '…');
  });

  // Verify ranking invariant: candidates sorted by viral_prob desc.
  if (res.scored) {
    const probs = res.candidates.map(c => c.score!.viralProb);
    const sorted = probs.every((p, i) => i === 0 || probs[i - 1] >= p);
    console.log('\n' + '='.repeat(70));
    console.log('ranking sorted desc by viral_prob:', sorted ? 'PASS ✓' : 'FAIL ✗');
    console.log('best viral_prob:', (probs[0] * 100).toFixed(1) + '%',
                '| spread:', ((probs[0] - probs[probs.length - 1]) * 100).toFixed(1) + 'pp');
    if (!sorted) process.exit(1);
  }
  console.log('\nE2E OK');
  process.exit(0);
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
