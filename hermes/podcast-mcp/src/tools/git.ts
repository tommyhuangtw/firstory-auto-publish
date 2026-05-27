import { z } from 'zod';
import { execFileSync } from 'child_process';
import type { ToolDef } from '../types.js';

const REPO_PATH = process.env.REPO_PATH || process.cwd();

/** Strict branch name pattern: hermes/slug with alphanumeric, dash, underscore, dot, slash */
const BRANCH_NAME_RE = /^hermes\/[a-zA-Z0-9._\/-]+$/;

function git(...args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: REPO_PATH, encoding: 'utf-8', timeout: 30000 }).trim();
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new Error(err.stderr || err.message);
  }
}

function validateBranchName(name: string): void {
  if (!name.startsWith('hermes/')) {
    throw new Error('Branch name must start with "hermes/" for safety');
  }
  if (!BRANCH_NAME_RE.test(name)) {
    throw new Error('Branch name contains invalid characters. Use only alphanumeric, dash, underscore, dot, slash.');
  }
}

function validateRef(ref: string): void {
  if (/[;&|`$(){}]/.test(ref)) {
    throw new Error('Invalid characters in ref name');
  }
}

export const gitTools: ToolDef[] = [
  {
    name: 'git_status',
    description: 'Show current git status: branch, modified files, staged changes.',
    inputSchema: z.object({}),
    handler: async () => {
      const branch = git('branch', '--show-current');
      const status = git('status', '--short');
      const lastCommit = git('log', '-1', '--oneline');
      return { branch, status: status || '(clean)', lastCommit };
    },
  },
  {
    name: 'git_list_branches',
    description: 'List all branches, optionally filtered by prefix (e.g., "hermes/").',
    inputSchema: z.object({
      prefix: z.string().optional().describe('Filter branches by prefix'),
    }),
    handler: async (input) => {
      const all = git('branch', '-a', '--format=%(refname:short)');
      let branches = all.split('\n').filter(Boolean);
      if (input.prefix) {
        branches = branches.filter(b => b.startsWith(input.prefix!));
      }
      return { branches };
    },
  },
  {
    name: 'git_create_branch',
    description: 'Create and checkout a new branch. SAFETY: branch name must start with "hermes/".',
    inputSchema: z.object({
      name: z.string().describe('Branch name (must start with hermes/)'),
      from: z.string().optional().describe('Base branch (default: main)'),
    }),
    handler: async (input) => {
      validateBranchName(input.name);
      const base = input.from || 'main';
      validateRef(base);
      git('checkout', base);
      git('pull', 'origin', base, '--ff-only');
      git('checkout', '-b', input.name);
      return { created: input.name, basedOn: base, currentBranch: git('branch', '--show-current') };
    },
  },
  {
    name: 'git_branch_diff',
    description: 'Show the diff between current branch and main (or specified base). Useful for reviewing changes before requesting merge approval.',
    inputSchema: z.object({
      base: z.string().optional().describe('Base branch to compare against (default: main)'),
      stat: z.boolean().optional().describe('If true, show file-level summary instead of full diff'),
    }),
    handler: async (input) => {
      const base = input.base || 'main';
      validateRef(base);
      if (input.stat) {
        return { diff: git('diff', base, '--stat') };
      }
      const diff = git('diff', base);
      if (diff.length > 10000) {
        return {
          summary: git('diff', base, '--stat'),
          truncated: true,
          fullDiffLines: diff.split('\n').length,
        };
      }
      return { diff };
    },
  },
  {
    name: 'git_checkout',
    description: 'Switch to an existing branch. SAFETY: can only checkout branches starting with "hermes/" or "main".',
    inputSchema: z.object({
      branch: z.string().describe('Branch name'),
    }),
    handler: async (input) => {
      if (!input.branch.startsWith('hermes/') && input.branch !== 'main') {
        throw new Error('Can only checkout hermes/* branches or main');
      }
      validateRef(input.branch);
      git('checkout', input.branch);
      return { currentBranch: git('branch', '--show-current') };
    },
  },
];
