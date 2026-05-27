import { z } from 'zod';
import { client } from '../client.js';
import type { ToolDef } from '../types.js';

export const settingsTools: ToolDef[] = [
  {
    name: 'settings_get',
    description: 'Get all system settings as key-value pairs.',
    inputSchema: z.object({}),
    handler: async () => {
      return client.get('/api/settings');
    },
  },
  {
    name: 'settings_update',
    description: 'Update a system setting.',
    inputSchema: z.object({
      key: z.string().describe('Setting key'),
      value: z.string().describe('Setting value'),
    }),
    handler: async (input) => {
      return client.put('/api/settings', input);
    },
  },
];
