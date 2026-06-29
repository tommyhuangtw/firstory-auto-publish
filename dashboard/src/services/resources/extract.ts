// dashboard/src/services/resources/extract.ts
import type { RawResource } from './types';

const REPO_RE = /github\.com\/([a-z0-9][\w.-]+\/[a-z0-9][\w.-]+)/gi;

/** 對社群貼文抽出被提到的 repo full_name（去重、去掉常見非 repo path）。 */
export function extractRepos(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(REPO_RE)) {
    const full = m[1].replace(/\.git$/, '').replace(/[).,]+$/, '');
    const [owner, repo] = full.split('/');
    if (!owner || !repo) continue;
    if (['orgs', 'sponsors', 'topics', 'features', 'about'].includes(owner.toLowerCase())) continue;
    out.add(`${owner}/${repo}`);
  }
  return [...out];
}

/** 對每條 social 資源填 mentionedRepos。 */
export function annotateMentions(resources: RawResource[]): RawResource[] {
  return resources.map((r) => {
    if (r.contentType === 'x' || r.contentType === 'reddit') {
      const repos = extractRepos(`${r.description} ${r.url}`);
      if (repos.length) return { ...r, mentionedRepos: repos };
    }
    return r;
  });
}
