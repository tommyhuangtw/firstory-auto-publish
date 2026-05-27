/**
 * Format pipeline events into human-readable Telegram messages.
 */

interface EventPayload {
  type: string;
  episodeId: number;
  episodeNumber?: number | null;
  segmentType?: string;
  title?: string;
  stage?: string;
  error?: string;
  retryError?: string;
  urls?: Record<string, string | undefined>;
  publishErrors?: Array<{ platform: string; error: string }>;
  candidateTitles?: string[];
  timestamp: string;
}

const SEGMENT_LABELS: Record<string, string> = {
  daily: 'AI 工具精選',
  weekly: 'AI 精選週報',
  robot: '機器人觀察週報',
  sysdesign: '系統設計懶懶學',
  quickchat: '懶懶碎碎念',
};

export function formatEvent(payload: EventPayload): string {
  const segment = SEGMENT_LABELS[payload.segmentType || ''] || payload.segmentType || '';
  const epLabel = payload.episodeNumber ? `EP#${payload.episodeNumber}` : `ID:${payload.episodeId}`;

  switch (payload.type) {
    case 'pipeline.completed':
      return [
        `[Pipeline 完成] ${epLabel} (${segment})`,
        '',
        payload.candidateTitles?.length
          ? `標題候選：\n${payload.candidateTitles.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}`
          : '',
        '',
        `Review: ${payload.urls?.dashboard || ''}`,
      ].filter(Boolean).join('\n');

    case 'pipeline.failed':
      return [
        `[Pipeline 失敗] ${epLabel} (${segment})`,
        '',
        `錯誤：${payload.error || 'Unknown'}`,
        '',
        '60 秒後自動重試。',
      ].join('\n');

    case 'pipeline.retry.success':
      return [
        `[重試成功] ${epLabel} (${segment})`,
        '',
        `原失敗階段：${payload.stage || 'Unknown'}`,
        'Pipeline 已恢復，等待 review。',
      ].join('\n');

    case 'pipeline.retry.failed':
      return [
        `[重試也失敗] ${epLabel} (${segment})`,
        '',
        `原始錯誤：${payload.error || ''}`,
        `重試錯誤：${payload.retryError || ''}`,
        '',
        '需要手動介入。',
      ].join('\n');

    case 'episode.ready_for_review':
      return [
        `[待審核] ${epLabel} (${segment})`,
        '',
        payload.candidateTitles?.length
          ? `標題候選：\n${payload.candidateTitles.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}`
          : '',
        '',
        `Review: ${payload.urls?.dashboard || ''}`,
      ].filter(Boolean).join('\n');

    case 'episode.published': {
      const links = [];
      if (payload.urls?.soundon) links.push(`SoundOn: ${payload.urls.soundon}`);
      if (payload.urls?.youtube) links.push(`YouTube: ${payload.urls.youtube}`);
      return [
        `[已發布] ${epLabel} ${payload.title || ''}`,
        '',
        ...links,
      ].join('\n');
    }

    case 'episode.publish.partial_failure': {
      const errors = payload.publishErrors?.map(e => `  ${e.platform}: ${e.error}`).join('\n') || '';
      return [
        `[部分發布失敗] ${epLabel} ${payload.title || ''}`,
        '',
        `失敗平台：\n${errors}`,
        '',
        payload.urls?.soundon ? `SoundOn: ${payload.urls.soundon}` : '',
        payload.urls?.youtube ? `YouTube: ${payload.urls.youtube}` : '',
      ].filter(Boolean).join('\n');
    }

    default:
      return `[${payload.type}] ${epLabel}: ${JSON.stringify(payload).slice(0, 200)}`;
  }
}
