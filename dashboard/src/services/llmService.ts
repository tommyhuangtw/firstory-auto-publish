import { getDb } from '@/db';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('llm');

// Model pricing (USD per 1M tokens) — update as needed
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'google/gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'google/gemini-2.5-flash-lite': { input: 0.02, output: 0.10 },
  'google/gemini-2.5-pro': { input: 1.25, output: 10.00 },
  'anthropic/claude-3.7-sonnet': { input: 3.00, output: 15.00 },
  'google/gemini-3.1-pro-preview': { input: 2.00, output: 12.00 },
  'google/gemini-3.1-flash-lite-preview': { input: 0.25, output: 1.50 },
  'google/gemini-3-flash-preview': { input: 0.15, output: 0.60 },
  'openai/gpt-5.4': { input: 2.50, output: 10.00 },
  'openai/gpt-5.5': { input: 5.00, output: 30.00 },
  'anthropic/claude-sonnet-4.6': { input: 3.00, output: 15.00 },
};

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  preferredModel?: string;
  retryCount?: number;
}

interface LLMUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface LLMResponse {
  success: boolean;
  model: string | null;
  content: string | null;
  usage: LLMUsage;
  error?: string;
}

interface LLMCallParams {
  stage: string;
  episodeId?: number;
  episodeNumber?: number | null;
  messages: LLMMessage[];
  options?: LLMOptions;
}

function calculateCost(model: string, usage: LLMUsage): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing || !usage.prompt_tokens || !usage.completion_tokens) return 0;
  return (
    (usage.prompt_tokens / 1_000_000) * pricing.input +
    (usage.completion_tokens / 1_000_000) * pricing.output
  );
}

export class LLMService {
  private apiKey: string;
  private baseURL = 'https://openrouter.ai/api/v1';
  private models = {
    primary: 'google/gemini-2.5-flash',
    fallback: 'anthropic/claude-3.7-sonnet',
  };

  constructor() {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error('OPENROUTER_API_KEY not set');
    this.apiKey = key;
  }

  /**
   * Main entry point — calls LLM and auto-logs to llm_calls table
   */
  async call(params: LLMCallParams): Promise<LLMResponse> {
    const { stage, episodeId, episodeNumber, messages, options = {} } = params;
    const {
      temperature = 0.7,
      maxTokens = 2048,
      preferredModel,
      retryCount = 3,
    } = options;

    const modelsToTry = preferredModel
      ? [preferredModel, ...Object.values(this.models).filter((m) => m !== preferredModel)]
      : [this.models.primary, this.models.fallback];

    const startTime = Date.now();
    let lastError: Error | null = null;

    for (const model of modelsToTry) {
      log.info({ model, stage }, 'Trying model');

      for (let attempt = 1; attempt <= retryCount; attempt++) {
        try {
          const result = await this.callAPI(model, messages, temperature, maxTokens);

          if (result.success) {
            const latency = Date.now() - startTime;
            const cost = calculateCost(model, result.usage);

            // Auto-log to SQLite (with full prompt/response for debugging)
            this.logCall({
              episodeId,
              episodeNumber: episodeNumber ?? undefined,
              stage,
              model,
              inputTokens: result.usage.prompt_tokens ?? 0,
              outputTokens: result.usage.completion_tokens ?? 0,
              costUsd: cost,
              latencyMs: latency,
              success: true,
              inputMessages: JSON.stringify(messages),
              outputContent: result.content ?? undefined,
            });

            log.info({ model, stage, latency, cost: cost.toFixed(4) }, 'LLM call succeeded');
            return result;
          }
        } catch (error) {
          lastError = error as Error;
          log.warn({ model, stage, attempt, error: lastError.message }, 'LLM call failed');

          if (attempt < retryCount) {
            const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
            await new Promise((r) => setTimeout(r, waitTime));
          }
        }
      }
    }

    // All attempts failed — log failure (still store prompt for debugging)
    this.logCall({
      episodeId,
      episodeNumber: episodeNumber ?? undefined,
      stage,
      model: modelsToTry[0],
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: Date.now() - startTime,
      success: false,
      errorMessage: lastError?.message,
      inputMessages: JSON.stringify(messages),
    });

    log.error({ stage }, 'All models failed');
    return { success: false, model: null, content: null, usage: {}, error: lastError?.message };
  }

  /**
   * Convenience: call with a simple prompt string
   */
  async generate(
    prompt: string,
    stage: string,
    options?: LLMOptions & { episodeId?: number; episodeNumber?: number | null }
  ): Promise<LLMResponse> {
    const { episodeId, episodeNumber, ...llmOptions } = options ?? {};
    return this.call({
      stage,
      episodeId,
      episodeNumber,
      messages: [{ role: 'user', content: prompt }],
      options: llmOptions,
    });
  }

  /**
   * Generate and parse JSON response
   */
  async generateJSON<T = unknown>(
    prompt: string,
    stage: string,
    options?: LLMOptions & { episodeId?: number; episodeNumber?: number | null }
  ): Promise<{ success: boolean; data?: T; error?: string; model: string | null }> {
    const result = await this.generate(prompt, stage, options);
    if (!result.success || !result.content) {
      return { success: false, error: result.error, model: result.model };
    }

    try {
      const content = result.content;

      // Try direct parse
      try {
        return { success: true, data: JSON.parse(content), model: result.model };
      } catch {
        // Try markdown code block
        const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
        if (jsonMatch) {
          return { success: true, data: JSON.parse(jsonMatch[1]), model: result.model };
        }
        // Try first JSON object
        const objectMatch = content.match(/\{[\s\S]*\}/);
        if (objectMatch) {
          return { success: true, data: JSON.parse(objectMatch[0]), model: result.model };
        }
        throw new Error('No JSON found in response');
      }
    } catch (error) {
      log.error({ stage, error: (error as Error).message }, 'JSON parse failed');
      return { success: false, error: (error as Error).message, model: result.model };
    }
  }

  private async callAPI(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): Promise<LLMResponse> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (process.env.OPENROUTER_SITE_URL) headers['HTTP-Referer'] = process.env.OPENROUTER_SITE_URL;
    if (process.env.OPENROUTER_SITE_NAME) headers['X-Title'] = process.env.OPENROUTER_SITE_NAME;

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`API error (${response.status}): ${data.error?.message || JSON.stringify(data)}`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('No content in API response');

    return { success: true, model, content, usage: data.usage || {} };
  }

  private logCall(params: {
    episodeId?: number;
    episodeNumber?: number;
    stage: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    latencyMs: number;
    success: boolean;
    errorMessage?: string;
    qualityScore?: number;
    inputMessages?: string;
    outputContent?: string;
  }) {
    try {
      const db = getDb();
      db.prepare(
        `INSERT INTO llm_calls (episode_id, episode_number, stage, model, input_tokens, output_tokens,
         cost_usd, latency_ms, quality_score, success, error_message, input_messages, output_content)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        params.episodeId ?? null,
        params.episodeNumber ?? null,
        params.stage,
        params.model,
        params.inputTokens,
        params.outputTokens,
        params.costUsd,
        params.latencyMs,
        params.qualityScore ?? null,
        params.success ? 1 : 0,
        params.errorMessage ?? null,
        params.inputMessages ?? null,
        params.outputContent ?? null
      );
    } catch (error) {
      log.error({ error: (error as Error).message }, 'Failed to log LLM call to DB');
    }
  }
}

// Singleton
let _instance: LLMService | null = null;
export function getLLMService(): LLMService {
  if (!_instance) _instance = new LLMService();
  return _instance;
}
