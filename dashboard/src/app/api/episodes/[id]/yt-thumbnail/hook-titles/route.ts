import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { LLMService } from '@/services/llmService';
import { VERSION_GUARD_ZH } from '@/services/llm/versionGuard';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const episodeId = parseInt(id);
    if (isNaN(episodeId)) {
      return NextResponse.json({ error: 'Invalid episode id' }, { status: 400 });
    }

    const db = getDb();
    const episode = db.prepare('SELECT selected_title, hook_title_history FROM episodes WHERE id = ?').get(episodeId) as { selected_title: string | null; hook_title_history: string | null } | undefined;
    if (!episode?.selected_title) {
      return NextResponse.json({ error: 'Episode has no selected title' }, { status: 400 });
    }

    const llm = new LLMService();
    const result = await llm.call({
      stage: 'yt-thumbnail-hook-title',
      episodeId,
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
- 請提供 10 個不同風格的候選標題，每行一個，只輸出標題，不要編號、不要解釋

好的範例：
- 免費寫 Code
- AI 取代工程師
- 百萬晶片大戰
- 機器人暴走了

${VERSION_GUARD_ZH}`,
        },
        {
          role: 'user',
          content: `請把以下標題濃縮成 10 個不同風格的 YouTube 縮圖短標題（每行一個）：\n\n「${episode.selected_title}」`,
        },
      ],
      options: {
        preferredModel: 'google/gemini-3.1-flash-lite-preview',
        temperature: 1.0,
        maxTokens: 300,
      },
    });

    if (!result.success || !result.content) {
      return NextResponse.json({ error: result.error || 'LLM call failed' }, { status: 500 });
    }

    const candidates = result.content
      .split('\n')
      .map((line) =>
        line.trim()
          .replace(/^\d+[.、)）]\s*/, '')
          .replace(/^[-•]\s*/, '')
          .replace(/^[「『""''\s]+|[」』""''\s]+$/g, '')
          .replace(/[。，、；：]/g, ''),
      )
      .filter((line) => line.length >= 2 && line.length <= 15);

    const finalCandidates = candidates.slice(0, 10);

    // Save this batch to history
    const history: { titles: string[]; ts: string }[] = episode.hook_title_history ? JSON.parse(episode.hook_title_history) : [];
    history.unshift({ titles: finalCandidates, ts: new Date().toISOString() });
    db.prepare('UPDATE episodes SET hook_title_history = ? WHERE id = ?').run(JSON.stringify(history), episodeId);

    return NextResponse.json({
      original: episode.selected_title,
      candidates: finalCandidates,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
