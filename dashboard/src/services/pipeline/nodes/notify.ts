/**
 * Stage 10: Notify — IG Caption Agent + Email Newsletter Agent + post/send.
 *
 * Matches n8n IG貼文文案撰寫Agent and Email週報內容產生Agent + HTML郵件格式化Agent.
 * Each notification channel is independent — one failure doesn't block the other.
 */

import { getLLMService } from '@/services/llmService';
import { createChildLogger } from '@/lib/logger';
import { getDb } from '@/db';
import type { PipelineState } from '../state';

const log = createChildLogger('pipeline:notify');

const FLASH_MODEL = 'google/gemini-3-flash-preview';

export async function notify(state: PipelineState): Promise<Partial<PipelineState>> {
  log.info({ episodeId: state.episodeId }, 'Sending notifications');

  const results: Partial<PipelineState> = { status: 'pending_review' };

  // ── Instagram: Generate caption only (posting happens at publish time) ──
  try {
    const caption = await generateIgCaption(state);
    results.igCaption = caption;

    // Persist caption to DB for review
    getDb().prepare('UPDATE episodes SET ig_caption = ? WHERE id = ?')
      .run(caption, state.episodeId);
    log.info({ captionLength: caption.length }, 'IG caption generated (will post at publish time)');
  } catch (error) {
    log.error({ error: (error as Error).message }, 'IG caption generation failed');
  }

  // ── Email: Newsletter Agent + HTML Formatter Agent + send ──
  try {
    if (process.env.RECIPIENT_EMAIL) {
      const emailHtml = await generateEmailHtml(state);

      // Append IG cover image + caption to email for review
      const coverImageSection = state.coverUrl
        ? `<div style="margin-top:20px;text-align:center;">
<h3 style="font-size:14px;color:#333;margin:0 0 8px;">IG 封面預覽</h3>
<img src="${state.coverUrl}" width="300" style="border-radius:8px;" />
</div>`
        : '';
      const igCaptionSection = results.igCaption
        ? `<div style="background:#f5f5f5;padding:16px;border-radius:8px;margin-top:12px;">
<h3 style="margin:0 0 8px;font-size:14px;color:#333;">IG 貼文預覽（待審核）</h3>
<pre style="white-space:pre-wrap;font-size:13px;color:#555;margin:0;">${results.igCaption}</pre>
</div>`
        : '';
      const fullEmailHtml = emailHtml + '<hr>' + coverImageSection + igCaptionSection;
      results.emailHtml = fullEmailHtml;

      const { getGmailService } = await import('@/services/gmail');
      const gmail = getGmailService();
      await gmail.initialize();

      const today = new Date().toISOString().split('T')[0];
      const isRobot = state.segmentType === 'robot';
      const isWeekly = state.segmentType === 'weekly';
      const isSysdesignEmail = state.segmentType === 'sysdesign';
      const subject = isSysdesignEmail
        ? `[${today}] AI懶人報：系統架構懶懶學`
        : isRobot
        ? `[${today}] AI懶人報：機器人觀察週報`
        : isWeekly
        ? `[${today}] AI懶人精選週報`
        : `[${today}] AI懶人報精選`;

      await gmail.sendRawHtml({
        to: process.env.RECIPIENT_EMAIL,
        subject,
        html: fullEmailHtml,
      });
      log.info('Email newsletter sent (with IG caption preview)');
    } else {
      log.info('Skipping Gmail (RECIPIENT_EMAIL not set)');
    }
  } catch (error) {
    log.error({ error: (error as Error).message }, 'Gmail report failed');
  }

  return results;
}

// n8n exact prompt for IG貼文文案撰寫Agent
async function generateIgCaption(state: PipelineState): Promise<string> {
  const videos = (state.selectedVideos || []).map(v => ({ title: v.title, viewCount: v.viewCount }));
  return regenerateIgCaption(
    state.segmentType,
    state.igScenario,
    videos,
    state.episodeId,
    state.scriptSummary,
  );
}

/** Reusable IG caption generation — can be called from API for regeneration */
export async function regenerateIgCaption(
  segmentType: string,
  igScenario: string,
  selectedVideos: { title: string; viewCount: number }[],
  episodeId: number,
  scriptSummary?: string,
): Promise<string> {
  const llm = getLLMService();
  const isRobot = segmentType === 'robot';
  const isSysdesign = segmentType === 'sysdesign';
  const scenario = igScenario || '湯懶懶躺在沙發上用 AI 自動處理所有工作';

  // Prefer script summary (accurate Chinese content) over video titles (English, prone to hallucination)
  let podcastSummary: string;
  if (scriptSummary) {
    podcastSummary = scriptSummary;
  } else if (episodeId) {
    // Try to load from DB
    try {
      const db = getDb();
      const row = db.prepare('SELECT script_summary FROM episodes WHERE id = ?')
        .get(episodeId) as { script_summary: string | null } | undefined;
      if (row?.script_summary) {
        podcastSummary = row.script_summary;
      } else {
        // Fallback to video titles
        podcastSummary = (selectedVideos || [])
          .map((v) => `${v.title} (${v.viewCount.toLocaleString()} views)`)
          .join('\n');
      }
    } catch {
      podcastSummary = (selectedVideos || [])
        .map((v) => `${v.title} (${v.viewCount.toLocaleString()} views)`)
        .join('\n');
    }
  } else {
    podcastSummary = (selectedVideos || [])
      .map((v) => `${v.title} (${v.viewCount.toLocaleString()} views)`)
      .join('\n');
  }

  const userPrompt = `湯懶懶情境： ${scenario}
Podcast總結（IG貼文要用中文輸出 可保留重點公司或是工具名稱為英文）:
${podcastSummary}`;

  const sysdesignSystemPrompt = `你是一位專業經營 Instagram 的貼文寫手，專為品牌角色「湯懶懶」——一隻靠 AI 翻轉人生、懶得優雅又略帶聰明感的樹懶——創作高資訊密度、輕鬆口吻又具實用價值的 IG 圖文貼文(中文)。

🎯 任務目標
根據提供的系統設計 Podcast 內容摘要，生成一則以系統架構知識為主軸的貼文，適合吸引工程師、準備面試的人在 IG 上閱讀、收藏與互動。

📝 貼文結構（用自然段落分隔，禁止使用 1. 2. 3. 編號）：

開場 hook（1～2 句）
用湯懶懶的口吻帶出本集的系統名稱或核心問題，引起好奇心。語氣慵懶、聰明、有點廢又可愛。
範例：
「Netflix 怎麼撐住全球兩億人同時追劇的？湯懶懶拆給你看 🦥」
「面試官問你 Uber 怎麼設計，你是不是又腦袋空白了 🧠」

一句鋪墊（1 句）
簡短交代今天拆解了什麼 + 為什麼值得知道，讓讀者有心理準備接收技術重點。

🏗️ 架構亮點
用 3-5 個重點，每個重點以 emoji 開頭，直接接內容描述。
保留英文術語（load balancer, consistent hashing, sharding, message queue, CDN 等）。
每個重點控制在 1-2 句，用口語化的方式解釋，像在跟朋友聊天。
✅ 重點應簡單、明確、有條理
⛔ 禁止使用 **粗體標題** 或任何 markdown 格式（IG 不支援）
⛔ 禁止「標題：說明」的格式（如「WebSocket 長連線取代輪詢：別再讓手機...」），直接寫成一段話
⛔ 禁止廢話或轉場語

好的範例：
🚀 Uber 用 WebSocket 長連線讓伺服器主動推播司機位置，不用手機一直問「他到哪了」，省下超多無效流量
📍 地理位置靠 Geohash 把二維座標壓成一維字串，毫秒內就能鎖定附近的司機

不好的範例（禁止）：
🚀 **WebSocket 長連線取代輪詢**：別再讓手機一直問「司機在哪」了...

🎧 Podcast 導流句（1～2 句）
用湯懶懶口吻推薦到主頁聽完整 Podcast，像朋友聊天不像廣告。
範例：「完整拆解都在 Podcast 裡了，懶人教主幫你整理好了 🦥👉」

互動引導（1 句 CTA）
輕鬆互動句，引導留言或收藏。

Hashtag（壓縮成一整段，禁止換行）
請從下列混合挑選 8~12 個：
#系統設計 #SystemDesign #軟體架構 #面試準備 #後端工程師 #分散式系統 #AI懶人報 #系統架構懶懶學 #湯懶懶日記 #SlothVibes #科技職涯 #工程師日常

注意！！
只需要輸出IG貼文內容，不需要其他不必要的文字`;

  const systemPrompt = isSysdesign
    ? sysdesignSystemPrompt
    : isRobot
    ? `你是一位專業經營 Instagram 的貼文寫手，專為品牌角色「湯懶懶」——一隻靠 AI 翻轉人生、懶得優雅又略帶聰明感的樹懶——創作高資訊密度、輕鬆口吻又具實用價值的 IG 圖文貼文(中文)。

🎯 任務目標
根據提供的 5 則 YouTube 影片摘要（每則包含標題與重點內容），生成一則以影片重點為主軸的貼文，適合吸引 AI 工具愛好者在 IG 上閱讀、收藏與互動。

📥 輸入素材包含：
• 湯懶懶當日一句"生活情境"
• 5 則 Robotics 相關影片摘要
• Podcast 標題與連結

📝 貼文結構請遵守以下格式：

1. 開場 murmur（限 1～2 句）
簡短說明湯懶懶今天的情境或狀態，像是：「今天懶到只想聽 AI 講幹話，但這幾支影片我竟然聽完了 😪」或「剛滑完這幾支影片，我的偷懶大腦瞬間升級 🧠✨」
⛔ 請避免超過 3 句、不需描述過多生活細節、不要成為主軸。

2. 🎥 今日機器人更新整理（每則影片三行重點描述，禁止加入湯懶懶 murmur 或評語）
請以 emoji 開頭，每則重點包含：
一行：影片標題（不加 # 或編號）（注意要用中文！！！）
兩行：機器人產業的主要更新與亮點、用途場景，為什麼需要知道，務必清楚、實用、有感（注意要用中文！！！）
✅ 重點應簡單、明確、有條理、每個重點之間要有空行
⛔ 禁止使用湯懶懶口吻、廢話、轉場語或任何非資訊性內容

3. 🎧 Podcast 導流句（1～2 句）
請自然銜接語氣，推薦讀者到 IG 主頁點連結聽完整 Podcast。語氣像朋友聊天，不要寫成廣告。

範例：
「懶人秘笈都在 Podcast 裡了，點主頁Link就能聽 🦥👉」

4. Call-To-Action（互動引導）
請加入一段輕鬆互動句，引導留言。

5. Hashtag（請壓縮成一整段，禁止換行）
需要從影片重點hashtag重點關鍵字 關鍵公司 或是關鍵工具
此外請從下列分類混合挑選 8~12 個，使用空格分隔：

#AI工具 #生成式AI #ChatGPT #Claude #GoogleAI #AI懶人報 #懶人創業 #自動化工作術 #免費工具 #SlothVibes #湯懶懶日記 #AI機器人 #無人機 #自動駕駛

注意！！
只需要輸出IG貼文內容，不需要其他不必要的文字`
    : `你是一位專業經營 Instagram 的貼文寫手，專為品牌角色「湯懶懶」——一隻靠 AI 翻轉人生、懶得優雅又略帶聰明感的樹懶——創作高資訊密度、輕鬆口吻又具實用價值的 IG 圖文貼文(中文)。

🎯 任務目標
根據提供的 5 則 YouTube 影片摘要（每則包含標題與重點內容），生成一則以影片重點為主軸的貼文，適合吸引 AI 工具愛好者在 IG 上閱讀、收藏與互動。

📥 輸入素材包含：
• 湯懶懶當日一句"生活情境"
• 5 則 AI 工具影片摘要
• Podcast 標題與連結

📝 貼文結構請遵守以下格式：

1. 開場 murmur（限 1～2 句）
簡短說明湯懶懶今天的情境或狀態，像是：「今天懶到只想聽 AI 講幹話，但這幾支影片我竟然聽完了 😪」或「剛滑完這幾支影片，我的偷懶大腦瞬間升級 🧠✨」
⛔ 請避免超過 3 句、不需描述過多生活細節、不要成為主軸。

2. 🎥 今日AI工具整理（每則影片三行重點描述，禁止加入湯懶懶 murmur 或評語）
請以 emoji 開頭，每則重點包含：
一行：影片標題（不加 # 或編號）（注意要用中文！！！）
兩行：工具的主要功能與亮點、用途場景或使用後的效果，務必清楚、實用、有感（注意要用中文！！！）
✅ 重點應簡單、明確、有條理、每個重點之間要有空行
⛔ 禁止使用湯懶懶口吻、廢話、轉場語或任何非資訊性內容

3. 🎧 Podcast 導流句（1～2 句）
請自然銜接語氣，推薦讀者到 IG 主頁點連結聽完整 Podcast。語氣像朋友聊天，不要寫成廣告。

4. Call-To-Action（互動引導）
請加入一段輕鬆互動句，引導留言。

5. Hashtag（請壓縮成一整段，禁止換行）
需要從影片重點hashtag重點關鍵字 關鍵公司 或是關鍵工具
請從下列分類混合挑選 8~12 個，使用空格分隔：

#AI工具 #生成式AI #ChatGPT #Claude #GoogleAI #AI懶人報 #懶人創業 #自動化工作術 #免費工具 #SlothVibes #湯懶懶日記

注意！！
只需要輸出IG貼文內容，不需要其他不必要的文字`;

  const result = await llm.call({
    stage: 'ig_caption',
    episodeId,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    options: {
      preferredModel: FLASH_MODEL,
      maxTokens: 2048,
      temperature: 0.7,
    },
  });

  if (result.success && result.content) {
    return result.content;
  }

  // Fallback simple caption
  return `AI懶人報\n\n#AI懶人報 #Podcast #AI工具`;
}

// n8n exact prompts for Email週報內容產生Agent + HTML郵件格式化Agent
async function generateEmailHtml(state: PipelineState): Promise<string> {
  const llm = getLLMService();
  const today = new Date().toISOString().split('T')[0];
  const isRobot = state.segmentType === 'robot';
  const isWeekly = state.segmentType === 'weekly';

  // Build video metadata for email (YouTube links, stats)
  const videoMetadata = (state.selectedVideos || [])
    .map((v) => JSON.stringify({
      title: v.title,
      channelName: v.channelName,
      viewCount: v.viewCount,
      likeCount: v.likeCount,
      commentCount: v.commentCount,
      publishedAt: v.publishedAt,
      videoId: v.videoId,
    }))
    .join('\n');

  // Use script summary for accurate Chinese content descriptions
  const scriptSummary = state.scriptSummary || '';

  const podcastUrl = state.driveAudioUrl || '';

  // Step 1: Email content agent
  const isSysdesignContent = state.segmentType === 'sysdesign';
  const contentSystemPrompt = isSysdesignContent
    ? `你是一位專業的系統設計教學內容編輯，擅長將系統架構概念轉換為結構清晰、有趣易讀的繁體中文摘要。在本任務中，你的角色是《系統架構懶懶學》的 Email 週報編輯助理。

🎯 任務目標：
請根據提供的 Podcast 內容摘要，撰寫一段結構清晰的繁體中文週報，介紹本集討論的系統設計主題。

📤 請使用以下格式輸出週報：

開場白段落：以勾起好奇心的語氣開場，帶出系統設計主題

🎧 Podcast 連結: ${podcastUrl}

🏗️ System Design Deep Dive 🔧✨

核心架構重點（3-5 個 bullet points）

📎 參考資料：
列出原始影片連結

✨ 語氣：像一位資深工程師朋友在幫你摘重點`
    : isRobot
    ? `你是一位專業的中英雙語內容翻譯與在地化專家，專門處理 Robotics、AI 機器人與自動化技術相關內容，擅長將英文影片資訊轉換為自然、口語化且適合台灣讀者閱讀的繁體中文摘要。在本任務中，你的角色是《Robotics Power Plays：每週精選》的 Email 週報編輯助理。

🎯 任務目標：
請根據輸入的 JSON 格式內容（包含五部影片的摘要資料），撰寫一段結構清晰、有趣易讀的繁體中文週報內容，統整過去一週內最具話題性的機器人產業與技術更新影片。

**⚠️ 請務必注意：即使影片主題相近，也「不可合併」、「不可刪除」任何一部影片，**請依據提供的五筆資料，完整輸出五條影片摘要。

📤 請使用以下格式輸出週報：

開場白段落：以勾起好奇心的語氣開場，介紹近期機器人產業的趨勢與熱度

🎧Podcast 連結: ${podcastUrl}

🤖 Robotics Power Plays of the Week 🔧✨

影片列表段落（總共五則，請逐一列出）：
每則影片以 - 開頭，格式如下：
💡 [一句創意摘要]
📅 發佈日: [YYYY-MM-DD]
📊 Views: [觀看數] 👍 Likes: [按讚數] 💬 Comments: [留言數]
[YouTube 原始網址]

✨ 口吻與語氣要求：語氣自然、觀察型，像一位機器人產業的朋友在幫你推薦值得關注的最新動態`
    : isWeekly
    ? `你是一位專業的中英雙語內容翻譯與在地化專家，專門處理 AI、科技工具與自動化影片相關內容，擅長將英文影片資訊轉換為自然、口語化且適合台灣讀者閱讀的繁體中文摘要。在本任務中，你的角色是《AI懶人精選週報》的 Email 週報編輯助理。

🎯 任務目標：
請根據輸入的 JSON 格式內容（包含五部影片的摘要資料），撰寫一段結構清晰、有趣易讀的繁體中文週報內容，統整過去一週內最具實用性與話題性的 AI 工具影片。

**⚠️ 請務必注意：即使影片主題相近，也「不可合併」、「不可刪除」任何一部影片，**請依據提供的五筆資料，完整輸出五條影片摘要。

📤 請使用以下格式輸出週報：

開場白段落：以勾起好奇心的語氣開場，介紹近期 AI 工具熱度

🎧Podcast 連結: ${podcastUrl}

🛠️ AI Trends of the Week 🔧✨

影片列表段落（總共五則，請逐一列出）：
每則影片以 - 開頭，格式如下：
💡 [一句創意摘要]
📅 發佈日: [YYYY-MM-DD]
📊 Views: [觀看數] 👍 Likes: [按讚數] 💬 Comments: [留言數]
[YouTube 原始網址]

✨ 口吻與語氣要求：語氣自然、觀察型，像一位 AI 熟人朋友在幫你推薦實用好影片`
    : `你是一位專業的中英雙語內容翻譯與在地化專家，專門處理 AI、科技工具與自動化影片相關內容，擅長將英文影片資訊轉換為自然、口語化且適合台灣讀者閱讀的繁體中文摘要。在本任務中，你的角色是《AI Power Plays：每週精選》的 Email 週報編輯助理。

🎯 任務目標：
請根據輸入的 JSON 格式內容（包含五部影片的摘要資料），撰寫一段結構清晰、有趣易讀的繁體中文週報內容，統整過去三週內最具實用性與話題性的 AI 工具影片。

**⚠️ 請務必注意：即使影片主題相近，也「不可合併」、「不可刪除」任何一部影片，**請依據提供的五筆資料，完整輸出五條影片摘要。

📤 請使用以下格式輸出週報：

開場白段落：以勾起好奇心的語氣開場，介紹近期 AI 工具熱度

🎧Podcast 連結: ${podcastUrl}

🛠️ AI Power Plays of the Week 🔧✨

影片列表段落（總共五則，請逐一列出）：
每則影片以 - 開頭，格式如下：
💡 [一句創意摘要]
📅 發佈日: [YYYY-MM-DD]
📊 Views: [觀看數] 👍 Likes: [按讚數] 💬 Comments: [留言數]
[YouTube 原始網址]

✨ 口吻與語氣要求：語氣自然、觀察型，像一位 AI 熟人朋友在幫你推薦實用好影片`;

  const contentUserPrompt = `今天是 ${today}
這是本集的中文 Podcast 連結：${podcastUrl}

以下是本集 Podcast 內容摘要（請根據此摘要撰寫中文描述，確保工具名稱和版本號正確）：
${scriptSummary}

以下是影片 metadata（請用來填寫觀看數、按讚數、留言數、YouTube 連結等）：
${videoMetadata}`;

  const contentResult = await llm.call({
    stage: 'email_content',
    episodeId: state.episodeId,
    messages: [
      { role: 'system', content: contentSystemPrompt },
      { role: 'user', content: contentUserPrompt },
    ],
    options: {
      preferredModel: FLASH_MODEL,
      maxTokens: 2048,
      temperature: 0.7,
    },
  });

  if (!contentResult.success || !contentResult.content) {
    log.warn('Email content generation failed');
    return buildFallbackEmailHtml(state);
  }

  // Step 2: HTML formatting agent
  const htmlSystemPrompt = `你是一位專業的 AI 工具整合分析師與 HTML 電子報排版專家。

請根據以下的每日 AI 工具摘要內容，產出一段 Gmail 可用的 HTML 內容，格式整齊、可直接貼入電子報中作為 Email 內文。請使用標準 HTML 元素排版，不要回傳 JSON、Markdown 或多餘解釋。

📌 輸出格式規則：
✅ 使用標準 HTML 標籤組成一段完整的 <div>...</div> 結構，排版清楚、可閱讀���

✅ 必須包含以下內容：

🪄 開場段落（出現在最上方）：
中文開場白一段（用輕鬆語氣回顧近期 AI 趨勢）

接上 Podcast 中文連結

🖼️ 每支影片段落格式如下：
影片標題（加粗 <strong>）
一段簡介內容（不可重複影片標題）
📅 發佈日期
📊 觀看數、👍 喜歡數、💬 留言數
YouTube 連結直接顯示

📎 Email 結尾段補充：
<hr>
<p style="font-size:14px; color:#555;">🦥 感謝你今天收看 <strong>AI 懶人報</strong>，每天幫你整理最新、最實用的 AI 工具，輕鬆掌握 AI 新趨勢，我們明天見！</p>
<p><img src="https://drive.google.com/uc?export=view&id=12hqlun6rvqAA5DGfNCNP2bQs9zumsT_l" width="100" /></p>`;

  const htmlResult = await llm.call({
    stage: 'email_html',
    episodeId: state.episodeId,
    messages: [
      { role: 'system', content: htmlSystemPrompt },
      { role: 'user', content: `請處理這段輸入：${contentResult.content}` },
    ],
    options: {
      preferredModel: FLASH_MODEL,
      maxTokens: 4096,
      temperature: 0.5,
    },
  });

  if (htmlResult.success && htmlResult.content) {
    // Extract HTML div block if wrapped in markdown
    const divMatch = htmlResult.content.match(/<div[\s\S]*<\/div>/i);
    return divMatch ? divMatch[0] : htmlResult.content;
  }

  return buildFallbackEmailHtml(state);
}

function buildFallbackEmailHtml(state: PipelineState): string {
  const title = state.selectedTitle || 'AI懶人報';
  const desc = state.description || '';
  const videos = (state.selectedVideos || []).slice(0, 5)
    .map((v) => `<p><strong>${v.title}</strong><br>${v.channelName} · ${v.viewCount.toLocaleString()} views</p>`)
    .join('');

  return `<div>
<h2>AI 懶人報 - ${title}</h2>
<p>${desc}</p>
${videos}
<hr>
<p style="font-size:14px; color:#555;">🦥 感謝你今天收看 <strong>AI 懶人報</strong>，每天幫你整理最新、最實用的 AI 工具，輕鬆掌握 AI 新趨勢，我們明天見！</p>
<p><img src="https://drive.google.com/uc?export=view&id=12hqlun6rvqAA5DGfNCNP2bQs9zumsT_l" width="100" /></p>
</div>`;
}
