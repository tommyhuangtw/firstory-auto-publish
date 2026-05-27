import type { z } from 'zod';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  handler: (input: any) => Promise<unknown>;
}
