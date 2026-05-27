import { z } from 'zod';
import { client } from '../client.js';
import type { ToolDef } from '../types.js';

export const youtubeTools: ToolDef[] = [
  {
    name: 'youtube_sources_list',
    description: 'List YouTube source videos fetched for a segment type. Shows which videos are available for upcoming episodes.',
    inputSchema: z.object({
      segment: z.enum(['daily', 'weekly', 'robot']).optional().describe('Segment type (default: daily)'),
    }),
    handler: async (input) => {
      return client.get('/api/youtube-sources', input as Record<string, string | number | undefined>);
    },
  },
  {
    name: 'youtube_sources_update',
    description: 'Update a YouTube source entry (e.g., change its segment assignment).',
    inputSchema: z.object({
      id: z.number().describe('Source ID'),
      segment: z.string().optional().describe('New segment type'),
    }),
    handler: async (input) => {
      const { id, ...body } = input;
      return client.patch(`/api/youtube-sources/${id}`, body);
    },
  },
  {
    name: 'search_keywords',
    description: 'Get the YouTube search keywords used for content discovery.',
    inputSchema: z.object({}),
    handler: async () => {
      return client.get('/api/search-keywords');
    },
  },
];
