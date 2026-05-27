import { getDb } from '@/db';

interface PrComment {
  id: number;
  metadata: string; // JSON string
}

interface PrMetadata {
  url?: string;      // full PR URL e.g. https://github.com/owner/repo/pull/123
  branch?: string;
  title?: string;
  status?: string;  // 'open' | 'merged' | 'closed'
  repo?: string;
}

/**
 * Parses a GitHub PR URL into { owner, repo, number }
 * Supports: https://github.com/owner/repo/pull/123
 */
function parsePrUrl(url: string): { owner: string; repo: string; number: number } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

/**
 * Fetches PR status from GitHub API (works for public repos without token,
 * uses GITHUB_TOKEN if available for private repos / higher rate limits).
 */
async function fetchPrInfo(owner: string, repo: string, prNumber: number): Promise<{
  title: string; status: 'open' | 'merged' | 'closed'; branch: string;
} | null> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
      { headers, next: { revalidate: 0 } }
    );

    if (res.status === 404) {
      // PR might be closed — try the issues endpoint which also covers closed PRs
      const issueRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}`,
        { headers, next: { revalidate: 0 } }
      );
      if (!issueRes.ok) return null;
      const issue = await issueRes.json();
      return {
        title: issue.title,
        status: issue.state === 'closed' ? 'closed' : 'open',
        branch: '',
      };
    }

    if (!res.ok) return null;
    const pr = await res.json();

    let status: 'open' | 'merged' | 'closed' = 'open';
    if (pr.merged) status = 'merged';
    else if (pr.state === 'closed') status = 'closed';

    return {
      title: pr.title,
      status,
      branch: pr.head?.ref ?? '',
    };
  } catch {
    return null;
  }
}

/**
 * Syncs PR status for a list of PR-type task_comments.
 * Mutates the metadata in DB if status/title changed.
 */
export async function syncPrStatus(comments: PrComment[]): Promise<void> {
  const db = getDb();
  const update = db.prepare(
    'UPDATE task_comments SET metadata = ? WHERE id = ?'
  );

  await Promise.all(
    comments.map(async (comment) => {
      let meta: PrMetadata;
      try { meta = JSON.parse(comment.metadata); } catch { return; }

      if (!meta.url) return;

      const parsed = parsePrUrl(meta.url);
      if (!parsed) return;

      const info = await fetchPrInfo(parsed.owner, parsed.repo, parsed.number);
      if (!info) return;

      // Only write back if something changed
      const newMeta: PrMetadata = {
        ...meta,
        title: info.title,
        status: info.status,
        branch: info.branch || meta.branch,
      };

      const changed =
        meta.title !== newMeta.title ||
        meta.status !== newMeta.status ||
        meta.branch !== newMeta.branch;

      if (changed) {
        update.run(JSON.stringify(newMeta), comment.id);
      }
    })
  );
}
