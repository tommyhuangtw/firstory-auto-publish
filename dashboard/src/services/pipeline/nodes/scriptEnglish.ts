/**
 * Stage 3: English Script Generation.
 *
 * Takes top 5 classified videos with transcripts and generates
 * a 5000-6000 word conversational podcast narration in English.
 */

import { getLLMService } from '@/services/llmService';
import { createChildLogger } from '@/lib/logger';
import type { PipelineState } from '../state';

const log = createChildLogger('pipeline:script-en');

const SCRIPT_MODEL = 'google/gemini-2.5-pro';

export async function scriptEnglish(state: PipelineState): Promise<Partial<PipelineState>> {
  log.info({ videoCount: state.selectedVideos.length }, 'Generating English script');

  if (state.selectedVideos.length === 0) {
    return { scriptEn: '', scriptWordCount: 0, status: 'translating', error: 'No videos selected for scripting' };
  }

  const llm = getLLMService();

  const videoSummaries = state.selectedVideos
    .map((v, i) => {
      const transcript = v.transcript ? `\nTranscript:\n${v.transcript.slice(0, 3000)}` : '';
      return `Video ${i + 1}: "${v.title}" by ${v.channelName} (${v.viewCount.toLocaleString()} views)${transcript}`;
    })
    .join('\n\n---\n\n');

  const prompt = buildScriptPrompt(videoSummaries, state.segmentType);

  const result = await llm.call({
    stage: 'script_en',
    episodeNumber: state.episodeNumber,
    messages: [
      { role: 'system', content: 'You are a professional podcast script writer. Write engaging, conversational narration.' },
      { role: 'user', content: prompt },
    ],
    options: {
      preferredModel: SCRIPT_MODEL,
      maxTokens: 8192,
      temperature: 0.7,
    },
  });

  if (!result.success || !result.content) {
    log.error('English script generation failed');
    return { scriptEn: '', scriptWordCount: 0, status: 'translating', error: result.error || 'Script generation failed' };
  }

  const wordCount = result.content.split(/\s+/).length;
  log.info({ wordCount }, 'English script generated');

  return {
    scriptEn: result.content,
    scriptWordCount: wordCount,
    status: 'translating',
  };
}

function buildScriptPrompt(videoSummaries: string, segmentType: string): string {
  const tone = segmentType === 'robot'
    ? 'Focus on robotics technology, industry impact, and future implications.'
    : 'Focus on practical AI tools, their use cases, and how they help productivity.';

  return `Write a podcast script (5000-6000 words) based on the following YouTube video summaries.

${tone}

## Source Videos:

${videoSummaries}

## Requirements:

1. **Conversational tone** — Like a knowledgeable friend explaining tech to curious listeners
2. **Structure**: Opening hook → Video-by-video coverage → Connections between tools → Closing thoughts
3. **For each video/tool covered**:
   - What it does and why it matters
   - Key features and standout capabilities
   - Practical use cases (who should care?)
   - Honest assessment (pros, cons, limitations)
4. **Transitions** between topics should feel natural, not robotic
5. **Opening** should be attention-grabbing (interesting stat, provocative question, or surprising fact)
6. **Closing** should summarize key takeaways and look forward

Write the full script as continuous narration (no stage directions, no speaker labels).
Output ONLY the script text, no meta-commentary.`;
}
