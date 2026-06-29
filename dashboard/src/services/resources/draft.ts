import { writeBestOfN } from '@/services/voice/writer';
import { createChildLogger } from '@/lib/logger';
import type { ScoredResource } from './types';

const log = createChildLogger('resource-draft');

export interface ResourceDraft {
  guid: string;
  draftText: string;
  viralScore: number;
}

/**
 * 把一個資源寫成 Threads 草稿，語氣＝懶人包/工具清單。best-of-N 挑最爆。
 *
 * 角度只當 soft hint：以資源本身的事實（標題/說明/連結）為主，aiAngle 僅供參考，
 * 避免 LLM 生成的角度回灌過時的模型名稱。版本守門由 voice writer 自己的
 * VERSION_GUARD_ZH 處理（已注入 system prompt），這裡不重複。
 */
export async function draftResource(r: ScoredResource): Promise<ResourceDraft> {
  const whyNow = r.freshnessReason === 'star_spike' ? '最近星數暴衝'
    : (r.freshnessReason === 'social_buzz' || r.freshnessReason === 'native_post') ? '社群正在熱議'
    : '剛上線的新工具';

  const brief = `把這個資源寫成一則「實用資源/工具懶人包」風格的 Threads 貼文（繁中、個人口吻、附來源連結）。
資源：${r.title}
這是什麼：${r.description}
為什麼現在值得看：${whyNow}
亮點：${r.aiHighlights.join('、')}
建議角度（僅供參考，以資源事實為主）：${r.aiAngle}
來源：${r.url}`;

  const result = await writeBestOfN(
    { mode: 'rewrite', idea: brief, useStories: false, viral: true },
    5,
  );

  const viralScore = result.best.score?.viralProb ?? 0;
  log.info({ guid: r.guid, viral: viralScore, scored: result.scored }, 'draft done');

  return { guid: r.guid, draftText: result.best.draft, viralScore };
}
