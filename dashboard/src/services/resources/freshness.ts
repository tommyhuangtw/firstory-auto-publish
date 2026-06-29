// dashboard/src/services/resources/freshness.ts
import { getDb } from '@/db';
import { rgetNum } from './settings';
import type { EnrichedResource } from './types';

/** repo 年齡加權：窗口內滿分，之後線性衰減到 0。 */
function youthBonus(createdAt: string | undefined, windowDays: number): number {
  if (!createdAt) return 0;
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return 0;   // 壞日期 → 不加權，避免 NaN 污染整串排序
  const ageDays = (Date.now() - t) / 86_400_000;
  if (ageDays < 0) return 1;           // 未來日期（時鐘偏差/壞資料）→ 視為最新，clamp 在 1
  if (ageDays <= windowDays) return 1 - (ageDays / windowDays) * 0.5; // 0.5~1
  return Math.max(0, 0.5 - (ageDays - windowDays) / (windowDays * 4)); // 之後快速衰減
}

export interface GateResult { passed: EnrichedResource[]; belowGate: number; }

/** 算 freshnessScore + 硬閘門。修改傳入物件的 freshnessScore/Reason。 */
export function applyFreshnessGate(resources: EnrichedResource[]): GateResult {
  const buzzFloor = rgetNum('resource_social_buzz_floor');
  const velFloor = rgetNum('resource_star_velocity_floor');
  const youthWindow = rgetNum('resource_youth_window_days');
  const maxPostAgeMs = rgetNum('resource_max_post_age_days') * 86_400_000;
  const passed: EnrichedResource[] = [];
  let belowGate = 0;

  for (const r of resources) {
    // 社群貼文（非 github）必須夠新：一篇一年前的爆文（8M views）互動再高也是舊聞，直接淘汰。
    // github 不套用此規則 —— 老 repo「現在星數暴衝」正是我們要的「被重新討論」訊號。
    if (r.contentType !== 'github' && r.publishedAt) {
      const ageMs = Date.now() - new Date(r.publishedAt).getTime();
      if (Number.isFinite(ageMs) && ageMs > maxPostAgeMs) { belowGate++; continue; }
    }

    const youth = r.contentType === 'github' ? youthBonus(r.createdAt, youthWindow) : 0;
    const vel = r.starVelocity ?? 0;

    const socialOk = r.socialBuzz > buzzFloor;
    const starOk = vel > velFloor;
    // 非 github 原生資源：用貼文互動本身（socialBuzz）當門檻
    const nativeOk = r.contentType !== 'github' && r.socialBuzz > buzzFloor;
    // 首見新生 repo（無 velocity 歷史）：youthBonus 高就放行
    const youthOk = r.contentType === 'github' && r.starVelocity === undefined && youth > 0.7;

    if (socialOk || starOk || nativeOk || youthOk) {
      // 分數：星速度 × youth 疊加，社群 buzz 正規化加總
      r.freshnessScore = vel * (1 + youth) + r.socialBuzz / 50 + youth * 20;
      // nativeOk 先於 socialOk：非 github 原生熱資源標 native_post；github 因被討論而過則標 social_buzz
      r.freshnessReason = starOk ? 'star_spike' : nativeOk ? 'native_post' : socialOk ? 'social_buzz' : 'youth';
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
