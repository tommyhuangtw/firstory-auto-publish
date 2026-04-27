/**
 * Shorts Pipeline — Dashboard bridge to CJS shortsPipeline.
 *
 * Loads existing CJS modules from src/services/shortsPipeline/ at runtime.
 * Uses Function constructor to create a require() that bundlers cannot trace.
 */

import path from 'path';
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('shorts-pipeline');

// Resolve path to the CJS shorts pipeline in the parent project
const PROJECT_ROOT = path.join(process.cwd(), '..');
const SHORTS_PIPELINE_DIR = path.join(PROJECT_ROOT, 'src', 'services', 'shortsPipeline');

/**
 * Runtime-only require that is invisible to webpack/turbopack static analysis.
 * eval() is the only reliable way to prevent bundlers from tracing require() calls
 * to modules outside the Next.js project root.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadModule(modulePath: string): any {
  // eslint-disable-next-line no-eval
  return eval('require')(modulePath);
}

/**
 * Extract 3-5 "essence" beat candidates from an episode's Chinese script.
 */
export async function extractBeats(episodeNumber: number) {
  const db = getDb();
  const episode = db.prepare('SELECT selected_title, script_zh FROM episodes WHERE episode_number = ?').get(episodeNumber) as
    { selected_title: string | null; script_zh: string | null } | undefined;

  if (!episode?.script_zh) {
    throw new Error(`Episode ${episodeNumber} has no Chinese script`);
  }

  const { extractEssence } = loadModule(path.join(SHORTS_PIPELINE_DIR, 'highlightExtractor'));
  const { OpenRouterService } = loadModule(path.join(PROJECT_ROOT, 'src', 'services', 'openRouterService'));
  const openRouter = new OpenRouterService();

  const beats = await extractEssence({
    podcastScript: episode.script_zh,
    episodeTitle: episode.selected_title || '',
    openRouter,
  });

  log.info({ episodeNumber, beatCount: beats.length }, 'Extracted beats');
  return beats as Array<{ text: string; reason: string }>;
}

/**
 * Generate 5 cover headline candidates for a selected beat.
 */
export async function generateHeadlines(selectedBeat: { text: string; reason?: string }) {
  const { generateCoverHeadlines } = loadModule(path.join(SHORTS_PIPELINE_DIR, 'highlightExtractor'));
  const headlines = await generateCoverHeadlines({ selectedBeat, narrationScript: null });
  log.info({ headlineCount: headlines.length }, 'Generated headlines');
  return headlines as string[];
}

/**
 * Run the full 7-stage shorts pipeline (fire-and-forget).
 * Updates shorts row with current_stage for progress tracking.
 */
export async function runShortsGeneration(shortsId: number) {
  const db = getDb();
  const shorts = db.prepare('SELECT * FROM shorts WHERE id = ?').get(shortsId) as {
    episode_number: number;
    beats_json: string;
    selected_beat_index: number;
    headlines_json: string;
    selected_headline_index: number;
    avatar_filename: string | null;
  };

  const episode = db.prepare('SELECT selected_title, script_zh FROM episodes WHERE episode_number = ?').get(shorts.episode_number) as
    { selected_title: string | null; script_zh: string | null };

  const beats = JSON.parse(shorts.beats_json);
  const selectedBeat = beats[shorts.selected_beat_index];
  const headlines = JSON.parse(shorts.headlines_json);
  const coverHeadline = headlines[shorts.selected_headline_index];

  db.prepare("UPDATE shorts SET status = 'generating', current_stage = 'extractHighlight' WHERE id = ?").run(shortsId);

  try {
    const { runShortsPipeline } = loadModule(path.join(SHORTS_PIPELINE_DIR));

    const onStageChange = (stage: string) => {
      log.info({ shortsId, stage }, 'Stage change');
      db.prepare('UPDATE shorts SET current_stage = ? WHERE id = ?').run(stage, shortsId);
    };

    const { outputPath, coverPath, manifest } = await runShortsPipeline({
      episodeTitle: episode.selected_title || '',
      podcastScript: episode.script_zh,
      selectedBeat,
      coverHeadline,
      onStageChange,
      avatarFilename: shorts.avatar_filename || undefined,
    });

    // Generate IG caption
    const igCaption = await generateShortsIgCaption({
      episodeNumber: shorts.episode_number,
      episodeTitle: episode.selected_title || '',
      beatText: selectedBeat.text,
      coverHeadline,
    });

    db.prepare(
      `UPDATE shorts SET status = 'completed', video_path = ?, cover_path = ?,
       manifest_json = ?, ig_caption = ?, completed_at = datetime('now') WHERE id = ?`
    ).run(outputPath, coverPath, JSON.stringify(manifest), igCaption, shortsId);

    log.info({ shortsId, outputPath }, 'Shorts generation completed');
  } catch (err) {
    const errorMsg = (err as Error).message;
    log.error({ shortsId, error: errorMsg }, 'Shorts generation failed');
    db.prepare("UPDATE shorts SET status = 'failed', error_log = ? WHERE id = ?").run(errorMsg, shortsId);
  }
}

/**
 * Generate an IG caption for the shorts video, optimized for 引流 to the podcast.
 */
async function generateShortsIgCaption(args: {
  episodeNumber: number;
  episodeTitle: string;
  beatText: string;
  coverHeadline: string;
}): Promise<string> {
  try {
    const { getLLMService } = await import('@/services/llmService');
    const llm = getLLMService();

    const prompt = `你是 AI 懶人報的 IG 小編。請為這則 Reels 短影音寫一段 Instagram 貼文文案，主要目的是引流觀眾去聽完整的 Podcast。

【節目】AI 懶人報（每日 AI 精華 Podcast）
【本集標題】${args.episodeTitle}
【Shorts 主題】${args.beatText.slice(0, 300)}
【封面標題】${args.coverHeadline}

【文案規則】
1. 開頭用 1-2 句吸睛的 hook（呼應 Shorts 內容）
2. 用 3-5 個 emoji bullet points 列出本集重點
3. 結尾 CTA：引導去聽完整集數（「完整集數連結在 bio」或「連結在限動」）
4. 加 10-15 個相關 hashtags（#AI懶人報 必須包含）
5. 總長度 150-300 字
6. 語氣要像跟朋友聊天，不要太正式

直接輸出文案，不要任何前後說明。`;

    const resp = await llm.call({
      stage: 'shorts_ig_caption',
      episodeNumber: args.episodeNumber,
      messages: [{ role: 'user', content: prompt }],
      options: { temperature: 0.7, maxTokens: 512 },
    });

    if (resp.success && resp.content) {
      return resp.content;
    }
  } catch (err) {
    log.warn({ error: (err as Error).message }, 'IG caption generation failed, using fallback');
  }

  // Fallback
  return `${args.coverHeadline}\n\n完整集數連結在 bio！\n\n#AI懶人報 #AI #Podcast`;
}
