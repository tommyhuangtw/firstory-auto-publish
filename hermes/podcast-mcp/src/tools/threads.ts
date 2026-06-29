import { z } from 'zod';
import { client } from '../client.js';
import type { ToolDef } from '../types.js';

export const threadTools: ToolDef[] = [
  {
    name: 'threads_sync',
    description: 'Trigger a fresh sync of Threads posts + engagement data (views, likes, replies, reposts) from the Meta Graph API. Runs asynchronously — use threads_list_posts to see results after a few seconds.',
    inputSchema: z.object({}),
    handler: async () => {
      return client.post('/api/voice/sync');
    },
  },
  {
    name: 'threads_list_posts',
    description: 'List Threads posts with optional filters and sorting. Returns post_id, text preview, engagement metrics, and posted_at. Use this to browse post history, find specific posts by category, or check engagement numbers.',
    inputSchema: z.object({
      sort: z.enum(['like_comment', 'likes', 'engagement', 'recent']).optional()
        .describe("Sort order: 'like_comment'=likes+replies*3 (default, best for finding engaging posts), 'likes'=raw likes, 'engagement'=engagement rate, 'recent'=newest first"),
      limit: z.number().min(1).max(200).optional().describe('Max results (default 50, max 200)'),
      offset: z.number().min(0).optional().describe('Pagination offset (default 0)'),
      includeReposts: z.union([z.literal(0), z.literal(1)]).optional()
        .describe('Set to 1 to include reposts/shares (default 0 = exclude reposts)'),
    }),
    handler: async (input) => {
      return client.get('/api/voice/posts', input as Record<string, string | number | undefined>);
    },
  },
  {
    name: 'threads_analytics',
    description: 'Get comprehensive Threads analytics: category breakdown (personal_story/personal_life/resource_share/podcast_promo/ai_opinion/business_work), weekly time-series trends, top/bottom performers, and summary stats. Use this for performance analysis and content strategy insights.',
    inputSchema: z.object({
      range: z.enum(['7d', '30d', '90d', 'all']).optional()
        .describe('Time range for analysis (default: 90d). Use 7d for recent pulse check, 30d for monthly review, 90d for strategic analysis, all for full history.'),
      limit: z.number().min(1).max(50).optional()
        .describe('Number of top/bottom posts to return (default 10, max 50)'),
    }),
    handler: async (input) => {
      return client.get('/api/threads/analytics', input as Record<string, string | number | undefined>);
    },
  },
  {
    name: 'threads_post_detail',
    description: 'Get the full text and complete engagement data for a single Threads post. Use threads_list_posts first to find a post_id, then call this to read the full content.',
    inputSchema: z.object({
      postId: z.string().describe('Threads post ID (e.g. "18101364005010223"). Get this from threads_list_posts.'),
    }),
    handler: async (input) => {
      return client.get(`/api/threads/posts/${input.postId}`);
    },
  },
];
