/**
 * NotificationHub — Central event dispatcher for pipeline events.
 *
 * Fans out events to multiple channels (Gmail, Webhook).
 * Each channel is independent: one failure doesn't block others.
 */

import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('notification-hub');

export type EventType =
  | 'pipeline.completed'
  | 'pipeline.failed'
  | 'pipeline.retry.success'
  | 'pipeline.retry.failed'
  | 'episode.ready_for_review'
  | 'episode.published'
  | 'episode.publish.partial_failure';

export interface EventPayload {
  type: EventType;
  episodeId: number;
  episodeNumber?: number | null;
  segmentType?: string;
  title?: string;
  stage?: string;
  error?: string;
  retryError?: string;
  urls?: {
    soundon?: string;
    youtube?: string;
    instagram?: string;
    dashboard?: string;
  };
  publishErrors?: Array<{ platform: string; error: string }>;
  candidateTitles?: string[];
  timestamp: string;
}

type Channel = {
  name: string;
  send: (payload: EventPayload) => Promise<void>;
};

const channels: Channel[] = [];

/**
 * Register a notification channel.
 */
export function registerChannel(channel: Channel): void {
  channels.push(channel);
  log.info({ channel: channel.name }, 'Notification channel registered');
}

/**
 * Emit an event to all registered channels.
 * Each channel runs independently — failures are logged but don't propagate.
 */
export async function emitEvent(payload: EventPayload): Promise<void> {
  log.info({ type: payload.type, episodeId: payload.episodeId, channels: channels.length }, 'Emitting event');

  await Promise.allSettled(
    channels.map(async (channel) => {
      try {
        await channel.send(payload);
        log.info({ type: payload.type, channel: channel.name }, 'Event delivered');
      } catch (err) {
        log.error({ type: payload.type, channel: channel.name, error: (err as Error).message }, 'Event delivery failed');
      }
    })
  );
}

// ── Hermes Webhook Channel ──
// Posts to Hermes Agent's built-in webhook endpoint (port 8644).
// Uses HMAC-SHA256 signing and deliver_only mode for instant push to Telegram.

const HERMES_WEBHOOK_URL = process.env.HERMES_WEBHOOK_URL;
const HERMES_WEBHOOK_SECRET = process.env.HERMES_WEBHOOK_SECRET || '';

const SEGMENT_LABELS: Record<string, string> = {
  daily: 'AI 工具精選',
  weekly: 'AI 精選週報',
  robot: '機器人觀察週報',
  sysdesign: '系統設計懶懶學',
  quickchat: '懶懶碎碎念',
};

function formatEventMessage(payload: EventPayload): string {
  const segment = SEGMENT_LABELS[payload.segmentType || ''] || payload.segmentType || '';
  const epLabel = payload.episodeNumber ? `EP#${payload.episodeNumber}` : `ID:${payload.episodeId}`;

  switch (payload.type) {
    case 'pipeline.completed':
      return [
        `[Pipeline 完成] ${epLabel} (${segment})`,
        payload.candidateTitles?.length
          ? `標題候選：\n${payload.candidateTitles.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}`
          : '',
        payload.urls?.dashboard ? `Review: ${payload.urls.dashboard}` : '',
      ].filter(Boolean).join('\n\n');

    case 'pipeline.failed':
      return `[Pipeline 失敗] ${epLabel} (${segment})\n\n錯誤：${payload.error || 'Unknown'}\n\n60 秒後自動重試。`;

    case 'pipeline.retry.success':
      return `[重試成功] ${epLabel} (${segment})\n\n原失敗階段：${payload.stage || 'Unknown'}\nPipeline 已恢復，等待 review。`;

    case 'pipeline.retry.failed':
      return `[重試也失敗] ${epLabel} (${segment})\n\n原始錯誤：${payload.error || ''}\n重試錯誤：${payload.retryError || ''}\n\n需要手動介入。`;

    case 'episode.ready_for_review':
      return [
        `[待審核] ${epLabel} (${segment})`,
        payload.candidateTitles?.length
          ? `標題候選：\n${payload.candidateTitles.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}`
          : '',
        payload.urls?.dashboard ? `Review: ${payload.urls.dashboard}` : '',
      ].filter(Boolean).join('\n\n');

    case 'episode.published': {
      const links = [];
      if (payload.urls?.soundon) links.push(`SoundOn: ${payload.urls.soundon}`);
      if (payload.urls?.youtube) links.push(`YouTube: ${payload.urls.youtube}`);
      return [`[已發布] ${epLabel} ${payload.title || ''}`, ...links].join('\n\n');
    }

    case 'episode.publish.partial_failure': {
      const errors = payload.publishErrors?.map(e => `  ${e.platform}: ${e.error}`).join('\n') || '';
      return [
        `[部分發布失敗] ${epLabel} ${payload.title || ''}`,
        `失敗平台：\n${errors}`,
        payload.urls?.soundon ? `SoundOn: ${payload.urls.soundon}` : '',
        payload.urls?.youtube ? `YouTube: ${payload.urls.youtube}` : '',
      ].filter(Boolean).join('\n\n');
    }

    default:
      return `[${payload.type}] ${epLabel}`;
  }
}

async function signPayload(body: string, secret: string): Promise<string> {
  if (!secret) return '';
  const { createHmac } = await import('crypto');
  return createHmac('sha256', secret).update(body).digest('hex');
}

if (HERMES_WEBHOOK_URL) {
  registerChannel({
    name: 'hermes-webhook',
    send: async (payload) => {
      const message = formatEventMessage(payload);
      const body = JSON.stringify({ message, event: payload.type, data: payload });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (HERMES_WEBHOOK_SECRET) {
          headers['X-Hub-Signature-256'] = `sha256=${await signPayload(body, HERMES_WEBHOOK_SECRET)}`;
        }
        const res = await fetch(HERMES_WEBHOOK_URL, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`Hermes webhook returned ${res.status}`);
        }
      } finally {
        clearTimeout(timer);
      }
    },
  });
}
