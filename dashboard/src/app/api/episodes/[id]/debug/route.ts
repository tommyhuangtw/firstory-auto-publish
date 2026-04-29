import { NextResponse } from 'next/server';
import { getDb } from '@/db';

const STAGE_LABELS: Record<string, string> = {
  fetchYoutube: '抓取 YouTube',
  classify: '影片分類',
  scriptEnglish: '英文講稿',
  extractTools: '工具擷取',
  translate: '中文翻譯',
  customContentInsert: '客製內容插入',
  enrichMemory: '記憶強化',
  scoreQuality: '品質評分',
  generateMeta: '標題描述',
  generateCover: '封面生成',
  synthesizeTts: '語音合成',
  uploadAssets: '上傳素材',
  notify: '通知發送',
};

// Map LLM call stages to pipeline stage names
const LLM_STAGE_MAP: Record<string, string> = {
  classify_video: 'classify',
  script_english: 'scriptEnglish',
  extract_tools: 'extractTools',
  translate_zh: 'translate',
  quality_score: 'scoreQuality',
  quality_rewrite: 'scoreQuality',
  title_gen: 'generateMeta',
  title_select: 'generateMeta',
  description_gen: 'generateMeta',
  youtube_description_gen: 'generateMeta',
  tags_gen: 'generateMeta',
  ig_caption: 'notify',
  email_content: 'notify',
  email_html: 'notify',
  fb_caption: 'notify',
  threads_caption: 'notify',
  cover_headline: 'generateCover',
};

interface SnapshotRow {
  id: number;
  stage: string;
  output_data: string | null;
  started_at: string | null;
  elapsed_ms: number | null;
}

interface LlmCallRow {
  id: number;
  stage: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  success: number;
  error_message: string | null;
  input_messages: string | null;
  output_content: string | null;
  created_at: string;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const episodeId = parseInt(id);
  if (isNaN(episodeId)) {
    return NextResponse.json({ error: 'Invalid episode ID' }, { status: 400 });
  }

  const db = getDb();

  // 1. Episode basics
  const episode = db.prepare(
    'SELECT id, episode_number, selected_title, status, segment_type, created_at FROM episodes WHERE id = ?'
  ).get(episodeId) as { id: number; episode_number: number | null; selected_title: string | null; status: string; segment_type: string; created_at: string } | undefined;

  if (!episode) {
    return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
  }

  // 2. Latest pipeline run
  const pipelineRun = db.prepare(
    `SELECT id, status, current_stage, started_at, completed_at, error_log
     FROM pipeline_runs WHERE episode_id = ? ORDER BY id DESC LIMIT 1`
  ).get(episodeId) as { id: number; status: string; current_stage: string | null; started_at: string; completed_at: string | null; error_log: string | null } | undefined;

  if (!pipelineRun) {
    return NextResponse.json({
      episode,
      pipelineRun: null,
      stages: [],
      memory: { read: null, written: [] },
    });
  }

  // 3. Pipeline snapshots
  const snapshots = db.prepare(
    `SELECT id, stage, output_data, started_at, elapsed_ms
     FROM pipeline_snapshots WHERE pipeline_run_id = ? ORDER BY id ASC`
  ).all(pipelineRun.id) as SnapshotRow[];

  // 4. LLM calls for this episode
  const llmCalls = db.prepare(
    `SELECT id, stage, model, input_tokens, output_tokens, cost_usd, latency_ms,
            success, error_message, input_messages, output_content, created_at
     FROM llm_calls WHERE episode_id = ? ORDER BY id ASC`
  ).all(episodeId) as LlmCallRow[];

  // Group LLM calls by pipeline stage
  const llmCallsByStage: Record<string, LlmCallRow[]> = {};
  for (const call of llmCalls) {
    const pipelineStage = LLM_STAGE_MAP[call.stage] || call.stage;
    if (!llmCallsByStage[pipelineStage]) llmCallsByStage[pipelineStage] = [];
    llmCallsByStage[pipelineStage].push(call);
  }

  // 5. Build stages array
  const stages = snapshots.map((snap) => {
    let outputData = null;
    try {
      if (snap.output_data) outputData = JSON.parse(snap.output_data);
    } catch { /* skip */ }

    return {
      name: snap.stage,
      label: STAGE_LABELS[snap.stage] || snap.stage,
      elapsed_ms: snap.elapsed_ms,
      started_at: snap.started_at,
      outputData,
      llmCalls: llmCallsByStage[snap.stage] || [],
    };
  });

  // 6. Extract memory read/write from snapshots
  let memoryRead: { knownToolNames: string[]; briefForScriptGen: string } | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let memoryWritten: any[] = [];

  const scriptEnglishStage = stages.find((s) => s.name === 'scriptEnglish');
  if (scriptEnglishStage?.outputData?.memoryContext) {
    const mc = scriptEnglishStage.outputData.memoryContext;
    memoryRead = {
      knownToolNames: mc.knownToolNames || [],
      briefForScriptGen: mc.briefForScriptGen || '',
    };
  }

  const extractToolsStage = stages.find((s) => s.name === 'extractTools');
  if (extractToolsStage?.outputData?.extractedTools) {
    memoryWritten = extractToolsStage.outputData.extractedTools;
  }

  return NextResponse.json({
    episode,
    pipelineRun,
    stages,
    memory: {
      read: memoryRead,
      written: memoryWritten,
    },
  });
}
