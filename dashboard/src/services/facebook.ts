/**
 * Facebook Page Posting via Graph API v22.0
 *
 * Posts photos with captions to a Facebook Page.
 * Credentials (page_id + page_access_token) are stored in the settings table
 * and obtained via the OAuth flow in /api/auth/facebook/.
 */

import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import { withRetry } from '@/lib/retry';

const log = createChildLogger('facebook');
const GRAPH_API = 'https://graph.facebook.com/v22.0';

interface PageCredentials {
  pageId: string;
  accessToken: string;
}

function getPageCredentials(): PageCredentials | null {
  const db = getDb();
  const getSetting = (key: string): string | undefined => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  };

  const pageId = getSetting('fb_page_id');
  const accessToken = getSetting('fb_page_access_token');

  if (!pageId || !accessToken) return null;
  return { pageId, accessToken };
}

/**
 * Post a photo to a Facebook Page.
 * Returns the FB post ID, or null if Facebook is not configured.
 */
export async function postPhotoToFacebook(imageUrl: string, message: string): Promise<string | null> {
  const creds = getPageCredentials();
  if (!creds) {
    log.info('Facebook Page not connected, skipping post');
    return null;
  }

  log.info('Posting photo to Facebook Page');
  const resp = await withRetry(
    async () => {
      const r = await fetch(`${GRAPH_API}/${creds.pageId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: imageUrl,
          message,
          access_token: creds.accessToken,
        }),
      });
      if (!r.ok) {
        const err = await r.text();
        throw new Error(`FB photo post failed: ${r.status} ${err}`);
      }
      return r;
    },
    { label: 'fb-photo-post' },
  );

  const data = await resp.json();
  const postId = data.post_id || data.id;
  log.info({ postId }, 'Posted photo to Facebook Page');
  return postId;
}

/**
 * Build a Facebook post URL from the post ID.
 * Post ID format: {page_id}_{post_id} → URL: https://www.facebook.com/{page_id}/posts/{post_id}
 */
export function getFacebookPostUrl(fbPostId: string): string {
  const parts = fbPostId.split('_');
  if (parts.length === 2) {
    return `https://www.facebook.com/${parts[0]}/posts/${parts[1]}`;
  }
  return `https://www.facebook.com/${fbPostId}`;
}

interface SourceLink {
  title?: string;
  url?: string;
  viewCount?: number;
  channelName?: string;
  publishedAt?: string;
}

interface BuildCaptionOptions {
  igCaption: string;
  sourceLinks: SourceLink[];
  episodeTitle: string;
  episodeNumber: number;
  segmentType: string;
}

const FB_SYSTEM_PROMPT = `你是「AI懶人報」的 Facebook 社群小編。你要把 Instagram 貼文改寫成適合 Facebook 的版本。

## 品牌資訊
- 節目名稱：AI懶人報（daily 主題）或 系統設計懶懶學（sysdesign 主題）
- 主持人暱稱：湯懶懶（懶人教主）
- 品牌調性：輕鬆、懶散但有料、用生活化比喻解釋技術概念
- Portaly 連結頁：https://portaly.cc/ailrb

## Facebook 貼文結構（嚴格遵守）

### 第一段：Hook（2-3 句）
用問句、反直覺事實、或生活場景帶入，抓住注意力。不要照抄 IG 的 hook，要重新寫。

### 第二段：節目標題行
用一行清楚標示本集資訊，嚴格遵守以下格式：
📻 EP{集數} {節目名稱}｜{標題}
範例：📻 EP296 系統設計懶懶學｜Uber 系統大揭秘：100萬司機同時在線，泰勒絲演唱會流量也扛得住？

### 第三段：一句話破題
用一句簡短的話帶出這集的核心主題，讓讀者知道接下來要講什麼。

### 第三段：Emoji Bullet Points（核心知識點）
- 每個重點用 emoji 開頭（🚀📍⚡🧠🔒💡🔥 等）
- 每個 bullet 1-2 句話，比 IG 稍微展開一點，加一句白話解釋或比喻
- 每個 bullet 之間空一行，方便閱讀
- 保留 3-5 個最重要的知識點，不需要全部都放

### 第四段：互動引導（1-2 句）
問讀者一個問題或邀請留言討論，語氣輕鬆。

### 第五段：來源參考
先放一行標題「📺 參考資料」，然後列出所有參考影片，格式：
📺 參考資料
▶️ 影片標題 — 作者
  URL
▶️ 影片標題 — 作者
  URL

### 第六段：固定結尾（一字不改）
🎧 完整內容都在 Podcast 裡！
🔗 https://portaly.cc/ailrb

### 最後一行：Hashtags
最多 3 個 hashtag。

## 重要規則
- **不要寫成部落格長文**，保持 bullet point 為主體，段落為輔
- **不要照抄 IG**，要重新改寫措辭，但保留核心知識
- **字數 400-700 字**
- 每篇的 hook 風格要有變化（問句/數據/場景/反直覺）
- emoji 適度使用，不要每句都有

## 輸出格式
直接輸出 Facebook 貼文純文字。
- **禁止使用任何 markdown 語法**：不要用 **粗體**、*斜體*、# 標題、- 列表等。Facebook 不支援 markdown，星號會直接顯示出來。
- 不要加任何說明文字。`;

/**
 * Generate a Facebook caption using LLM, with template fallback.
 */
export async function buildFacebookCaption(opts: BuildCaptionOptions): Promise<string> {
  const { igCaption, sourceLinks, episodeTitle, episodeNumber, segmentType } = opts;

  const isSysdesign = segmentType === 'sysdesign';
  const showLabel = isSysdesign ? '系統設計懶懶學' : 'AI懶人報';
  const epLabel = isSysdesign ? `S${episodeNumber}` : `EP${episodeNumber}`;

  // Build source links text (title + author + url, sorted by views desc)
  const allLinks = sourceLinks
    .filter(s => s.url)
    .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
  const formatLink = (s: SourceLink) => {
    const author = s.channelName ? ` — ${s.channelName}` : '';
    return `- ${s.title || 'Source'}${author}\n  ${s.url}`;
  };
  const linksText = allLinks.length > 0
    ? allLinks.map(formatLink).join('\n')
    : '（無）';

  const userPrompt = `請幫我把以下 IG 貼文改寫成 Facebook 版本。

## 節目資訊
- 節目：${showLabel}
- 集數：${epLabel}
- 標題：${episodeTitle}
- 主題類型：${segmentType}

## IG 原文
${igCaption}

## 本集參考影片（全部列出，附作者）
${linksText}

請嚴格按照 system prompt 的結構產生 Facebook 貼文。`;

  try {
    const { getLLMService } = await import('@/services/llmService');
    const llm = getLLMService();
    const result = await llm.call({
      stage: 'fb_caption',
      episodeNumber,
      messages: [
        { role: 'system', content: FB_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      options: {
        temperature: 0.85,
        maxTokens: 1500,
        preferredModel: 'google/gemini-2.5-flash',
      },
    });

    if (result.success && result.content) {
      log.info({ model: result.model, length: result.content.length }, 'FB caption generated by LLM');
      return result.content.trim();
    }

    log.warn({ error: result.error }, 'LLM failed for FB caption, using template fallback');
  } catch (err) {
    log.warn({ error: (err as Error).message }, 'LLM unavailable for FB caption, using template fallback');
  }

  // Template fallback
  return buildFacebookCaptionTemplate(opts);
}

/** Static template fallback when LLM is unavailable */
function buildFacebookCaptionTemplate(opts: BuildCaptionOptions): string {
  const { igCaption, sourceLinks, episodeTitle, episodeNumber, segmentType } = opts;

  const isSysdesign = segmentType === 'sysdesign';
  const showLabel = isSysdesign ? '系統設計懶懶學' : 'AI懶人報';
  const epLabel = isSysdesign ? `S${episodeNumber}` : `EP${episodeNumber}`;

  // Strip hashtag-heavy lines and IG-specific CTAs
  const cleaned = igCaption
    .split('\n')
    .filter(line => {
      const t = line.trim();
      if (!t) return true;
      if ((t.match(/#\S+/g) || []).length > 3) return false;
      if (/完整拆解都在|快點擊個人檔案|收聽連結|收藏這篇|留言告訴我|收藏起來/.test(t)) return false;
      if (/[｜|](EP|S)\d+/.test(t)) return false;
      return true;
    })
    .join('\n')
    .trim();

  const parts: string[] = [];
  parts.push(cleaned);

  if (sourceLinks.length > 0) {
    const allLinks = sourceLinks
      .filter(s => s.url)
      .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
    if (allLinks.length > 0) {
      const linkLines = allLinks.map(s => {
        const author = s.channelName ? ` — ${s.channelName}` : '';
        return `▶️ ${s.title || 'Source'}${author}\n  ${s.url}`;
      });
      parts.push(`📺 參考資料\n${linkLines.join('\n')}`);
    }
  }

  parts.push(`🎧 完整內容請收聽【${showLabel}｜${epLabel} ${episodeTitle}】\n🔗 https://portaly.cc/ailrb`);
  parts.push('#系統設計 #SystemDesign #軟體架構');

  return parts.join('\n\n');
}
