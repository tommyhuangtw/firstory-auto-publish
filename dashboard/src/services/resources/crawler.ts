// dashboard/src/services/resources/crawler.ts
import { createChildLogger } from '@/lib/logger';
import { rget, rgetList, rgetNum } from './settings';
import type { RawResource } from './types';

const log = createChildLogger('resource-crawler');

function hash(s: string): string {
  let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return Math.abs(h).toString(36);
}

/** X 沒有標題 → 取推文前 N 字當標題，但在字詞邊界切、加 …，避免切在半個字中間。 */
function cleanTitle(text: string, max = 100): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/\s+\S*$/, '') + '…';
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
  const minFaves = rgetNum('resource_x_min_faves');
  const since = new Date(Date.now() - rgetNum('resource_recency_days') * 86_400_000)
    .toISOString().split('T')[0] + '_00:00:00_UTC';
  // 注意：KaitoEasyAPI 不解析 searchTerms 裡的 Twitter 進階運算子（會被當字面關鍵字 → 搜不到 → 回 mock）。
  // 所以 searchTerms 用「純關鍵字」+ 走 actor 的 top-level 參數（min_faves/since/lang），其餘過濾在我們自己 code 做：
  // 排除大廠官方帳號（用作者 handle 比對）、mock 防護（URL）、近 2 天由 freshness gate 把關。
  const excludeSet = new Set(rgetList('resource_x_exclude_accounts').map((a) => a.toLowerCase()));
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest/run-sync-get-dataset-items?token=${token}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: 'en', maxItems, queryType: 'Top', min_faves: minFaves, searchTerms: terms, since }) },
    );
    if (!res.ok) { log.warn({ status: res.status }, 'apify X failed'); return []; }
    const items = await res.json() as Array<Record<string, unknown>>;
    // KaitoEasyAPI 在實際搜尋回 0 筆時，會塞「mock data」通知訊息湊最低收費 → 用真實推文 URL 過濾掉。
    const TWEET_URL = /(?:twitter|x)\.com\/[^/]+\/status\/\d+/;
    return (Array.isArray(items) ? items : [])
      .filter((t) => {
        const url = String(t.twitterUrl ?? t.url ?? '');
        if (!TWEET_URL.test(url)) return false; // mock / 非推文
        const handle = String((t.author as Record<string, unknown> | undefined)?.userName ?? '').toLowerCase();
        if (handle && excludeSet.has(handle)) return false; // 大廠官方帳號排除
        if (t.isReply === true || t.isRetweet === true) return false; // 只要原創
        return true;
      })
      .map((t) => {
        const url = String(t.twitterUrl ?? t.url ?? '');
        const id = url.split('/').pop() ?? hash(JSON.stringify(t));
        const author = t.author as Record<string, unknown> | undefined;
        return {
          guid: `x_${id}`,
          contentType: 'x' as const,
          title: cleanTitle(String(t.text ?? '')),
          description: String(t.text ?? '').slice(0, 500),
          url,
          author: String(author?.name ?? author?.userName ?? ''),
          publishedAt: t.createdAt ? new Date(String(t.createdAt)).toISOString() : undefined,
          source: 'x-search',
          engagement: { likes: Number(t.likeCount ?? 0), comments: Number(t.replyCount ?? 0), reposts: Number(t.retweetCount ?? 0) },
        };
      });
  } catch (e) { log.warn({ err: (e as Error).message }, 'apify X error'); return []; }
}

export async function crawlAll(): Promise<RawResource[]> {
  const [github, x] = await Promise.all([crawlGitHub(), crawlX()]);
  log.info({ github: github.length, x: x.length }, 'crawl done');
  return [...github, ...x];
}
