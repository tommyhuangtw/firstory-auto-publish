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
export async function extractBeats(episodeId: number, segmentType?: string) {
  const db = getDb();
  const episode = db.prepare('SELECT selected_title, script_zh FROM episodes WHERE id = ?').get(episodeId) as
    { selected_title: string | null; script_zh: string | null } | undefined;

  if (!episode?.script_zh) {
    throw new Error(`Episode ${episodeId} has no Chinese script`);
  }

  const { extractEssence } = loadModule(path.join(SHORTS_PIPELINE_DIR, 'highlightExtractor'));
  const { OpenRouterService } = loadModule(path.join(PROJECT_ROOT, 'src', 'services', 'openRouterService'));
  const openRouter = new OpenRouterService();

  const beats = await extractEssence({
    podcastScript: episode.script_zh,
    episodeTitle: episode.selected_title || '',
    openRouter,
    segmentType,
  });

  log.info({ episodeId, beatCount: beats.length }, 'Extracted beats');
  return beats as Array<{ text: string; reason: string }>;
}

/**
 * Generate 5 cover headline candidates for a selected beat.
 */
export async function generateHeadlines(selectedBeat: { text: string; reason?: string }, segmentType?: string) {
  const { generateCoverHeadlines } = loadModule(path.join(SHORTS_PIPELINE_DIR, 'highlightExtractor'));
  const headlines = await generateCoverHeadlines({ selectedBeat, narrationScript: null, segmentType });
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
    episode_id: number;
    episode_number: number;
    beats_json: string;
    selected_beat_index: number;
    headlines_json: string;
    selected_headline_index: number;
    avatar_filename: string | null;
  };

  // Use episode_id if available, fallback to episode_number for old data
  const episodeId = shorts.episode_id || shorts.episode_number;
  const episode = db.prepare('SELECT selected_title, script_zh, segment_type FROM episodes WHERE id = ?').get(episodeId) as
    { selected_title: string | null; script_zh: string | null; segment_type: string };

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
      segmentType: episode.segment_type,
    });

    // Generate IG caption
    const igCaption = await generateShortsIgCaption({
      episodeId,
      episodeTitle: episode.selected_title || '',
      episodeNumber: shorts.episode_number,
      beatText: selectedBeat.text,
      coverHeadline,
      segmentType: episode.segment_type,
    });

    db.prepare(
      `UPDATE shorts SET status = 'completed', video_path = ?, cover_path = ?,
       manifest_json = ?, ig_caption = ?, completed_at = datetime('now') WHERE id = ?`
    ).run(outputPath, coverPath, JSON.stringify(manifest), igCaption, shortsId);

    // Log Kie AI costs for shorts pipeline: 1 hero (veo3) + 2 sloth (kling) + 1 edit (nano-banana-edit)
    logShortsCosts(db, episodeId, shortsId);

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
export async function generateShortsIgCaption(args: {
  episodeId: number;
  episodeTitle: string;
  episodeNumber?: number;
  beatText: string;
  coverHeadline: string;
  segmentType?: string;
}): Promise<string> {
  try {
    const { getLLMService } = await import('@/services/llmService');
    const llm = getLLMService();

    const isSysdesign = args.segmentType === 'sysdesign';
    const showName = isSysdesign ? '系統設計懶懶學（系統設計拆解 Podcast）' : 'AI 懶人報（每日 AI 精華 Podcast）';
    const requiredHashtag = isSysdesign ? '#系統設計懶懶學' : '#AI懶人報';
    const extraHashtags = isSysdesign
      ? '（#系統設計 #SystemDesign #架構 #SoftwareEngineering #系統設計懶懶學 必須包含）'
      : '（#AI懶人報 必須包含）';

    const today = new Date().toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
    const epLabel = args.episodeNumber ? `EP${args.episodeNumber} ` : '';

    const prompt = `你是${isSysdesign ? '系統設計懶懶學' : 'AI 懶人報'}的 IG 小編。請為這則 Reels 短影音寫一段 Instagram 貼文文案，主要目的是引流觀眾去聽完整的 Podcast。

【節目】${showName}
【本集標題】${epLabel}${args.episodeTitle}（${today}）
【Shorts 主題】${args.beatText.slice(0, 300)}
【封面標題】${args.coverHeadline}

【文案規則】
1. 開頭用 1-2 句吸睛的 hook（呼應 Shorts 內容）
2. hook 之後、重點摘要之前，獨立一行標示本集資訊，格式：「${isSysdesign ? '📐 系統設計懶懶學' : '📰 AI懶人報'}｜${epLabel}${args.episodeTitle}」。必須使用完整標題，禁止截短或改寫。
3. 用 3-5 個 emoji bullet points 列出本集重點
4. 結尾 CTA：引導去聽完整集數（「完整集數連結在 bio」或「連結在限動」）
5. 加 10-15 個相關 hashtags${extraHashtags}
6. 總長度 150-300 字
7. 語氣要像跟朋友聊天，不要太正式

直接輸出文案，不要任何前後說明。`;

    const resp = await llm.call({
      stage: 'shorts_ig_caption',
      episodeId: args.episodeId,
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
  const fallbackTag = args.segmentType === 'sysdesign' ? '#系統設計懶懶學 #系統設計 #SystemDesign' : '#AI懶人報 #AI';
  return `${args.coverHeadline}\n\n完整集數連結在 bio！\n\n${fallbackTag} #Podcast`;
}

/**
 * Regenerate the Reels cover image with a new headline.
 * Uses the same avatar as the original shorts and renders via Remotion.
 */
export async function regenerateCover(shortsId: number, newHeadline: string, headlineY?: number): Promise<string> {
  const db = getDb();
  const shorts = db.prepare('SELECT avatar_filename, cover_path, headlines_json, selected_headline_index FROM shorts WHERE id = ?').get(shortsId) as {
    avatar_filename: string | null;
    cover_path: string | null;
    headlines_json: string;
    selected_headline_index: number;
  } | undefined;

  if (!shorts) throw new Error('Shorts not found');

  const pipelineModule = loadModule(path.join(SHORTS_PIPELINE_DIR));
  const { renderRemotionStill, stageAsset, rel, REMOTION_DIR } = pipelineModule;

  const SLOTH_IMAGES_DIR = path.join(REMOTION_DIR, 'public');
  const avatarPath = shorts.avatar_filename
    ? path.join(SLOTH_IMAGES_DIR, shorts.avatar_filename)
    : null;

  if (!avatarPath) throw new Error('No avatar found for this shorts');

  // Stage avatar into a temp dir inside remotion/public
  const fs = loadModule('fs-extra');
  const ts = Date.now();
  const stageDir = path.join(REMOTION_DIR, 'public', `regen_${ts}`);
  await fs.ensureDir(stageDir);

  try {
    const stagedAvatar = await stageAsset(avatarPath, stageDir, 'avatar.png');

    // Determine output path — reuse existing cover_path directory or create new
    // cover_path in DB is already an absolute path
    const outputDir = shorts.cover_path
      ? path.dirname(shorts.cover_path)
      : path.join(PROJECT_ROOT, 'remotion', 'out');
    await fs.ensureDir(outputDir);
    const coverPath = path.join(outputDir, `cover_${ts}.png`);

    const coverProps: Record<string, unknown> = {
      headline: newHeadline,
      backgroundImageSrc: rel(stagedAvatar),
    };
    // Use topPercent for absolute positioning (matches CSS preview's top: X%)
    if (headlineY != null) {
      coverProps.topPercent = headlineY;
    }
    const propsPath = path.join(stageDir, 'cover_props.json');
    await fs.writeJSON(propsPath, coverProps, { spaces: 2 });

    await renderRemotionStill({ propsPath, outputPath: coverPath });

    // Update headline in headlines_json and cover_path in DB (absolute path, matching original pipeline convention)
    const headlines = JSON.parse(shorts.headlines_json);
    headlines[shorts.selected_headline_index] = newHeadline;
    db.prepare('UPDATE shorts SET cover_path = ?, headlines_json = ? WHERE id = ?')
      .run(coverPath, JSON.stringify(headlines), shortsId);

    log.info({ shortsId, coverPath }, 'Cover regenerated');
    return coverPath;
  } finally {
    await fs.remove(stageDir).catch(() => {});
  }
}

function logShortsCosts(db: ReturnType<typeof getDb>, episodeId: number, shortsId: number) {
  try {
    const getSetting = (key: string, fallback: string) =>
      parseFloat((db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string })?.value || fallback);

    const insert = db.prepare(
      'INSERT INTO service_costs (episode_id, shorts_id, service, model, units, cost_usd) VALUES (?, ?, ?, ?, ?, ?)'
    );

    // 1 × Veo 3 Fast hero B-roll
    insert.run(episodeId, shortsId, 'kieai_veo3', 'veo3_fast', 1, getSetting('kieai_veo3_fast_usd', '0.30'));
    // 2 × Kling 2.6 sloth videos (hook + outro)
    const klingCost = getSetting('kieai_kling_i2v_usd', '0.55');
    insert.run(episodeId, shortsId, 'kieai_kling', 'kling-2.6', 1, klingCost);
    insert.run(episodeId, shortsId, 'kieai_kling', 'kling-2.6', 1, klingCost);
    // 1 × nano-banana-edit cover edit
    insert.run(episodeId, shortsId, 'kieai_edit', 'nano-banana-edit', 1, getSetting('kieai_nano_banana_edit_usd', '0.04'));

    log.info({ shortsId, episodeId }, 'Shorts costs logged');
  } catch (err) {
    log.warn({ error: (err as Error).message }, 'Failed to log shorts costs');
  }
}
