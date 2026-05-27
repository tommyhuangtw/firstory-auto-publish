import { z } from 'zod';
import type { ToolDef } from '../types.js';

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'http://localhost:5678';

async function n8nRequest(path: string, options: { method?: string; body?: unknown } = {}): Promise<unknown> {
  const { method = 'GET', body } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(`${N8N_WEBHOOK_URL}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { status: res.status, response: text.slice(0, 500) };
    }
  } finally {
    clearTimeout(timer);
  }
}

export const n8nTools: ToolDef[] = [
  {
    name: 'n8n_trigger_threads_curation',
    description: 'Trigger the n8n Threads content curation workflow. This searches YouTube, Reddit, GitHub, and X/Twitter for AI-related content, scores it with LLM, and generates Threads posts for review.',
    inputSchema: z.object({
      webhookPath: z.string().optional().describe('Custom webhook path if different from default'),
    }),
    handler: async (input) => {
      const path = input.webhookPath || '/webhook/threads-curation';
      return n8nRequest(path, { method: 'POST', body: { trigger: 'hermes', timestamp: new Date().toISOString() } });
    },
  },
  {
    name: 'n8n_trigger_workflow',
    description: 'Trigger any n8n workflow by its webhook path.',
    inputSchema: z.object({
      webhookPath: z.string().describe('The webhook path (e.g., /webhook/my-workflow)'),
      payload: z.record(z.unknown()).optional().describe('JSON payload to send'),
    }),
    handler: async (input) => {
      if (!input.webhookPath.startsWith('/webhook/') || /[;&|`$(){}]/.test(input.webhookPath)) {
        throw new Error('webhookPath must start with /webhook/ and contain no special characters');
      }
      return n8nRequest(input.webhookPath, { method: 'POST', body: input.payload || {} });
    },
  },
  {
    name: 'n8n_workflow_status',
    description: 'Check if n8n is reachable and get basic status.',
    inputSchema: z.object({}),
    handler: async () => {
      try {
        const res = await fetch(`${N8N_WEBHOOK_URL}/healthz`, { signal: AbortSignal.timeout(5000) });
        return { reachable: res.ok, status: res.status };
      } catch (e) {
        return { reachable: false, error: (e as Error).message };
      }
    },
  },
];
