import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('api:generate-promo-posts');

// ── Shared rules ──

const WRITING_RULES = `## 寫作規則
- 繁體中文，口語化，像真人在 Threads 上講話
- 每則 300-450 字（含空格和換行）
- 開頭第一句話就要抓住人，不要鋪陳
- 適度用換行增加閱讀節奏，但不要每句都換行
- 不要使用任何 emoji
- 不要使用破折號（——）
- 不要使用括號補充說明，直接寫進句子裡
- 貼文本身要有獨立價值，讀完就有收穫
- 結尾最後一兩句自然地帶到「我在 podcast 裡有更完整的拆解」或類似語句，像是朋友在聊天時順口提到，不要用「歡迎收聽」這種廣告語氣
- 要有觀點、有立場，不要兩邊都不得罪的廢話
- 不要用 hashtag

## 禁用句式和詞彙（絕對不能出現）
- 「這不是 X，而是 Y」的句式
- 「超到位」「到位」
- 革命性、顛覆、無縫、賦能、一站式、全方位、生態系、賽道、風口、降維打擊
- 底層邏輯、頂層設計、抓手、閉環、打通、鏈路、觸達、心智、破圈、種草
- 拉齊、對齊、沉澱、復盤、迭代、深耕、佈局、卡位、All-in
- 不可思議、令人驚嘆、game changer、next level、深度解析、一文看懂
- 乾貨滿滿、建議收藏、看完秒懂
- 崩潰、徹底、最瘋狂的是、演示、誇張、瘋狂
- 任何 emoji 符號`;

// ── Step 1: Generate questions ──

const QUESTIONS_SYSTEM_PROMPT = `你是一個資深社群行銷顧問。你要根據 Podcast 這集的內容，問作者 3 個問題，讓他回答後你能寫出一篇有他個人觀點和真實經驗的 Threads 貼文。

## 提問原則
- 問題要具體，不要問「你覺得怎麼樣」這種空泛的問題
- 第一題：問他自己或身邊的人有沒有遇過這集內容相關的困擾或場景
- 第二題：問他對這集某個觀點的個人立場或不同看法
- 第三題：問他聽完之後最想告訴朋友的一件事是什麼
- 每個問題用一句話，不要解釋為什麼問

## 輸出格式
嚴格輸出 JSON array，不要加 markdown code fence：
["問題一", "問題二", "問題三"]`;

// ── Step 2: Generate post ──

const GENERATE_SYSTEM_PROMPT = `你是一個 Threads 社群行銷寫手。你的文字像朋友在聊天，不像品牌在發廣告。

## 任務
根據 Podcast 內容和作者對問題的回答，寫出 1 則 Threads 貼文。這則貼文要讓人讀完覺得「這個人有在想事情」，而不是「又一個在推 podcast 的」。

## 寫作策略
- 從作者的真實經驗或觀點切入，不是從 podcast 內容摘要切入
- 先講痛點或故事，讓讀者產生共鳴，再帶出你的觀察
- 貼文正文要有獨立的價值，不是 podcast 的預告片
- 結尾自然收到 podcast，例如「這些我在最新一集有聊得更細」「有興趣的話我在 podcast 裡講了完整的思路」，語氣像朋友推薦，不像廣告

${WRITING_RULES}

## 輸出格式
嚴格輸出 JSON object，不要加 markdown code fence：
{
  "targetAudience": "目標受眾，3-8字",
  "body": "完整貼文內容，300-450字"
}`;

// ── Helpers ──

interface Episode {
  id: number;
  episode_number: number | null;
  segment_type: string;
  selected_title: string | null;
  script_zh: string | null;
  description: string | null;
  tags: string | null;
}

const SEGMENT_LABELS: Record<string, string> = {
  daily: 'AI懶人報',
  weekly: 'AI精選週報',
  robot: '機器人週報',
  sysdesign: '系統設計懶懶學',
  quickchat: '懶懶碎碎念',
};

function getEpisodeContent(episode: Episode) {
  const showLabel = SEGMENT_LABELS[episode.segment_type] || 'AI懶人報';
  const tags = episode.tags ? JSON.parse(episode.tags) : [];
  const content = episode.script_zh
    ? episode.script_zh.slice(0, 3000)
    : episode.description || '';
  return { showLabel, tags, content };
}

// ── Route ──

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const episodeId = parseInt(id);
  if (isNaN(episodeId)) {
    return NextResponse.json({ error: 'Invalid episode id' }, { status: 400 });
  }

  const db = getDb();
  const episode = db.prepare(
    'SELECT id, episode_number, segment_type, selected_title, script_zh, description, tags FROM episodes WHERE id = ?'
  ).get(episodeId) as Episode | undefined;

  if (!episode) {
    return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
  }

  if (!episode.script_zh && !episode.description) {
    return NextResponse.json({ error: '需要有腳本或描述才能生成行銷貼文' }, { status: 400 });
  }

  let body: { mode?: string; answers?: string[] } = {};
  try {
    body = await request.json();
  } catch { /* empty body is fine for questions mode */ }

  const mode = body.mode || 'questions';
  const { showLabel, tags, content } = getEpisodeContent(episode);
  const { getLLMService } = await import('@/services/llmService');
  const llm = getLLMService();

  try {
    if (mode === 'questions') {
      // ── Step 1: Ask questions ──
      const userPrompt = `## 節目資訊
- 節目：${showLabel}
- 標題：${episode.selected_title || '(未定)'}

## 這集的內容
${content}

請根據以上內容，問作者 3 個問題。`;

      const result = await llm.call({
        stage: 'promo_questions',
        episodeId,
        episodeNumber: episode.episode_number,
        messages: [
          { role: 'system', content: QUESTIONS_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        options: {
          temperature: 0.7,
          maxTokens: 500,
          preferredModel: 'google/gemini-3.1-flash-lite-preview',
        },
      });

      if (!result.success || !result.content) {
        throw new Error(result.error || 'LLM call failed');
      }

      let cleaned = result.content.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      const questions = JSON.parse(cleaned);
      if (!Array.isArray(questions) || questions.length === 0) {
        throw new Error('Invalid questions format');
      }

      log.info({ episodeId, count: questions.length, model: result.model }, 'Promo questions generated');
      return NextResponse.json({ questions });

    } else {
      // ── Step 2: Generate post from answers ──
      const answers = body.answers || [];

      const answersSection = answers.length > 0
        ? `\n## 作者的回答（用第一人稱融入貼文）\n${answers.map((a, i) => `Q${i + 1}: ${a}`).join('\n')}\n`
        : '';

      const userPrompt = `## 節目資訊
- 節目：${showLabel}
- 標題：${episode.selected_title || '(未定)'}
- 標籤：${tags.length > 0 ? tags.join('、') : '無'}
${answersSection}
## 這集的內容
${content}

請根據以上內容和作者的回答，生成 1 則 Threads 貼文。`;

      const MAX_CHARS = 450;
      const MAX_RETRIES = 2;
      let post: { targetAudience: string; body: string } | null = null;
      const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        { role: 'system', content: GENERATE_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ];

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const result = await llm.call({
          stage: 'promo_posts',
          episodeId,
          episodeNumber: episode.episode_number,
          messages,
          options: {
            temperature: 0.9,
            maxTokens: 2000,
            preferredModel: 'google/gemini-3.1-flash-lite-preview',
          },
        });

        if (!result.success || !result.content) {
          throw new Error(result.error || 'LLM call failed');
        }

        let cleaned = result.content.trim();
        if (cleaned.startsWith('```')) {
          cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }

        post = JSON.parse(cleaned);
        if (!post?.body) {
          throw new Error('Invalid post format');
        }

        if (post.body.length <= MAX_CHARS) {
          log.info({ episodeId, model: result.model, chars: post.body.length, attempt }, 'Promo post generated');
          break;
        }

        // Over limit — ask LLM to condense
        if (attempt < MAX_RETRIES) {
          log.info({ episodeId, chars: post.body.length, attempt }, 'Post over limit, requesting condensed version');
          messages.push(
            { role: 'assistant', content: result.content },
            { role: 'user', content: `這則貼文有 ${post.body.length} 字，超過 ${MAX_CHARS} 字的限制了。請精簡內容，刪掉不必要的形容詞和重複的概念，保留核心觀點和故事，控制在 ${MAX_CHARS} 字以內。一樣輸出 JSON format。` },
          );
        } else {
          log.warn({ episodeId, chars: post.body.length }, 'Post still over limit after retries');
        }
      }

      return NextResponse.json({ post });
    }
  } catch (error) {
    log.error({ episodeId, error: (error as Error).message }, 'Failed in promo post flow');
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
