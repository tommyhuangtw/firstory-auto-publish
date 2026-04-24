/**
 * Stage 4.5: Enrich script with memory recall statements.
 *
 * Runs after translate, before scoreQuality.
 * Finds tools that appeared in previous episodes and injects
 * recall statements into the Chinese script.
 */

import { createChildLogger } from '@/lib/logger';
import { generateRecallStatements } from '@/services/memory/memoryService';
import type { PipelineState } from '../state';

const log = createChildLogger('pipeline:enrichMemory');

export async function enrichMemory(state: PipelineState): Promise<Partial<PipelineState>> {
  if (!state.scriptZh || !state.extractedTools || state.extractedTools.length === 0) {
    log.info('No script or tools to enrich');
    return { memoryEnrichments: [] };
  }

  let recalls: string[] = [];

  try {
    const toolNames = state.extractedTools.map((t) => t.name);
    recalls = await generateRecallStatements(state.episodeNumber, toolNames);

    if (recalls.length > 0) {
      // Inject recall statements near the beginning of the script (after first paragraph)
      const paragraphs = state.scriptZh.split('\n\n');
      if (paragraphs.length > 1) {
        const recallBlock = '\n\n' + recalls.join('\n') + '\n\n';
        // Insert after the first paragraph (intro)
        paragraphs.splice(1, 0, recallBlock);
        const enrichedScript = paragraphs.join('\n\n');

        log.info({ count: recalls.length }, 'Memory recall injected into script');
        return {
          scriptZh: enrichedScript,
          memoryEnrichments: recalls,
        };
      }
    }

    log.info('No recall statements generated');
  } catch (error) {
    log.error({ error: (error as Error).message }, 'Memory enrichment failed, continuing pipeline');
  }

  return { memoryEnrichments: recalls };
}
