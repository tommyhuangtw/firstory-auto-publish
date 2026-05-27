/**
 * Hermes Webhook Receiver
 *
 * Receives event POSTs from the podcast automation system's notificationHub
 * and logs formatted messages. When running alongside Hermes, these messages
 * are picked up by the gateway and forwarded to Telegram.
 *
 * In standalone mode, it can also directly send to Telegram Bot API.
 */

import express from 'express';
import { formatEvent } from './formatters.js';

const PORT = parseInt(process.env.WEBHOOK_PORT || '3001', 10);
const TELEGRAM_BOT_TOKEN = process.env.HERMES_TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.HERMES_TELEGRAM_CHAT_ID;

const app = express();
app.use(express.json());

app.post('/webhook/podcast', async (req, res) => {
  const payload = req.body;

  if (!payload?.type) {
    res.status(400).json({ error: 'Missing event type' });
    return;
  }

  const message = formatEvent(payload);
  console.log(`\n[${new Date().toISOString()}] Event: ${payload.type}`);
  console.log(message);
  console.log('---');

  // If Telegram credentials are configured, send directly
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    try {
      await sendTelegram(message);
    } catch (err) {
      console.error('Telegram send failed:', (err as Error).message);
    }
  }

  res.json({ received: true, type: payload.type });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

async function sendTelegram(text: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API ${res.status}: ${body}`);
  }
}

app.listen(PORT, () => {
  console.log(`Webhook receiver listening on port ${PORT}`);
  console.log(`Telegram: ${TELEGRAM_BOT_TOKEN ? 'configured' : 'not configured (log-only mode)'}`);
});
