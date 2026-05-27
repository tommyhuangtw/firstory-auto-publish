import { z } from 'zod';
import { client } from '../client.js';
import type { ToolDef } from '../types.js';

export const analyticsTools: ToolDef[] = [
  {
    name: 'metrics_overview',
    description: 'Get comprehensive cost and quality metrics: cost per episode, cost by pipeline stage, quality trends, pipeline run history, latency stats, and summary totals.',
    inputSchema: z.object({}),
    handler: async () => {
      return client.get('/api/metrics');
    },
  },
  {
    name: 'analytics_data',
    description: 'Get platform analytics: daily downloads, episode rankings, weekly averages, and growth metrics from SoundOn.',
    inputSchema: z.object({
      range: z.enum(['7d', '30d', '90d', '360d', 'all']).optional().describe('Time range (default: all)'),
      sort: z.enum(['total_downloads', 'downloads_7d', 'downloads_30d', 'published_at', 'episode_number']).optional(),
      order: z.enum(['asc', 'desc']).optional(),
    }),
    handler: async (input) => {
      return client.get('/api/analytics', input as Record<string, string | number | undefined>);
    },
  },
  {
    name: 'health_check',
    description: 'Check system health: database connection status and table count.',
    inputSchema: z.object({}),
    handler: async () => {
      return client.get('/api/health');
    },
  },
  {
    name: 'soundon_latest',
    description: 'Get the latest episode data from SoundOn platform.',
    inputSchema: z.object({}),
    handler: async () => {
      return client.get('/api/soundon/latest');
    },
  },
];
