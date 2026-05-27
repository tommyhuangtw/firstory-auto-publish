import { z } from 'zod';
import { client } from '../client.js';
import type { ToolDef } from '../types.js';

export const pipelineTools: ToolDef[] = [
  {
    name: 'pipeline_start',
    description: 'Start a new podcast pipeline run. Returns immediately; pipeline runs in background. Segment types: daily (AI tool news), weekly (weekly roundup), robot (robotics news), sysdesign (system design), quickchat (casual discussion).',
    inputSchema: z.object({
      segmentType: z.enum(['daily', 'weekly', 'robot', 'sysdesign', 'quickchat']),
      manualVideoUrls: z.array(z.string()).optional().describe('YouTube URLs for sysdesign/quickchat segments'),
      episodeLength: z.number().optional().describe('Target length in minutes (12/15/18/21/25) for quickchat'),
    }),
    handler: async (input) => {
      return client.post('/api/pipeline/start', input);
    },
  },
  {
    name: 'pipeline_status',
    description: 'List recent pipeline runs with their status (running/completed/failed/paused), current stage, and timing.',
    inputSchema: z.object({}),
    handler: async () => {
      return client.get('/api/pipeline/status');
    },
  },
  {
    name: 'pipeline_status_by_id',
    description: 'Get detailed status of a specific pipeline run including error log.',
    inputSchema: z.object({
      id: z.number().describe('Pipeline run ID'),
    }),
    handler: async (input) => {
      return client.get(`/api/pipeline/status/${input.id}`);
    },
  },
  {
    name: 'pipeline_retry',
    description: 'Retry a failed pipeline from a specific stage. Can optionally override state values.',
    inputSchema: z.object({
      pipelineRunId: z.number(),
      fromStage: z.string().describe('Stage to retry from: fetchYoutube, classify, scriptEnglish, extractTools, translate, customContentInsert, scoreQuality, generateMeta, generateCover, synthesizeTts, generateSubtitles, uploadAssets, notify'),
      stateOverrides: z.record(z.unknown()).optional().describe('Optional state values to override before retry'),
    }),
    handler: async (input) => {
      return client.post('/api/pipeline/retry', input);
    },
  },
  {
    name: 'pipeline_snapshots',
    description: 'View all stage snapshots for a pipeline run. Each snapshot contains the stage output data, useful for debugging failures.',
    inputSchema: z.object({
      runId: z.number().describe('Pipeline run ID'),
    }),
    handler: async (input) => {
      return client.get(`/api/pipeline/snapshots/${input.runId}`);
    },
  },
];
