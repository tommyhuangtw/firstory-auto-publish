/**
 * webPush — sends Web Push notifications to subscribed devices (iPhone PWA / desktop).
 *
 * Subscriptions live in the `push_subscriptions` table (one row per device/browser).
 * Dead subscriptions (410 Gone / 404) are pruned automatically on send.
 *
 * VAPID keys come from env (.env.local):
 *   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
 * Generate with: node -e "console.log(require('web-push').generateVAPIDKeys())"
 */

import webpush from 'web-push';
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('web-push');

let vapidConfigured = false;

function ensureVapid(): boolean {
  if (vapidConfigured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:ailanrenbao@gmail.com';
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  vapidConfigured = true;
  return true;
}

/** Whether push is configured (VAPID keys present). */
export function isPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/** Public VAPID key for the browser to subscribe with. */
export function getPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY || '';
}

export interface PushNotification {
  title: string;
  body: string;
  url?: string;   // where to deep-link when tapped
  tag?: string;   // collapse key — same tag replaces previous notification
}

interface SubRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Push a content-discovery event (trends 回覆專區 / resources), gated by the same
 * `push_event_filter` setting so it stays toggleable alongside pipeline events.
 * Best-effort — never throws into the caller's scan flow.
 */
export async function maybePushContentEvent(eventKey: string, notification: PushNotification): Promise<void> {
  try {
    const row = getDb().prepare("SELECT value FROM settings WHERE key = 'push_event_filter'").get() as { value?: string } | undefined;
    if (row?.value) {
      const allowed = JSON.parse(row.value) as string[];
      if (!allowed.includes(eventKey)) return;  // user toggled this event off
    }
    await sendPushToAll(notification);
  } catch (err) {
    log.error({ eventKey, error: (err as Error).message }, 'content push failed');
  }
}

/**
 * Send a notification to every enabled subscription.
 * Returns how many were delivered. Prunes dead subscriptions.
 */
export async function sendPushToAll(notification: PushNotification): Promise<{ sent: number; pruned: number }> {
  if (!ensureVapid()) {
    log.warn('Push not configured (no VAPID keys) — skipping');
    return { sent: 0, pruned: 0 };
  }

  const db = getDb();
  const subs = db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE enabled = 1').all() as SubRow[];
  if (subs.length === 0) return { sent: 0, pruned: 0 };

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    url: notification.url || '/',
    tag: notification.tag,
  });

  let sent = 0;
  let pruned = 0;
  const deadIds: number[] = [];

  await Promise.allSettled(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload
        );
        sent++;
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Subscription is gone — remove it so we stop trying.
          deadIds.push(s.id);
          pruned++;
        } else {
          log.error({ endpoint: s.endpoint.slice(0, 40), statusCode, error: (err as Error).message }, 'Push send failed');
        }
      }
    })
  );

  if (deadIds.length) {
    const placeholders = deadIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM push_subscriptions WHERE id IN (${placeholders})`).run(...deadIds);
  }
  if (sent) {
    db.prepare('UPDATE push_subscriptions SET last_used_at = datetime(\'now\') WHERE enabled = 1').run();
  }

  log.info({ sent, pruned, total: subs.length }, 'Push fan-out complete');
  return { sent, pruned };
}
