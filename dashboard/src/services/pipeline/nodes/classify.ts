/**
 * Stage 2: AI Classification.
 *
 * Uses Gemini Flash Lite (cheapest model) to classify each video:
 * - daily/weekly: 'is_tool' | 'not_tool'
 * - robot: 'is_robotics' | 'non_robotics'
 *
 * Filters out non-English, non-technical, and speculative content.
 */

import { getLLMService } from '@/services/llmService';
import { createChildLogger } from '@/lib/logger';
import type { PipelineState, VideoSource } from '../state';

const log = createChildLogger('pipeline:classify');

const CLASSIFICATION_MODEL = 'google/gemini-2.5-flash-lite';

export async function classify(state: PipelineState): Promise<Partial<PipelineState>> {
  log.info({ count: state.videos.length, segmentType: state.segmentType }, 'Classifying videos');

  if (state.videos.length === 0) {
    return { classifiedVideos: [], selectedVideos: [], status: 'scripting' };
  }

  const llm = getLLMService();
  const isRobot = state.segmentType === 'robot';
  const classified: VideoSource[] = [];

  // Classify in parallel (all at once — they're independent)
  const results = await Promise.allSettled(
    state.videos.map(async (video) => {
      const prompt = buildClassificationPrompt(video, isRobot);

      const result = await llm.generateJSON<{ classification: string; reason: string }>(
        prompt,
        'classify',
        {
          episodeNumber: state.episodeNumber,
          preferredModel: CLASSIFICATION_MODEL,
          maxTokens: 256,
          temperature: 0.1,
        }
      );

      if (result.success && result.data) {
        video.classification = result.data.classification as VideoSource['classification'];
        log.info(
          { videoId: video.videoId, classification: video.classification, title: video.title.slice(0, 50) },
          'Video classified'
        );
      } else {
        video.classification = isRobot ? 'non_robotics' : 'not_tool';
        log.warn({ videoId: video.videoId }, 'Classification failed, defaulting to negative');
      }

      return video;
    })
  );

  for (const r of results) {
    if (r.status === 'fulfilled') classified.push(r.value);
  }

  // Filter to relevant videos only
  const targetClass = isRobot ? 'is_robotics' : 'is_tool';
  const selected = classified
    .filter((v) => v.classification === targetClass)
    .sort((a, b) => b.viewCount - a.viewCount)
    .slice(0, 5);

  log.info(
    { total: classified.length, selected: selected.length },
    'Classification complete'
  );

  return {
    classifiedVideos: classified,
    selectedVideos: selected,
    status: 'scripting',
  };
}

function buildClassificationPrompt(video: VideoSource, isRobot: boolean): string {
  const transcript = video.transcript
    ? `\nTranscript (first 500 chars): ${video.transcript.slice(0, 500)}`
    : '';

  if (isRobot) {
    return `Classify this YouTube video as either "is_robotics" or "non_robotics".

Title: ${video.title}
Channel: ${video.channelName}${transcript}

Classify as "is_robotics" if the video is about:
- Humanoid robots, robotic arms, robot dogs
- Companies: Boston Dynamics, Figure, Tesla Optimus, Unitree, Fauna Robotics
- Robotics technology, AI-powered robots, industrial automation with robots

Classify as "non_robotics" if:
- It's about software AI tools only (no physical robots)
- It's about crypto, finance, or non-technical content
- It's not in English

Return JSON: { "classification": "is_robotics" or "non_robotics", "reason": "brief reason" }`;
  }

  return `Classify this YouTube video as either "is_tool" or "not_tool".

Title: ${video.title}
Channel: ${video.channelName}${transcript}

Classify as "is_tool" if the video is about:
- AI tools, apps, platforms (ChatGPT, Claude, Gemini, Cursor, Midjourney, etc.)
- Software development tools, productivity tools
- AI tutorials, demos, reviews, comparisons

Classify as "not_tool" if:
- It's about crypto, finance speculation, or get-rich-quick schemes
- It's about AI theory/research without practical tool usage
- It's not in English
- It's clickbait without substance

Return JSON: { "classification": "is_tool" or "not_tool", "reason": "brief reason" }`;
}
