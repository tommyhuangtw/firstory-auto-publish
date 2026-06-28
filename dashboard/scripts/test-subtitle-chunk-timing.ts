/**
 * Test: subtitle timing derived from TTS chunk durations (Approach A).
 *
 * This is the prevention test for the recurring "後半段字幕跟聲音脫鉤" bug.
 * Root cause was Whisper intermittently returning segments for only part of long
 * audio; alignment then crammed the back half out of sync. Approach A derives
 * timing from the TTS chunks we already synthesize, so there is no transcription
 * and no accumulating drift — every chunk boundary is exact.
 *
 * Run: npx tsx scripts/test-subtitle-chunk-timing.ts
 */

import {
  buildSubtitlesFromChunks,
  parseSRT,
  srtCoverage,
  generateSRT,
  type ChunkTiming,
} from '../src/services/subtitleGenerator';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

// ── 1. Synthetic chunks: timeline must be monotonic, non-overlapping, full-coverage ──
console.log('\n[1] Synthetic chunk timeline');
{
  // 5 chunks, each ~12s, covering 0..60s — mimics a real episode's chunk manifest
  const chunks: ChunkTiming[] = [
    { text: '歡迎收聽AI懶人報。今天要聊三個工具。', startSec: 0, endSec: 12 },
    { text: '第一個是Cursor，它把寫程式變得很快。', startSec: 12, endSec: 24.5 },
    { text: '第二個是Claude，拿來debug超好用。', startSec: 24.5, endSec: 37 },
    { text: '第三個工具我自己每天都在用，真心推薦。', startSec: 37, endSec: 49 },
    { text: '好啦今天就到這，我是湯懶懶，我們明天見，掰掰！', startSec: 49, endSec: 61.3 },
  ];

  const { srtContent, cues } = buildSubtitlesFromChunks(chunks);
  const parsed = parseSRT(srtContent);

  check('produces cues', cues.length > 0, `got ${cues.length}`);
  check('SRT round-trips', parsed.length === cues.length, `${parsed.length} vs ${cues.length}`);

  // Monotonic, non-overlapping
  let monotonic = true;
  for (let i = 1; i < cues.length; i++) {
    if (cues[i].startTime < cues[i - 1].startTime - 0.001) monotonic = false;
    if (cues[i].startTime < cues[i - 1].endTime - 0.5) monotonic = false; // small tolerance
  }
  check('cues are monotonic & non-overlapping', monotonic);

  // The whole timeline stays within the audio span (no cue past the last chunk end)
  const lastEnd = cues[cues.length - 1].endTime;
  check('last cue end ≈ last chunk end (no drift past audio)',
    Math.abs(lastEnd - 61.3) <= 1.0, `lastEnd=${lastEnd.toFixed(2)} expected≈61.3`);

  // Coverage: subtitles must span essentially the full audio (the bug = coverage ~70%)
  const audioDur = 61.3;
  const coverage = lastEnd / audioDur;
  check('coverage ≥ 95% (regression guard for truncation bug)',
    coverage >= 0.95, `coverage=${(coverage * 100).toFixed(1)}%`);

  // First cue starts at/near 0
  check('first cue starts at ~0', cues[0].startTime <= 0.5, `start=${cues[0].startTime}`);
}

// ── 2. The exact failure shape we saw in prod must NOT be possible here ──
//    EP352/EP345 had subtitles ending at ~70% of audio. With chunk timing, the
//    last cue is pinned to the last chunk's measured end, so coverage is ~100%
//    by construction regardless of how many chunks there are.
console.log('\n[2] Long episode (100 chunks) keeps full coverage');
{
  const N = 100;
  const perChunk = 9.4; // seconds
  const chunks: ChunkTiming[] = Array.from({ length: N }, (_, i) => ({
    text: `這是第${i + 1}段內容，講一個重點，然後再補一句說明。`,
    startSec: i * perChunk,
    endSec: (i + 1) * perChunk,
  }));
  const audioDur = N * perChunk; // 940s

  const { cues } = buildSubtitlesFromChunks(chunks);
  const lastEnd = cues[cues.length - 1].endTime;
  const coverage = lastEnd / audioDur;
  check('100-chunk coverage ≥ 99%', coverage >= 0.99,
    `coverage=${(coverage * 100).toFixed(1)}% lastEnd=${lastEnd.toFixed(1)} audio=${audioDur}`);

  // No cue may start after the audio ends
  const overflow = cues.filter(c => c.startTime > audioDur + 0.5);
  check('no cue starts past audio end', overflow.length === 0, `overflow=${overflow.length}`);
}

// ── 3. Degenerate input ──
console.log('\n[3] Edge cases');
{
  const single: ChunkTiming[] = [{ text: '只有一句話。', startSec: 0, endSec: 3 }];
  const { cues } = buildSubtitlesFromChunks(single);
  check('single chunk yields ≥1 cue', cues.length >= 1);
  check('single chunk end ≈ 3s', Math.abs(cues[cues.length - 1].endTime - 3) <= 0.5);

  const empty = buildSubtitlesFromChunks([]);
  check('empty input yields empty SRT', empty.cues.length === 0 && empty.srtContent.trim() === '');
}

// ── 4. Coverage gate threshold (the pre-publish guard) ──
//    Reproduces the exact prod failure shape: subtitles ending at ~70% of audio
//    must be flagged (< 0.95); subtitles spanning the full audio must pass.
console.log('\n[4] srtCoverage gate threshold');
{
  const audioDur = 1242; // EP352 real audio length (20:42)

  // Truncated like the Whisper bug — last cue ends at 14:38 (878s ≈ 70%)
  const truncated = generateSRT([
    { index: 1, startTime: 0, endTime: 4, lines: ['開頭'] },
    { index: 2, startTime: 870, endTime: 878, lines: ['被擠到這就斷了'] },
  ]);
  const covBad = srtCoverage(truncated, audioDur);
  check('truncated SRT (70%) is flagged (< 0.95)', covBad < 0.95, `coverage=${(covBad * 100).toFixed(1)}%`);

  // Healthy — last cue reaches the end of the audio
  const healthy = generateSRT([
    { index: 1, startTime: 0, endTime: 4, lines: ['開頭'] },
    { index: 2, startTime: 1235, endTime: 1241, lines: ['我們明天見掰掰'] },
  ]);
  const covOk = srtCoverage(healthy, audioDur);
  check('full-coverage SRT passes (≥ 0.95)', covOk >= 0.95, `coverage=${(covOk * 100).toFixed(1)}%`);

  check('zero audio duration is treated as no-signal (0)', srtCoverage(healthy, 0) === 0);
}

console.log('');
if (failures > 0) {
  console.error(`❌ ${failures} check(s) failed`);
  process.exit(1);
} else {
  console.log('✅ All chunk-timing subtitle checks passed');
}
