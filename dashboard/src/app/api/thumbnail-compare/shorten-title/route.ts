import { NextRequest, NextResponse } from 'next/server';
import { LLMService } from '@/services/llmService';

export async function POST(request: NextRequest) {
  try {
    const { title, segmentType } = (await request.json()) as {
      title: string;
      segmentType?: string;
    };

    if (!title?.trim()) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    const llm = new LLMService();
    const result = await llm.call({
      stage: 'thumbnail-shorten-title',
      messages: [
        {
          role: 'system',
          content: `你是 YouTube 縮圖標題專家。你的任務是把長標題濃縮成 4-8 個中文字的吸睛短標題，適合放在 YouTube 縮圖上。

規則：
- 每個標題 4-8 個中文字（最理想是 4-6 字）
- 要有衝擊力、引起好奇心
- 風格多樣化：問句、驚嘆、對比、懸念、數字、反差等手法都可以
- 英文工具名可以保留（例如 GPT、Claude）
- 不要加標點符號
- 請提供 8 個不同風格的候選標題，每行一個，只輸出標題，不要編號、不要解釋

好的範例：
- 免費寫 Code
- AI 取代工程師
- 百萬晶片大戰
- 機器人暴走了`,
        },
        {
          role: 'user',
          content: `請把以下標題濃縮成 8 個不同風格的 YouTube 縮圖短標題（每行一個）：\n\n「${title}」`,
        },
      ],
      options: {
        preferredModel: 'google/gemini-3.1-flash-lite-preview',
        temperature: 1.0,
        maxTokens: 200,
      },
    });

    if (!result.success || !result.content) {
      return NextResponse.json(
        { error: result.error || 'LLM call failed' },
        { status: 500 },
      );
    }

    // Parse multiple candidates — one per line
    const candidates = result.content
      .split('\n')
      .map((line) =>
        line
          .trim()
          .replace(/^\d+[.、)）]\s*/, '') // remove numbering
          .replace(/^[-•]\s*/, '') // remove bullet
          .replace(/^[「『""''\s]+|[」』""''\s]+$/g, '')
          .replace(/[。，、；：]/g, ''),
      )
      .filter((line) => line.length >= 2 && line.length <= 15);

    return NextResponse.json({
      original: title,
      candidates: candidates.slice(0, 8),
      model: result.model,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
