/**
 * Stage 3.5: Extract Tools + Generate Digest from English script.
 *
 * Runs after scriptEnglish, before translate.
 * 1. Extracts AI tool mentions with family resolution and saves to DB.
 *    (Skipped for sysdesign/quickchat — those aren't tool-focused)
 * 2. Generates episode digest and extracts themes for ALL segment types.
 *    This powers cross-episode narrative continuity.
 */

import { createChildLogger } from '@/lib/logger';
import { extractToolsFromScript } from '@/services/memory/toolExtractor';
import { upsertTools } from '@/services/memory/memoryService';
import { generateEpisodeDigest, extractAndUpsertThemes } from '@/services/memory/digestService';
import type { PipelineState } from '../state';
import type { ResolvedTool } from '@/services/memory/toolExtractor';

const log = createChildLogger('pipeline:extractTools');

export async function extractTools(state: PipelineState): Promise<Partial<PipelineState>> {
  if (!state.scriptEn) {
    log.warn('No English script, skipping tool extraction and digest generation');
    return { extractedTools: [] };
  }

  const isSysdesign = state.segmentType === 'sysdesign';
  const isQuickchat = state.segmentType === 'quickchat';
  let tools: ResolvedTool[] = [];

  // Step 1: Tool extraction (skip for sysdesign/quickchat — not tool-focused)
  if (!isSysdesign && !isQuickchat) {
    try {
      tools = await extractToolsFromScript(state.scriptEn, state.episodeId);

      if (tools.length > 0) {
        await upsertTools(state.episodeId, tools);
      }

      log.info({ count: tools.length }, 'Tool extraction complete');
    } catch (error) {
      log.error({ error: (error as Error).message }, 'Tool extraction failed, continuing pipeline');
    }
  } else {
    log.info({ segmentType: state.segmentType }, 'Skipping tool extraction for this segment type');
  }

  // Step 2: Episode digest + theme extraction (ALL segment types)
  try {
    await generateEpisodeDigest(
      state.episodeId,
      state.segmentType,
      state.scriptEn,
    );
    log.info({ episodeId: state.episodeId }, 'Episode digest generated');
  } catch (error) {
    log.error({ error: (error as Error).message }, 'Digest generation failed, continuing pipeline');
  }

  try {
    await extractAndUpsertThemes(
      state.episodeId,
      state.scriptEn,
    );
    log.info({ episodeId: state.episodeId }, 'Theme extraction complete');
  } catch (error) {
    log.error({ error: (error as Error).message }, 'Theme extraction failed, continuing pipeline');
  }

  return { extractedTools: tools };
}
