/**
 * Stage 4.5: Memory Enrichment — post-extraction context builder.
 *
 * Layer 3 of the three-layer memory system.
 *
 * OLD approach (removed): Injected "recall statements" into the script text.
 * NEW approach: Memory context was already injected into scriptEnglish prompt
 * (Layer 3a). This stage now just logs which tools were matched and passes
 * memory context forward to qualityScore for validation.
 *
 * No LLM calls. No script modification. Zero cost.
 */

import { createChildLogger } from '@/lib/logger';
import type { PipelineState } from '../state';

const log = createChildLogger('pipeline:enrichMemory');

export async function enrichMemory(state: PipelineState): Promise<Partial<PipelineState>> {
  const knownTools = state.memoryContext?.knownToolNames || [];

  if (knownTools.length === 0) {
    log.info('No memory context — no known tools matched in this episode');
    return { memoryEnrichments: [] };
  }

  log.info(
    { knownToolCount: knownTools.length, tools: knownTools },
    'Memory context active — known tools will be validated in quality scoring'
  );

  return {
    memoryEnrichments: knownTools.map((name) => `[context] ${name}: known to audience`),
  };
}
