import { NextResponse } from 'next/server';

const PODCAST_ID = 'ca974d36-6fcc-46fc-a339-ba7ed8902c80';
const RSS_URL = `https://feeds.soundon.fm/podcasts/${PODCAST_ID}.xml`;

export async function GET() {
  try {
    const res = await fetch(RSS_URL, { cache: 'no-store' }); // RSS is >2MB, skip Next.js cache
    if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);

    const xml = await res.text();

    // Extract first <item><title> which is the latest episode
    const match = xml.match(/<item>[\s\S]*?<title><!\[CDATA\[(.*?)\]\]><\/title>/);
    if (!match) throw new Error('Could not parse RSS');

    const latestTitle = match[1];
    // Extract EP number from title like "EP293 - ..."
    const epMatch = latestTitle.match(/EP\s*(\d+)/i);
    const latestEpisodeNumber = epMatch ? parseInt(epMatch[1]) : null;

    return NextResponse.json({
      latestEpisodeNumber,
      nextEpisodeNumber: latestEpisodeNumber ? latestEpisodeNumber + 1 : null,
      latestTitle,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
