import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { ToolDef } from './types.js';

import { pipelineTools } from './tools/pipeline.js';
import { episodeTools } from './tools/episodes.js';
import { schedulerTools } from './tools/scheduler.js';
import { analyticsTools } from './tools/analytics.js';
import { youtubeTools } from './tools/youtube.js';
import { mediaTools } from './tools/media.js';
import { settingsTools } from './tools/settings.js';
import { n8nTools } from './tools/n8n.js';
import { gitTools } from './tools/git.js';
import { taskTools } from './tools/tasks.js';
import { claudeCodeTools } from './tools/claude-code.js';
import { trendTools } from './tools/trends.js';

const allTools: ToolDef[] = [
  ...pipelineTools,
  ...episodeTools,
  ...schedulerTools,
  ...analyticsTools,
  ...youtubeTools,
  ...mediaTools,
  ...settingsTools,
  ...n8nTools,
  ...gitTools,
  ...taskTools,
  ...claudeCodeTools,
  ...trendTools,
];

const server = new McpServer({
  name: 'podcast-mcp',
  version: '1.0.0',
});

for (const tool of allTools) {
  const shape = tool.inputSchema instanceof z.ZodObject
    ? tool.inputSchema.shape
    : {};

  server.tool(
    tool.name,
    tool.description,
    shape,
    async (params: Record<string, unknown>) => {
      try {
        const result = await tool.handler(params as Record<string, unknown>);
        return {
          content: [
            {
              type: 'text' as const,
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Error: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
