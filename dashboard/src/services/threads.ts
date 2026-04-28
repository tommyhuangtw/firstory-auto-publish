/**
 * Threads Posting via Threads API (graph.threads.net)
 *
 * Posts text or image+text to Threads.
 * Credentials (user_id + access_token) stored in settings table.
 */

import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import { withRetry } from '@/lib/retry';

const log = createChildLogger('threads');
const THREADS_API = 'https://graph.threads.net/v1.0';

interface ThreadsCredentials {
  userId: string;
  accessToken: string;
}

function getCredentials(): ThreadsCredentials | null {
  const db = getDb();
  const getSetting = (key: string): string | undefined => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  };

  const userId = getSetting('threads_user_id');
  const accessToken = getSetting('threads_access_token');

  if (!userId || !accessToken) return null;
  return { userId, accessToken };
}

/**
 * Post text-only to Threads.
 * Returns the published post ID, or null if not configured.
 */
export async function postTextToThreads(text: string): Promise<string | null> {
  const creds = getCredentials();
  if (!creds) {
    log.info('Threads not connected, skipping post');
    return null;
  }

  log.info('Creating text post on Threads');

  // Step 1: Create media container
  const createResp = await withRetry(
    async () => {
      const r = await fetch(`${THREADS_API}/${creds.userId}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_type: 'TEXT',
          text,
          access_token: creds.accessToken,
        }),
      });
      if (!r.ok) {
        const err = await r.text();
        throw new Error(`Threads create failed: ${r.status} ${err}`);
      }
      return r;
    },
    { label: 'threads-create-text' },
  );
  const createData = await createResp.json();
  const creationId = createData.id;

  // Step 2: Publish
  const publishResp = await withRetry(
    async () => {
      const r = await fetch(`${THREADS_API}/${creds.userId}/threads_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: creationId,
          access_token: creds.accessToken,
        }),
      });
      if (!r.ok) {
        const err = await r.text();
        throw new Error(`Threads publish failed: ${r.status} ${err}`);
      }
      return r;
    },
    { label: 'threads-publish' },
  );
  const publishData = await publishResp.json();
  const postId = publishData.id;
  log.info({ postId }, 'Posted text to Threads');
  return postId;
}

/**
 * Post image + text to Threads.
 * imageUrl must be publicly accessible.
 */
export async function postImageToThreads(imageUrl: string, text: string): Promise<string | null> {
  const creds = getCredentials();
  if (!creds) {
    log.info('Threads not connected, skipping post');
    return null;
  }

  log.info('Creating image post on Threads');

  // Step 1: Create media container with image
  const createResp = await withRetry(
    async () => {
      const r = await fetch(`${THREADS_API}/${creds.userId}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_type: 'IMAGE',
          image_url: imageUrl,
          text,
          access_token: creds.accessToken,
        }),
      });
      if (!r.ok) {
        const err = await r.text();
        throw new Error(`Threads create image failed: ${r.status} ${err}`);
      }
      return r;
    },
    { label: 'threads-create-image' },
  );
  const createData = await createResp.json();
  const creationId = createData.id;

  // Step 2: Publish
  const publishResp = await withRetry(
    async () => {
      const r = await fetch(`${THREADS_API}/${creds.userId}/threads_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: creationId,
          access_token: creds.accessToken,
        }),
      });
      if (!r.ok) {
        const err = await r.text();
        throw new Error(`Threads publish failed: ${r.status} ${err}`);
      }
      return r;
    },
    { label: 'threads-publish-image' },
  );
  const publishData = await publishResp.json();
  const postId = publishData.id;
  log.info({ postId }, 'Posted image to Threads');
  return postId;
}

/**
 * Build a Threads post URL from the post ID.
 */
export function getThreadsPostUrl(postId: string): string {
  return `https://www.threads.net/post/${postId}`;
}

interface BuildThreadsCaptionOptions {
  igCaption: string;
  episodeTitle: string;
  episodeNumber: number;
  segmentType: string;
}

const THREADS_SYSTEM_PROMPT = `你是「AI懶人報」的 Threads 小編。你要把 Instagram 貼文改寫成適合 Threads 的短文版本。

## 品牌資訊
- 節目名稱：AI懶人報（daily 主題）或 系統設計懶懶學（sysdesign 主題）
- 主持人暱稱：湯懶懶（懶人教主）
- 品牌調性：輕鬆、懶散但有料、用生活化比喻解釋技術概念

## Threads 貼文規則（嚴格遵守）

### 字數限制
- 嚴格控制在 400 字以內（絕對不能超過 500 字）
- 精簡再精簡，每句話都要有價值

### 結構
1. 用一句吸睛的 hook 開頭（問句、反直覺事實、或生活場景）
2. 用 2-3 個重點帶出核心知識（每點 1-2 句話，用 emoji 開頭）
3. 一句輕鬆的結尾，提到完整內容在 Podcast 裡
4. 最後一行標示集數資訊，格式：🎧 {節目名稱} {集數代號} — {標題}

### 禁止事項
- 不要放任何連結（URL）
- 不要放 hashtag
- 不要使用 markdown 語法（不要 **粗體**、*斜體*）
- 不要寫成長文或部落格風格
- 不要放參考資料或來源

### 風格
- 口語化、對話感，像在跟朋友聊天
- 適度用 emoji 點綴，但不要每句都有
- 要讓人想點進 profile 去聽完整 Podcast

## 輸出格式
直接輸出 Threads 貼文純文字，不加任何說明。`;

/**
 * Generate a Threads caption using LLM, with template fallback.
 */
export async function buildThreadsCaption(opts: BuildThreadsCaptionOptions): Promise<string> {
  const { igCaption, episodeTitle, episodeNumber, segmentType } = opts;

  const isSysdesign = segmentType === 'sysdesign';
  const showLabel = isSysdesign ? '系統設計懶懶學' : 'AI懶人報';
  const epLabel = isSysdesign ? `S${episodeNumber}` : `EP${episodeNumber}`;

  const userPrompt = `請幫我把以下 IG 貼文改寫成 Threads 版本。

## 節目資訊
- 節目：${showLabel}
- 集數：${epLabel}
- 標題：${episodeTitle}

## IG 原文
${igCaption}

請嚴格按照 system prompt 的規則產生 Threads 貼文，控制在 400 字以內。`;

  try {
    const { getLLMService } = await import('@/services/llmService');
    const llm = getLLMService();
    const result = await llm.call({
      stage: 'threads_caption',
      episodeNumber,
      messages: [
        { role: 'system', content: THREADS_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      options: {
        temperature: 0.85,
        maxTokens: 800,
        preferredModel: 'google/gemini-2.5-flash',
      },
    });

    if (result.success && result.content) {
      log.info({ model: result.model, length: result.content.length }, 'Threads caption generated by LLM');
      return result.content.trim();
    }

    log.warn({ error: result.error }, 'LLM failed for Threads caption, using template fallback');
  } catch (err) {
    log.warn({ error: (err as Error).message }, 'LLM unavailable for Threads caption, using template fallback');
  }

  return buildThreadsCaptionTemplate(opts);
}

/** Static template fallback */
function buildThreadsCaptionTemplate(opts: BuildThreadsCaptionOptions): string {
  const { igCaption, episodeTitle, episodeNumber, segmentType } = opts;

  const isSysdesign = segmentType === 'sysdesign';
  const showLabel = isSysdesign ? '系統設計懶懶學' : 'AI懶人報';
  const epLabel = isSysdesign ? `S${episodeNumber}` : `EP${episodeNumber}`;

  // Extract first few lines from IG caption as summary
  const lines = igCaption.split('\n').filter(l => {
    const t = l.trim();
    if (!t) return false;
    if ((t.match(/#\S+/g) || []).length > 1) return false;
    if (/完整拆解都在|快點擊個人檔案|收聽連結|收藏這篇|留言告訴我/.test(t)) return false;
    return true;
  });

  // Take first 3-4 meaningful lines
  const summary = lines.slice(0, 4).join('\n');

  // Trim to ~400 chars
  const trimmed = summary.length > 380 ? summary.slice(0, 380) + '...' : summary;

  return `${trimmed}

完整內容都在 Podcast 裡！
🎧 ${showLabel} ${epLabel} — ${episodeTitle}`;
}
