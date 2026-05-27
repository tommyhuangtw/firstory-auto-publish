import { z } from 'zod';
import { execFileSync } from 'child_process';
import type { ToolDef } from '../types.js';

const REPO_PATH = process.env.REPO_PATH || process.cwd();

export const claudeCodeTools: ToolDef[] = [
  {
    name: 'code_with_claude',
    description:
      'Delegate a coding task to Claude Code CLI (uses Claude Max subscription). ' +
      'Use this for tasks that require writing, editing, or reviewing code. ' +
      'Claude will work in the podcast automation repository and return the result.',
    inputSchema: z.object({
      prompt: z.string().describe('The coding task description for Claude to execute'),
      workdir: z
        .string()
        .optional()
        .describe('Working directory (must be within the repo). Defaults to repo root.'),
      allowedTools: z
        .array(z.string())
        .optional()
        .describe('Tools Claude is allowed to use (e.g. ["Read", "Edit", "Write", "Bash"]). Defaults to all.'),
    }),
    handler: async (input) => {
      const cwd = input.workdir
        ? validateWorkdir(input.workdir)
        : REPO_PATH;

      const args = ['-p', input.prompt, '--output-format', 'text'];

      if (input.allowedTools?.length) {
        for (const tool of input.allowedTools) {
          args.push('--allowedTools', tool);
        }
      }

      try {
        const output = execFileSync('claude', args, {
          cwd,
          encoding: 'utf-8',
          timeout: 600_000, // 10 minutes for complex coding tasks
          maxBuffer: 1024 * 1024 * 5, // 5MB
        }).trim();

        return { success: true, output };
      } catch (e) {
        const err = e as { stderr?: string; stdout?: string; message: string };
        throw new Error(err.stderr || err.stdout || err.message);
      }
    },
  },
];

function validateWorkdir(dir: string): string {
  const resolved = require('path').resolve(dir);
  if (!resolved.startsWith(REPO_PATH)) {
    throw new Error(`Working directory must be within the repo: ${REPO_PATH}`);
  }
  return resolved;
}
