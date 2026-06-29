// dashboard/src/services/resources/enrich.ts
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import type { RawResource, EnrichedResource } from './types';

const log = createChildLogger('resource-enrich');

async function fetchRepo(fullName: string): Promise<Record<string, unknown> | null> {
  const token = process.env.GITHUB_TOKEN;
  try {
    const res = await fetch(`https://api.github.com/repos/${fullName}`, {
      headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'ailanbao-resources',
                 ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) return null;
    return await res.json() as Record<string, unknown>;
  } catch (e) { log.warn({ fullName, err: (e as Error).message }, 'repo fetch failed'); return null; }
}

function socialBuzz(r: RawResource): number {
  const e = r.engagement ?? {};
  return (e.likes ?? 0) * 1 + (e.comments ?? 0) * 1.5 + (e.reposts ?? 0) * 2;
}

/** 把社群抽到的 repo 併進清單（升級成 github 候選）。 */
export function expandMentionedRepos(resources: RawResource[]): RawResource[] {
  const have = new Set(resources.map((r) => r.guid));
  const extra: RawResource[] = [];
  for (const r of resources) {
    for (const full of r.mentionedRepos ?? []) {
      const guid = `github_${full}`;
      if (have.has(guid)) continue;
      have.add(guid);
      extra.push({
        guid, contentType: 'github', title: full, description: '', url: `https://github.com/${full}`,
        author: full.split('/')[0], source: `mentioned:${r.contentType}`,
        engagement: { likes: r.engagement?.likes, comments: r.engagement?.comments, reposts: r.engagement?.reposts },
      });
    }
  }
  return [...resources, ...extra];
}

export async function enrichAll(resources: RawResource[]): Promise<EnrichedResource[]> {
  const db = getDb();
  const getPrev = db.prepare('SELECT stars, last_stars_at FROM curated_resources WHERE guid = ?');
  const out: EnrichedResource[] = [];
  for (const r of resources) {
    let stars: number | undefined;
    let createdAt: string | undefined;
    let starVelocity: number | undefined;

    if (r.contentType === 'github') {
      const repo = await fetchRepo(r.title);
      if (repo) {
        stars = Number(repo.stargazers_count ?? 0);
        createdAt = String(repo.created_at ?? '');
        if (!r.description) r.description = String(repo.description ?? '').slice(0, 500);
        const prev = getPrev.get(r.guid) as { stars: number | null; last_stars_at: string | null } | undefined;
        if (prev?.stars != null && prev.last_stars_at) {
          const days = Math.max(0.5, (Date.now() - new Date(prev.last_stars_at).getTime()) / 86_400_000);
          starVelocity = (stars - prev.stars) / days;
        }
      } else {
        stars = r.engagement?.stars;
      }
    }
    out.push({
      ...r, stars, createdAt: createdAt ?? r.publishedAt, starVelocity,
      socialBuzz: socialBuzz(r), freshnessScore: 0, freshnessReason: '',
    });
  }
  log.info({ count: out.length }, 'enrich done');
  return out;
}
