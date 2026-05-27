#!/usr/bin/env npx tsx
/**
 * Smoke test for SoundOn analytics scraper.
 * Usage: npx tsx scripts/test-soundon-scraper.ts
 *
 * Runs the full scrape → import flow and prints results.
 * Set PLAYWRIGHT_HEADLESS=false to watch the browser.
 */

import 'dotenv/config';
import path from 'path';
import { config } from 'dotenv';

// Load .env.local
config({ path: path.resolve(__dirname, '../.env.local') });

async function main() {
  console.log('🦥 SoundOn Analytics Scraper — Smoke Test\n');

  // Verify credentials
  if (!process.env.SOUNDON_EMAIL || !process.env.SOUNDON_PASSWORD) {
    console.error('❌ Missing SOUNDON_EMAIL or SOUNDON_PASSWORD in .env.local');
    process.exit(1);
  }
  console.log(`✓ Credentials loaded (${process.env.SOUNDON_EMAIL})\n`);

  const startTime = Date.now();

  try {
    const { scrapeSoundOnAnalytics } = await import('../src/services/soundonScraper');
    console.log('🌐 Starting browser automation...');
    console.log('  (Set PLAYWRIGHT_HEADLESS=false to watch)\n');

    const result = await scrapeSoundOnAnalytics();

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Results:');
    console.log(`  Episode CSV: ${result.episodeCsv ? `✅ ${result.episodeCsv.length} bytes, ${result.episodeCsv.split('\n').length - 1} rows` : '❌ failed'}`);
    console.log(`  Daily CSV:   ${result.dailyCsv ? `✅ ${result.dailyCsv.length} bytes, ${result.dailyCsv.split('\n').length - 1} rows` : '❌ failed'}`);

    if (result.errors.length > 0) {
      console.log('\n⚠️  Errors:');
      result.errors.forEach(e => console.log(`  - ${e}`));
    }

    // Show first 3 rows of each CSV
    if (result.episodeCsv) {
      const rows = result.episodeCsv.split('\n').slice(0, 4).join('\n');
      console.log('\n📋 Episode CSV preview:');
      console.log(rows);
    }

    if (result.dailyCsv) {
      const rows = result.dailyCsv.split('\n').slice(0, 4).join('\n');
      console.log('\n📅 Daily CSV preview:');
      console.log(rows);
    }

    // Now test import via API
    if (result.episodeCsv || result.dailyCsv) {
      console.log('\n🔄 Testing import via API (POST /api/analytics/soundon-sync)...');
      const https = await import('https');
      const agent = new https.Agent({ rejectUnauthorized: false });

      const res = await fetch('https://localhost:3000/api/analytics/soundon-sync', {
        method: 'POST',
        // @ts-expect-error undici agent
        agent,
      });
      const importResult = await res.json();
      console.log('✅ Import result:', JSON.stringify(importResult, null, 2));
    }

  } catch (err) {
    console.error('❌ Test failed:', (err as Error).message);
    process.exit(1);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n⏱  Completed in ${elapsed}s`);
}

main();
