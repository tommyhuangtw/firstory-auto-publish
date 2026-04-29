/**
 * Retry utility with exponential backoff.
 *
 * Mirrors LLMService retry parameters for consistency:
 *   3 retries, 1s base delay, 5s max delay.
 */

import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('retry');

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);

const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  label?: string;
}

/**
 * Wrap an async function with retry + exponential backoff.
 *
 * Works with both `fetch()` (checks Response.ok + status) and
 * generic async functions that throw on failure.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 1000, maxDelayMs = 5000, label = '' } = options || {};

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const result = await fn();

      // If result is a fetch Response, check status
      if (result && typeof result === 'object' && 'ok' in result && 'status' in result) {
        const resp = result as unknown as Response;
        if (!resp.ok && RETRYABLE_STATUSES.has(resp.status) && attempt <= maxRetries) {
          const body = await resp.clone().text().catch(() => '');
          lastError = new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
          const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
          log.warn({ label, attempt, status: resp.status, delay }, 'Retryable HTTP status');
          await sleep(delay);
          continue;
        }
      }

      return result;
    } catch (error) {
      lastError = error as Error;

      if (attempt > maxRetries || !isRetryable(lastError)) {
        throw lastError;
      }

      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      log.warn({ label, attempt, error: lastError.message, delay }, 'Retrying after error');
      await sleep(delay);
    }
  }

  throw lastError!;
}

function isRetryable(error: Error): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  if (code && RETRYABLE_ERROR_CODES.has(code)) return true;
  if (error.message.includes('fetch failed')) return true;
  if (error.message.includes('network')) return true;
  if (error.message.includes('529')) return true;
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
