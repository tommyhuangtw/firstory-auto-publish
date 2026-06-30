// dashboard/src/services/resources/freshness.ts
import { getDb } from '@/db';
import { rgetNum } from './settings';
import type { EnrichedResource } from './types';

/** repo 建立至今天數；壞日期回 null，未來日期 clamp 在 0（視為剛建立）。 */
function repoAgeDays(createdAt: string | undefined): number | null {
  if (!createdAt) return null;
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return null;   // 壞日期 → 淘汰，避免 NaN 污染
  const d = (Date.now() - t) / 86_400_000;
  return d < 0 ? 0 : d;                    // 未來日期（時鐘偏差/壞資料）→ 視為剛建立
}

/**
 * 依建立年齡分級的爆衝閘門。新生 repo 的「總星數」≈ 它在這段時間窗衝到的星數
 * （因為它總共也才存在這麼久），所以用 created_at + 總星數就能精準判斷爆衝，不需歷史快照。
 * 取最貼合年齡的窗（門檻隨窗放大）：3 天內門檻最低、兩週內最高、超過兩週不算「最新」。
 */
function githubBurst(ageDays: number, stars: number, t3: number, t7: number, t14: number): string | null {
  if (ageDays <= 3)  return stars >= t3  ? 'burst_3d' : null;
  if (ageDays <= 7)  return stars >= t7  ? 'burst_1w' : null;
  if (ageDays <= 14) return stars >= t14 ? 'burst_2w' : null;
  return null;
}

export interface GateResult { passed: EnrichedResource[]; belowGate: number; }

/** 算 freshnessScore + 硬閘門。修改傳入物件的 freshnessScore/Reason。 */
export function applyFreshnessGate(resources: EnrichedResource[]): GateResult {
  const buzzFloor = rgetNum('resource_social_buzz_floor');
  const t3 = rgetNum('resource_github_burst_3d_stars');
  const t7 = rgetNum('resource_github_burst_1w_stars');
  const t14 = rgetNum('resource_github_burst_2w_stars');
  const maxPostAgeMs = rgetNum('resource_max_post_age_days') * 86_400_000;
  const passed: EnrichedResource[] = [];
  let belowGate = 0;

  for (const r of resources) {
    if (r.contentType === 'github') {
      // 只要最新（≤2 週建立）且爆衝達標的 repo；老 repo 不再因近期 commit/翻紅混進來。
      const ageDays = repoAgeDays(r.createdAt);
      if (ageDays === null) { belowGate++; continue; }
      const reason = githubBurst(ageDays, r.stars ?? 0, t3, t7, t14);
      if (!reason) { belowGate++; continue; }
      r.freshnessReason = reason;
      r.freshnessScore = (r.stars ?? 0) / Math.max(0.5, ageDays); // 星/天：漲最快排最前
      passed.push(r);
      continue;
    }

    // 非 github（社群貼文）：必須夠新（一年前的爆文互動再高也是舊聞）+ 互動夠高。
    if (r.publishedAt) {
      const ageMs = Date.now() - new Date(r.publishedAt).getTime();
      if (Number.isFinite(ageMs) && ageMs > maxPostAgeMs) { belowGate++; continue; }
    }
    if (r.socialBuzz > buzzFloor) {
      r.freshnessScore = r.socialBuzz / 50;
      r.freshnessReason = 'native_post';
      passed.push(r);
    } else {
      belowGate++;
    }
  }
  passed.sort((a, b) => b.freshnessScore - a.freshnessScore);
  return { passed, belowGate };
}

/** 去重 / re-surface：已 surface 過且無新動能 → 擋掉。回可前進的清單 + deduped 數。 */
export function dedupeForSurface(resources: EnrichedResource[]): { fresh: EnrichedResource[]; deduped: number } {
  const db = getDb();
  const prev = db.prepare('SELECT star_velocity, social_buzz, last_surfaced_at FROM curated_resources WHERE guid = ?');
  const fresh: EnrichedResource[] = [];
  let deduped = 0;
  for (const r of resources) {
    const row = prev.get(r.guid) as { star_velocity: number | null; social_buzz: number | null; last_surfaced_at: string | null } | undefined;
    if (!row || !row.last_surfaced_at) { fresh.push(r); continue; } // 沒 surface 過 → 放行
    // 新動能：星速度明顯放大(>1.5x，+5 絕對底防止小基數如 prev=1 被微幅波動觸發) 或 社群 buzz 比上次大 1.3x
    // 註：此函式假設 applyFreshnessGate 已先跑過（門檻已在上游把關），這裡只判斷「是否有新動能值得再浮一次」
    const velAccel = (r.starVelocity ?? 0) > (row.star_velocity ?? 0) * 1.5 + 5;
    const buzzWave = r.socialBuzz > (row.social_buzz ?? 0) * 1.3;
    if (velAccel || buzzWave) { fresh.push(r); } else { deduped++; }
  }
  return { fresh, deduped };
}
