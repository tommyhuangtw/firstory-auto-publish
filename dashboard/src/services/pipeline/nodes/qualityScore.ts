/**
 * Stage 5: Quality Scoring + Refinement Loop.
 *
 * Scores the Chinese script on 4 dimensions.
 * If score < 85, refines and re-scores (max 2 iterations).
 */

import { getLLMService } from '@/services/llmService';
import { createChildLogger } from '@/lib/logger';
import type { PipelineState, QualityScore } from '../state';

const log = createChildLogger('pipeline:quality');

const QUALITY_THRESHOLD = 85;
const MAX_ITERATIONS = 2;

export async function qualityScore(state: PipelineState): Promise<Partial<PipelineState>> {
  log.info({ iteration: state.qualityIterations }, 'Scoring script quality');

  if (!state.scriptZh) {
    return { qualityScore: null, status: 'generating_meta' };
  }

  const llm = getLLMService();
  let currentScript = state.scriptZh;
  let score: QualityScore | null = null;
  let iterations = state.qualityIterations;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // Score the script
    const scoreResult = await llm.generateJSON<QualityScore>(
      buildScoringPrompt(currentScript),
      'scoring',
      { episodeNumber: state.episodeNumber, maxTokens: 1024, temperature: 0.3 }
    );

    if (!scoreResult.success || !scoreResult.data) {
      log.warn('Scoring failed, proceeding without score');
      break;
    }

    score = scoreResult.data;
    iterations++;

    log.info(
      { overall: score.overall, iteration: iterations, dimensions: score.dimensions },
      'Quality score'
    );

    if (score.overall >= QUALITY_THRESHOLD) {
      log.info('Quality threshold met');
      break;
    }

    // Refine if below threshold and we have iterations left
    if (i < MAX_ITERATIONS - 1) {
      log.info({ score: score.overall, threshold: QUALITY_THRESHOLD }, 'Refining script');

      const refineResult = await llm.call({
        stage: 'script_refine',
        episodeNumber: state.episodeNumber,
        messages: [
          {
            role: 'system',
            content: 'You are a podcast script editor. Improve the script based on the feedback.',
          },
          {
            role: 'user',
            content: buildRefinePrompt(currentScript, score),
          },
        ],
        options: { maxTokens: 8192, temperature: 0.5 },
      });

      if (refineResult.success && refineResult.content) {
        currentScript = refineResult.content;
      } else {
        break;
      }
    }
  }

  return {
    scriptZh: currentScript,
    qualityScore: score,
    qualityIterations: iterations,
    status: 'generating_meta',
  };
}

function buildScoringPrompt(script: string): string {
  return `Score this podcast script (Traditional Chinese) on 4 dimensions (1-100 each).

## Script:
${script.slice(0, 6000)}

## Scoring Dimensions:
1. **accuracy** — Are facts, tool names, and descriptions correct?
2. **engagement** — Is it interesting, conversational, and attention-holding?
3. **structure** — Is the flow logical? Good transitions? Strong opening/closing?
4. **naturalness** — Does it sound like natural spoken Chinese (not translated)?

## Return JSON:
{
  "overall": 85,
  "dimensions": {
    "accuracy": 90,
    "engagement": 80,
    "structure": 85,
    "naturalness": 85
  },
  "feedback": "Brief improvement suggestions"
}`;
}

function buildRefinePrompt(script: string, score: QualityScore): string {
  return `Improve this podcast script based on the quality feedback.

## Current Score: ${score.overall}/100
## Feedback: ${score.feedback}

## Dimension Scores:
- Accuracy: ${score.dimensions.accuracy}
- Engagement: ${score.dimensions.engagement}
- Structure: ${score.dimensions.structure}
- Naturalness: ${score.dimensions.naturalness}

## Current Script:
${script}

## Instructions:
- Focus on improving the lowest-scoring dimensions
- Keep all tool names in English
- Maintain the conversational Taiwan Chinese tone
- Don't change the overall structure drastically
- Output ONLY the improved script, no commentary`;
}
