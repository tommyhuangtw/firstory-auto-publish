/**
 * Stage 3.5: Extract Tools from English script.
 *
 * Runs after scriptEnglish, before translate.
 * Extracts AI tool mentions with family resolution and saves to DB.
 */

import { createChildLogger } from '@/lib/logger';
import { extractToolsFromScript } from '@/services/memory/toolExtractor';
import { upsertTools } from '@/services/memory/memoryService';
import type { PipelineState } from '../state';
import type { ResolvedTool } from '@/services/memory/toolExtractor';

const log = createChildLogger('pipeline:extractTools');

export async function extractTools(state: PipelineState): Promise<Partial<PipelineState>> {
  if (!state.scriptEn) {
    log.warn('No English script, skipping tool extraction');
    return { extractedTools: [] };
  }

  let tools: ResolvedTool[] = [];

  try {
    tools = await extractToolsFromScript(state.scriptEn, state.episodeNumber);

    if (tools.length > 0) {
      await upsertTools(state.episodeNumber, tools);
    }

    log.info({ count: tools.length }, 'Tool extraction complete');
  } catch (error) {
    log.error({ error: (error as Error).message }, 'Tool extraction failed, continuing pipeline');
  }

  return { extractedTools: tools };
}
