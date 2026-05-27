import { z } from 'zod';
import { client } from '../client.js';
import type { ToolDef } from '../types.js';

export const episodeTools: ToolDef[] = [
  {
    name: 'episodes_list',
    description: 'List episodes with optional filters. Status values: generating, pending_review, approved, publishing, published, rejected, failed.',
    inputSchema: z.object({
      status: z.string().optional().describe('Filter by episode status'),
      segment: z.string().optional().describe('Filter by segment type (daily/weekly/robot/sysdesign/quickchat)'),
      limit: z.number().optional().describe('Max results (default 50)'),
      offset: z.number().optional().describe('Pagination offset (default 0)'),
    }),
    handler: async (input) => {
      return client.get('/api/episodes', input as Record<string, string | number | undefined>);
    },
  },
  {
    name: 'episode_status',
    description: 'Get detailed status of a specific episode including title, URLs, and timestamps.',
    inputSchema: z.object({
      id: z.number().describe('Episode ID'),
    }),
    handler: async (input) => {
      return client.get(`/api/episodes/${input.id}/status`);
    },
  },
  {
    name: 'episode_approve',
    description: 'Approve an episode for publishing. Triggers multi-platform publish (SoundOn, YouTube, Instagram, Facebook, Threads). Can optionally override title and description.',
    inputSchema: z.object({
      id: z.number().describe('Episode ID'),
      selectedTitle: z.string().optional().describe('Override the selected title'),
      description: z.string().optional().describe('Override the description'),
      youtubeDescription: z.string().optional().describe('Override YouTube-specific description'),
    }),
    handler: async (input) => {
      const { id, ...body } = input;
      return client.post(`/api/episodes/${id}/approve`, body);
    },
  },
  {
    name: 'episode_reject',
    description: 'Reject an episode or reset it back to review status.',
    inputSchema: z.object({
      id: z.number().describe('Episode ID'),
      reason: z.string().optional().describe('Rejection reason'),
      resetToReview: z.boolean().optional().describe('If true, reset to pending_review instead of rejected'),
    }),
    handler: async (input) => {
      const { id, ...body } = input;
      return client.post(`/api/episodes/${id}/reject`, body);
    },
  },
  {
    name: 'episode_save_meta',
    description: 'Update episode metadata: title, description, and social media captions.',
    inputSchema: z.object({
      id: z.number().describe('Episode ID'),
      selectedTitle: z.string().optional(),
      description: z.string().optional(),
      igCaption: z.string().optional(),
      fbCaption: z.string().optional(),
      threadsCaption: z.string().optional(),
    }),
    handler: async (input) => {
      const { id, ...body } = input;
      return client.post(`/api/episodes/${id}/save-meta`, body);
    },
  },
  {
    name: 'episode_edit_script',
    description: 'Edit the Chinese or English script of an episode.',
    inputSchema: z.object({
      id: z.number().describe('Episode ID'),
      scriptZh: z.string().optional().describe('Chinese script'),
      scriptEn: z.string().optional().describe('English script'),
    }),
    handler: async (input) => {
      const { id, ...body } = input;
      return client.post(`/api/episodes/${id}/edit-script`, body);
    },
  },
  {
    name: 'episode_regenerate_titles',
    description: 'Regenerate candidate titles for an episode using LLM.',
    inputSchema: z.object({
      id: z.number().describe('Episode ID'),
      prompt: z.string().optional().describe('Custom prompt to guide title generation'),
    }),
    handler: async (input) => {
      const { id, ...body } = input;
      return client.post(`/api/episodes/${id}/regenerate-titles`, body);
    },
  },
  {
    name: 'episode_regenerate_description',
    description: 'Regenerate the episode description using LLM.',
    inputSchema: z.object({
      id: z.number().describe('Episode ID'),
    }),
    handler: async (input) => {
      return client.post(`/api/episodes/${input.id}/regenerate-description`);
    },
  },
  {
    name: 'episode_regenerate_cover',
    description: 'Regenerate the cover image for an episode. Returns task ID for async polling.',
    inputSchema: z.object({
      id: z.number().describe('Episode ID'),
    }),
    handler: async (input) => {
      return client.post(`/api/episodes/${input.id}/regenerate-cover`);
    },
  },
  {
    name: 'episode_regenerate_ig_caption',
    description: 'Regenerate the Instagram caption for an episode using LLM.',
    inputSchema: z.object({
      id: z.number().describe('Episode ID'),
    }),
    handler: async (input) => {
      return client.post(`/api/episodes/${input.id}/regenerate-ig`);
    },
  },
  {
    name: 'episode_generate_fb_caption',
    description: 'Generate a Facebook caption for an episode using LLM.',
    inputSchema: z.object({
      id: z.number().describe('Episode ID'),
    }),
    handler: async (input) => {
      return client.post(`/api/episodes/${input.id}/generate-fb-caption`);
    },
  },
  {
    name: 'episode_republish',
    description: 'Republish an episode to one or all platforms. Useful when a specific platform failed during initial publish.',
    inputSchema: z.object({
      id: z.number().describe('Episode ID'),
      platform: z.enum(['soundon', 'youtube', 'instagram', 'facebook', 'threads', 'all']).describe('Target platform or "all"'),
    }),
    handler: async (input) => {
      const { id, ...body } = input;
      return client.post(`/api/episodes/${id}/republish`, body);
    },
  },
];
