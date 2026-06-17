import { z } from 'zod';
import { client } from '../client.js';
import type { ToolDef } from '../types.js';

export const trendTools: ToolDef[] = [
  {
    name: 'trend_scan',
    description: 'Start a social trend scan: scrape Threads trending topics (web, burner account), score by engagement velocity, and generate 繁中 viral post drafts for review. Fire-and-forget; drafts land for manual review (NOT auto-posted).',
    inputSchema: z.object({
      maxTopics: z.number().optional().describe('Max trending topics to process (default 8)'),
    }),
    handler: async (input) => {
      return client.post('/api/trends/scan', input);
    },
  },
  {
    name: 'trend_list_drafts',
    description: 'List trend post drafts with their topic, heat score, rideability, risk, and status. Filter by status (pending_review | kept | posted_manually | rejected | format_requested).',
    inputSchema: z.object({
      status: z.string().optional().describe('Filter by draft status'),
      limit: z.number().optional().describe('Max results (default 50)'),
    }),
    handler: async (input) => {
      return client.get('/api/trends/drafts', input as Record<string, string | number | undefined>);
    },
  },
  {
    name: 'trend_send_digest',
    description: 'Send a Telegram digest of pending trend drafts (one card each with the full draft + reject/format buttons + a link to the /trends dashboard page).',
    inputSchema: z.object({}),
    handler: async () => {
      return client.post('/api/trends/digest', {});
    },
  },
];
