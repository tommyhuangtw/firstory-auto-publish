// dashboard/src/services/resources/crawler.ts
import { createChildLogger } from '@/lib/logger';
import { rget, rgetList, rgetNum } from './settings';
import type { RawResource } from './types';

const log = createChildLogger('resource-crawler');

function hash(s: string): string {
  let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return Math.abs(h).toString(36);
}

export async function crawlReddit(): Promise<RawResource[]> {
  const subs = rgetList('resource_reddit_subs');
  const out: RawResource[] = [];
  for (const sub of subs) {
    try {
      const res = await fetch(`https://www.reddit.com/r/${sub}/top.json?t=week&limit=25`, {
        headers: { 'User-Agent': 'ailanbao-resources/1.0' },
      });
      if (!res.ok) { log.warn({ sub, status: res.status }, 'reddit fetch failed'); continue; }
      const data = await res.json() as { data?: { children?: Array<{ data: Record<string, unknown> }> } };
      for (const c of data.data?.children ?? []) {
        const d = c.data;
        if (d.stickied) continue;
        out.push({
          guid: `reddit_${d.id}`,
          contentType: 'reddit',
          title: String(d.title ?? ''),
          description: String(d.selftext ?? '').slice(0, 500),
          url: `https://reddit.com${d.permalink}`,
          author: String(d.author ?? ''),
          publishedAt: new Date(Number(d.created_utc ?? 0) * 1000).toISOString(),
          source: `r/${sub}`,
          engagement: { likes: Number(d.score ?? 0), comments: Number(d.num_comments ?? 0) },
        });
      }
    } catch (e) { log.warn({ sub, err: (e as Error).message }, 'reddit error'); }
  }
  return out;
}

export async function crawlGitHub(): Promise<RawResource[]> {
  const pushedDays = rgetNum('resource_github_pushed_days');
  const minStars = rgetNum('resource_github_min_stars');
  const since = new Date(Date.now() - pushedDays * 86_400_000).toISOString().split('T')[0];
  const queries = rget('resource_github_queries').split('|').map((q) => q.trim()).filter(Boolean);
  const token = process.env.GITHUB_TOKEN;
  const out: RawResource[] = [];
  for (const base of queries) {
    const q = `${base} pushed:>${since} stars:>${minStars}`;
    try {
      const res = await fetch(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=20`,
        { headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'ailanbao-resources',
                     ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
      );
      if (!res.ok) { log.warn({ q, status: res.status }, 'github fetch failed'); continue; }
      const data = await res.json() as { items?: Array<Record<string, unknown>> };
      for (const r of data.items ?? []) {
        out.push({
          guid: `github_${r.full_name}`,
          contentType: 'github',
          title: String(r.full_name ?? ''),
          description: String(r.description ?? '').slice(0, 500),
          url: String(r.html_url ?? ''),
          author: String((r.owner as Record<string, unknown>)?.login ?? ''),
          publishedAt: String(r.created_at ?? ''),
          source: 'github-search',
          engagement: { stars: Number(r.stargazers_count ?? 0) },
        });
      }
    } catch (e) { log.warn({ q, err: (e as Error).message }, 'github error'); }
  }
  return out;
}

export async function crawlX(): Promise<RawResource[]> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) { log.warn('no APIFY_API_TOKEN, skip X'); return []; }
  const terms = rgetList('resource_x_queries');
  const maxItems = rgetNum('resource_x_max_items');
  const since = new Date(Date.now() - rgetNum('resource_recency_days') * 86_400_000)
    .toISOString().split('T')[0] + '_00:00:00_UTC';
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest/run-sync-get-dataset-items?token=${token}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: 'en', maxItems, queryType: 'Top', min_faves: 60, searchTerms: terms, since }) },
    );
    if (!res.ok) { log.warn({ status: res.status }, 'apify X failed'); return []; }
    const items = await res.json() as Array<Record<string, unknown>>;
    return (Array.isArray(items) ? items : []).map((t) => {
      const id = String(t.url ?? t.twitterUrl ?? '').split('/').pop() ?? hash(JSON.stringify(t));
      const author = t.author as Record<string, unknown> | undefined;
      return {
        guid: `x_${id}`,
        contentType: 'x' as const,
        title: String(t.text ?? '').replace(/\n/g, ' ').slice(0, 80),
        description: String(t.text ?? '').slice(0, 500),
        url: String(t.twitterUrl ?? t.url ?? ''),
        author: String(author?.name ?? author?.userName ?? ''),
        publishedAt: t.createdAt ? new Date(String(t.createdAt)).toISOString() : undefined,
        source: 'x-search',
        engagement: { likes: Number(t.likeCount ?? 0), comments: Number(t.replyCount ?? 0), reposts: Number(t.retweetCount ?? 0) },
      };
    });
  } catch (e) { log.warn({ err: (e as Error).message }, 'apify X error'); return []; }
}

export async function crawlAll(): Promise<RawResource[]> {
  const [reddit, github, x] = await Promise.all([crawlReddit(), crawlGitHub(), crawlX()]);
  log.info({ reddit: reddit.length, github: github.length, x: x.length }, 'crawl done');
  return [...reddit, ...github, ...x];
}
