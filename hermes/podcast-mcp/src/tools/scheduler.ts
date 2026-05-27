import { z } from 'zod';
import { client } from '../client.js';
import type { ToolDef } from '../types.js';

export const schedulerTools: ToolDef[] = [
  {
    name: 'scheduler_status',
    description: 'List all scheduled jobs with their status, next run time, and last run info.',
    inputSchema: z.object({}),
    handler: async () => {
      return client.get('/api/scheduler/status');
    },
  },
  {
    name: 'scheduler_trigger',
    description: 'Manually trigger a scheduled job immediately. Common job names: daily-pipeline, weekly-pipeline, robot-pipeline.',
    inputSchema: z.object({
      name: z.string().describe('Job name to trigger'),
    }),
    handler: async (input) => {
      return client.post('/api/scheduler/trigger', input);
    },
  },
  {
    name: 'scheduler_control',
    description: 'Control a scheduled job: skip next run, pause/resume, enable/disable.',
    inputSchema: z.object({
      name: z.string().describe('Job name'),
      action: z.enum(['skip', 'unskip', 'enable', 'disable', 'pause', 'resume']),
    }),
    handler: async (input) => {
      return client.post('/api/scheduler/skip', input);
    },
  },
  {
    name: 'scheduler_get_schedule',
    description: 'Get the weekly schedule configuration showing which segments run on which days and times.',
    inputSchema: z.object({}),
    handler: async () => {
      return client.get('/api/scheduler/schedule');
    },
  },
  {
    name: 'scheduler_update_schedule',
    description: 'Update the weekly schedule. Each slot has: day (0=Sun to 6=Sat), segment type, and time (HH:MM).',
    inputSchema: z.object({
      slots: z.array(z.object({
        day: z.number().min(0).max(6),
        segment: z.string(),
        time: z.string().describe('HH:MM format'),
      })),
    }),
    handler: async (input) => {
      return client.put('/api/scheduler/schedule', input);
    },
  },
];
