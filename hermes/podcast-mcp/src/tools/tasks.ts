import { z } from 'zod';
import { client } from '../client.js';
import type { ToolDef } from '../types.js';

export const taskTools: ToolDef[] = [
  {
    name: 'task_create',
    description: 'Create a new task on the Kanban board. Use this when Tommy gives you a task via Telegram.',
    inputSchema: z.object({
      title: z.string().describe('Task title'),
      description: z.string().optional().describe('Detailed description'),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
      category: z.enum(['content', 'infra', 'social_media', 'youtube', 'ig', 'threads', 'research', 'ops', 'growth']).default('ops'),
      scheduled_at: z.string().optional().describe('ISO datetime for when to execute (e.g. 2026-06-01T09:00:00)'),
      auto_execute: z.number().min(0).max(1).default(0).describe('1 = auto-execute without Tommy confirmation (research/data tasks only). 0 = requires Tommy approval.'),
      episode_id: z.number().optional().describe('Link to a specific episode ID'),
      created_by: z.string().default('telegram').describe('Who created this task'),
    }),
    handler: async (input) => {
      return client.post('/api/tasks', input);
    },
  },
  {
    name: 'task_list',
    description: 'List tasks on the Kanban board. Filter by status or category.',
    inputSchema: z.object({
      status: z.enum(['todo', 'in_progress', 'review', 'done', 'cancelled']).optional(),
      category: z.enum(['content', 'infra', 'social_media', 'youtube', 'ig', 'threads', 'research', 'ops', 'growth']).optional(),
      auto_execute: z.number().min(0).max(1).optional().describe('Filter by auto_execute flag'),
      limit: z.number().default(50),
    }),
    handler: async (input) => {
      const params: Record<string, string | number> = { limit: input.limit ?? 50 };
      if (input.status) params.status = input.status;
      if (input.category) params.category = input.category;
      if (input.auto_execute !== undefined) params.auto_execute = input.auto_execute;
      return client.get('/api/tasks', params);
    },
  },
  {
    name: 'task_update',
    description: 'Update an existing task (title, description, status, priority, category, scheduled_at, auto_execute, result_notes).',
    inputSchema: z.object({
      id: z.number().describe('Task ID'),
      title: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(['todo', 'in_progress', 'done', 'cancelled']).optional(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
      category: z.enum(['content', 'infra', 'social_media', 'youtube', 'ig', 'threads', 'research', 'ops', 'growth']).optional(),
      scheduled_at: z.string().optional(),
      auto_execute: z.number().min(0).max(1).optional(),
      result_notes: z.string().optional().describe('Notes after completing the task'),
    }),
    handler: async (input) => {
      const { id, ...rest } = input as { id: number } & Record<string, unknown>;
      return client.patch(`/api/tasks/${id}`, rest);
    },
  },
  {
    name: 'task_complete',
    description: 'Mark a task as done and write the result/findings. Use this after completing any task.',
    inputSchema: z.object({
      id: z.number().describe('Task ID'),
      result_notes: z.string().describe('What was done, findings, links, or summary of results'),
    }),
    handler: async (input) => {
      return client.patch(`/api/tasks/${input.id}`, {
        status: 'review',
        completed_by: 'hermes',
        result_notes: input.result_notes,
      });
    },
  },
  {
    name: 'task_comment_add',
    description: `Add a comment/log entry to a task. Use this to record important actions, research results, links, or questions during task execution.
    
Types:
- action    🔧  What you just did (e.g. "Called YouTube Analytics API, got 30-day data")
- research  📄  Research summary, analysis, key findings (supports long markdown)
- discussion 💬 Question or decision that needs Tommy's input
- pr        🔀  GitHub PR link — status auto-synced from GitHub API
- branch    🌿  Git branch reference
- doc       📎  External doc/link (Notion, Google Doc, etc.)
- analysis  📊  Data analysis or report summary
- note      📌  General note

For PR type, include metadata: { url, title?, branch? }
For branch type, include metadata: { branch_name, repo? }  
For doc type, include metadata: { title, url }`,
    inputSchema: z.object({
      task_id: z.number().describe('Task ID'),
      type: z.enum(['action', 'research', 'discussion', 'pr', 'branch', 'doc', 'analysis', 'note']).default('action'),
      content: z.string().describe('Comment body. Markdown supported. For research/analysis, include the full findings here.'),
      author: z.enum(['hermes', 'tommy']).default('hermes'),
      metadata: z.object({
        url: z.string().optional(),
        title: z.string().optional(),
        branch: z.string().optional(),
        branch_name: z.string().optional(),
        repo: z.string().optional(),
        status: z.string().optional(),
        summary: z.string().optional(),
      }).optional().describe('Structured data for pr/branch/doc types'),
    }),
    handler: async (input) => {
      const { task_id, ...body } = input;
      return client.post(`/api/tasks/${task_id}/comments`, body);
    },
  },
];
