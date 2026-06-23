/**
 * In-memory cover generation task queue.
 * Tasks execute sequentially per episode to avoid overwhelming kie.ai.
 * Tasks are lost on server restart (acceptable for ephemeral image generation).
 */

import { generateCover } from '@/services/pipeline/nodes/generateCover';
import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';
import type { PipelineState } from '@/services/pipeline/state';

const log = createChildLogger('cover-queue');

export interface CoverTask {
  taskId: string;
  episodeId: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error?: string;
  coverPath?: string;
  coverUrl?: string;
  createdAt: string;
  completedAt?: string;
  /** undefined → auto-detect; 'none' → no holiday; a key → force that holiday. */
  holidayOverride?: string;
  /** Optional user context (news/topic) that augments the summary; skips holiday. */
  contextText?: string;
  contextImageUrl?: string;
}

export interface EnqueueOptions {
  holidayOverride?: string;
  contextText?: string;
  contextImageUrl?: string;
}

// Map<episodeId, CoverTask[]>
const tasksByEpisode = new Map<number, CoverTask[]>();

// Set of episodeIds currently processing
const processing = new Set<number>();

export function enqueueTask(episodeId: number, opts: EnqueueOptions = {}): CoverTask {
  const task: CoverTask = {
    taskId: crypto.randomUUID(),
    episodeId,
    status: 'pending',
    createdAt: new Date().toISOString(),
    holidayOverride: opts.holidayOverride,
    contextText: opts.contextText,
    contextImageUrl: opts.contextImageUrl,
  };

  const tasks = tasksByEpisode.get(episodeId) || [];
  tasks.push(task);
  tasksByEpisode.set(episodeId, tasks);

  // Kick off processing if not already running for this episode
  if (!processing.has(episodeId)) {
    processQueue(episodeId);
  }

  return task;
}

export function getTasksForEpisode(episodeId: number): CoverTask[] {
  return tasksByEpisode.get(episodeId) || [];
}

async function processQueue(episodeId: number): Promise<void> {
  if (processing.has(episodeId)) return;
  processing.add(episodeId);

  try {
    const tasks = tasksByEpisode.get(episodeId) || [];

    while (true) {
      const next = tasks.find(t => t.status === 'pending');
      if (!next) break;

      next.status = 'running';
      log.info({ taskId: next.taskId, episodeId }, 'Starting cover generation task');

      try {
        const db = getDb();
        const episode = db.prepare(
          'SELECT id, episode_number, segment_type, selected_title, source_videos, script_summary FROM episodes WHERE id = ?'
        ).get(episodeId) as {
          id: number;
          episode_number: number | null;
          segment_type: string;
          selected_title: string | null;
          source_videos: string | null;
          script_summary: string | null;
        } | undefined;

        if (!episode) {
          throw new Error('Episode not found');
        }

        let selectedVideos: { title: string; viewCount: number }[] = [];
        if (episode.source_videos) {
          try {
            const parsed = JSON.parse(episode.source_videos);
            selectedVideos = parsed.map((v: Record<string, unknown>) => ({
              title: (v.title as string) || '',
              viewCount: (v.viewCount as number) || (v.view_count as number) || 0,
            }));
          } catch { /* skip */ }
        }

        const minimalState = {
          episodeId: episode.id,
          episodeNumber: episode.episode_number,
          segmentType: episode.segment_type,
          selectedTitle: episode.selected_title || '',
          selectedVideos,
          scriptSummary: episode.script_summary || '',
        } as PipelineState;

        const result = await generateCover(minimalState, {
          holidayOverride: next.holidayOverride,
          contextText: next.contextText,
          contextImageUrl: next.contextImageUrl,
        });

        // Set as active cover
        db.prepare('UPDATE episodes SET cover_path = ?, cover_url = ? WHERE id = ?')
          .run(result.coverPath || null, result.coverUrl || null, episodeId);

        next.status = 'completed';
        next.coverPath = result.coverPath;
        next.coverUrl = result.coverUrl;
        next.completedAt = new Date().toISOString();

        log.info({ taskId: next.taskId, episodeId }, 'Cover generation task completed');
      } catch (err) {
        next.status = 'failed';
        next.error = (err as Error).message;
        next.completedAt = new Date().toISOString();
        log.error({ taskId: next.taskId, episodeId, error: next.error }, 'Cover generation task failed');
      }
    }
  } finally {
    processing.delete(episodeId);

    // Cleanup: remove completed/failed tasks older than 10 minutes
    const tasks = tasksByEpisode.get(episodeId) || [];
    const cutoff = Date.now() - 10 * 60 * 1000;
    const remaining = tasks.filter(t => {
      if (t.status === 'pending' || t.status === 'running') return true;
      return t.completedAt && new Date(t.completedAt).getTime() > cutoff;
    });
    if (remaining.length === 0) {
      tasksByEpisode.delete(episodeId);
    } else {
      tasksByEpisode.set(episodeId, remaining);
    }
  }
}
