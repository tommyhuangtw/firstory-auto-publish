import { z } from 'zod';
import { client } from '../client.js';
import type { ToolDef } from '../types.js';

export const mediaTools: ToolDef[] = [
  {
    name: 'thumbnail_styles_list',
    description: 'List all available YouTube thumbnail styles with their visual properties and sample images.',
    inputSchema: z.object({}),
    handler: async () => {
      return client.get('/api/thumbnail-styles');
    },
  },
  {
    name: 'thumbnail_styles_generate',
    description: 'Generate new thumbnail styles using LLM. Returns the generated style definitions.',
    inputSchema: z.object({
      count: z.number().min(1).max(30).optional().describe('Number of styles to generate (default 5)'),
    }),
    handler: async (input) => {
      return client.post('/api/thumbnail-styles/generate', input);
    },
  },
  {
    name: 'thumbnail_style_toggle',
    description: 'Enable or disable a thumbnail style.',
    inputSchema: z.object({
      id: z.number().describe('Style ID'),
      isEnabled: z.boolean(),
    }),
    handler: async (input) => {
      const { id, ...body } = input;
      return client.patch(`/api/thumbnail-styles/${id}`, body);
    },
  },
];
