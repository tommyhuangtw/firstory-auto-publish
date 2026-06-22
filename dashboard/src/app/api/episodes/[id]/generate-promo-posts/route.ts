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
- 括號只用來放簡短的自嘲或吐槽（像「（還是因為太便宜了 XD）」這種口語玩笑），不要用括號放正經的補充說明
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
- 任何 emoji 符號

## AI 文法黑名單（以下用法嚴格禁止，附正確替代）
- ❌「不是…而是」對比句式 → 用更口語的方式，例如「其實重點在…」「說白了就是…」
- ❌「接住」（比喻用法，如「接住這個需求」）→ 用「把握」「抓住機會」「搞定」
- ❌「對齊」（比喻用法，如「跟團隊對齊」）→ 用「統一」「同步」「搞清楚」「確認一下」
- ❌「有點灰」→ 用「有點沮喪」「心情不太好」
- ❌「這筆帳」（比喻用法）→ 避免使用
- ❌「書籤起來」→ 改成「收藏起來」
- ❌「讓人癱瘓」→ 改成「讓人瘋掉」「讓人不知所措」「讓人頭很大」
- ❌「把…抽乾」（如「把創意能量抽乾」）→ 改成「耗盡」「消磨」
- ❌「更大的背景」→ 改成「把背景交代清楚」「先講一下前因後果」
- ❌ 不自然的比喻（如「當成搖搖球在用」）→ 如果一個比喻需要讀者想半天才懂，就不要用，用一般人日常會說的話
- ❌「無痛升級」→ 用「升級起來很順」「升級不會有問題」
- ❌「被打到」→ 用「被嚇到」「被驚艷到」「印象很深」
- ❌「很貼」→ 用「很貼心」「很到位」
- ❌「降維打擊」→ 用「直接輾壓」「完全不是同一個等級」
- ❌「定心丸」→ 用「讓人安心」「讓人放心」
- ❌「不只…還是…」「不只是…而是…」「不需要…只需要」→ AI 最愛的對比句式，禁止使用，直接講重點就好
- ❌「老實說」→ AI 嚴重過度使用，禁止使用。可偶爾用「說真的」「坦白講」替代，整篇最多一次
- ❌「坐不住」→ 用「等不及」「忍不住」「太興奮了」

## 文字要完整自然、不要硬縮字
- 寧可多幾個字，也要讓句子讀起來像正常人在講話，不要為了精簡而壓縮用詞（例如「跳過步驟」不要縮成「跳步驟」、「很穩定」不要縮成「很穩」、「支撐得住」不要縮成「撐得住」）

## AI 常見文體通病（自我檢查）
- 不要用文藝腔或詩意化的方式描述日常事物
- 不要把簡單的事情用複雜的比喻包裝（要用比喻，確認是台灣人日常會說的比喻）`;

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

// ── Step 1 (alt): Generate multiple-choice questions ──

const CHOICES_SYSTEM_PROMPT = `你是一個資深社群行銷顧問。你要根據 Podcast 這集的內容，設計 3 個「選擇題」，讓作者用最快的方式選出自己的立場和角度，之後你就能寫出一篇有他個人觀點的 Threads 貼文。

## 出題原則
- 問題要具體，扣緊這集的實際內容，不要空泛
- 第一題：問他自己或身邊的人跟這集內容相關的經驗或場景
- 第二題：問他對這集某個觀點的個人立場
- 第三題：問他聽完之後最想帶給朋友的一個重點或角度
- 每題給 3-4 個貼合內容、彼此有區別的選項，讓作者一看就知道哪個最像自己
- 選項用第一人稱、口語化，像作者自己會講的話，一句話以內
- 不要在選項裡放「其他」或「以上皆是」，前端會自動提供自由填寫欄

## 輸出格式
嚴格輸出 JSON array，不要加 markdown code fence：
[
  { "question": "問題一", "options": ["選項A", "選項B", "選項C"] },
  { "question": "問題二", "options": ["選項A", "選項B", "選項C", "選項D"] },
  { "question": "問題三", "options": ["選項A", "選項B", "選項C"] }
]`;

// ── Step 2: Generate post ──

const GENERATE_SYSTEM_PROMPT = `你是這個 Podcast 的主理人本人，在 Threads 上寫一則貼文。你的文字像朋友在聊天，不像品牌在發廣告。

## 任務
從這集內容裡挑出「一個」最讓人 wow、最值得深入聊的 insight，寫成 1 則有深度、有人味的 Threads 貼文。定位是「深入解析」：不是整集摘要，而是抓住一個點把它講透、講出你的看法，讓讀者讀完覺得「這個人有在想事情」，並且因此跟你產生 connection。

## 寫作策略
- 只聚焦「一個」核心 insight，不要貪心想塞滿整集重點。一個點講深，勝過五個點講淺
- 這個 insight 不需要是驚天動地的大事，只要是這集裡讓你自己也覺得「喔這個有意思」的點就好
- 用你自己的視角去解析它：為什麼這個點重要、它跟一般人的直覺哪裡不同、你怎麼看
- 適度帶入你的真實經驗、觀察或立場，讓內容有體溫、有「你」這個人，而不是中立的知識搬運
- 貼文正文要有獨立的價值，讀完就有收穫，不是 podcast 的預告片
- 結尾自然收到 podcast，例如「這些我在最新一集有聊得更細」「有興趣的話我在 podcast 裡講了完整的思路」，語氣像朋友推薦，不像廣告

## 作者的語氣與風格（請模仿，這是這個帳號的個人品牌聲音）
- 開場隨性、個人化：用時間點或當下的個人狀態切入（例如「好久沒發文」「最近…」「差不多兩年前…」），不要正經破題或結論先行
- 第一人稱、誠實、有溫度：敢講自己真實的心境，甚至自曝弱點或不確定，不裝專家、不端架子
- 自嘲式幽默：適時吐槽自己，可以用「XD」「xd」這種口語標記，讓人覺得你是個真人
- 中英夾雜，技術詞保留英文：像 MCP、Agent、Workflow、package、on-site 這類詞直接用英文，不要硬翻成中文
- 說故事用超具體、有畫面的細節：與其說「過得很愜意」，不如寫出「早上先去爆騎風櫃嘴，下山來碗蛋餅鐵板麵大冰奶」這種有畫面的細節
- 台灣口語、生活感：用台灣人日常會講的話（例如「涼涼了」「卯起來」「搞」「先接再說」），不要書面腔
- 結尾收斂出一個有溫度的體悟或觀點，再自然帶一句 CTA（像「歡迎追蹤起來」「推薦給在關注 X 的朋友」），CTA 像朋友邀請，不像廣告
- 概念多的時候可以用條列（- 開頭）讓人好讀

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
  // mode: 'questions' (free-text Q&A) | 'choices' (multiple-choice) | 'generate'
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

    } else if (mode === 'choices') {
      // ── Step 1 (alt): Multiple-choice questions ──
      const userPrompt = `## 節目資訊
- 節目：${showLabel}
- 標題：${episode.selected_title || '(未定)'}

## 這集的內容
${content}

請根據以上內容，設計 3 個選擇題。`;

      const result = await llm.call({
        stage: 'promo_choices',
        episodeId,
        episodeNumber: episode.episode_number,
        messages: [
          { role: 'system', content: CHOICES_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        options: {
          temperature: 0.7,
          maxTokens: 800,
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

      const choices = JSON.parse(cleaned);
      if (!Array.isArray(choices) || choices.length === 0 ||
          !choices.every((c) => c && typeof c.question === 'string' && Array.isArray(c.options))) {
        throw new Error('Invalid choices format');
      }

      log.info({ episodeId, count: choices.length, model: result.model }, 'Promo choices generated');
      return NextResponse.json({ choices });

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
