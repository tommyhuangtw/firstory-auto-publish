import { NextRequest, NextResponse } from 'next/server';

const CATEGORIES = ['content', 'infra', 'social_media', 'youtube', 'ig', 'threads', 'research', 'ops', 'growth'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

export async function POST(request: NextRequest) {
  const { input } = await request.json();

  if (!input?.trim()) {
    return NextResponse.json({ error: 'input is required' }, { status: 400 });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'OPENROUTER_API_KEY not set' }, { status: 500 });
  }

  const prompt = `你是一個 Podcast 產製系統的 PM。使用者用口語描述了一個任務，請把它整理成結構化的 ticket。

使用者輸入：
${input}

請根據以下規則輸出 JSON：
- title: 簡潔的任務標題（15 字以內，中文或英文皆可）
- description: 詳細說明，包含目標、實作方式、驗收條件（3-6 行）
- priority: 根據緊迫度選擇 ${PRIORITIES.join(' | ')}
- category: 根據任務性質選擇 ${CATEGORIES.join(' | ')}
  - content = podcast 腳本/音頻製作
  - infra = 系統架構/DB/部署
  - social_media = 社群發文（通用）
  - youtube = YouTube 相關
  - ig = Instagram 相關
  - threads = Threads 相關
  - research = 研究/調查
  - ops = 日常維運/排程
  - growth = 成長策略/分析
- auto_execute: true 表示懶懶可自動執行（純 data/research），false 表示需要人工確認（會對外發布/花錢）

只回傳 JSON，不要多餘文字：
{
  "title": "...",
  "description": "...",
  "priority": "...",
  "category": "...",
  "auto_execute": false
}`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-flash-1.5',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    return NextResponse.json({ error: `LLM error: ${err}` }, { status: 500 });
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content ?? '';

  // Strip markdown code fences if present
  const jsonText = text.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim();

  try {
    const refined = JSON.parse(jsonText);

    // Validate and sanitize
    if (!PRIORITIES.includes(refined.priority)) refined.priority = 'medium';
    if (!CATEGORIES.includes(refined.category)) refined.category = 'ops';
    refined.auto_execute = !!refined.auto_execute;

    return NextResponse.json(refined);
  } catch {
    return NextResponse.json({ error: 'Failed to parse LLM response', raw: text }, { status: 500 });
  }
}
