import pino from 'pino';

const globalKey = '__pino_logger__';

function createLogger(): pino.Logger {
  return pino({
    level: process.env.LOG_LEVEL || 'info',
    ...(process.env.NODE_ENV !== 'production' && {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    }),
  });
}

// Reuse logger across Next.js dev mode hot reloads to avoid EventEmitter leaks
const g = globalThis as Record<string, unknown>;
if (!g[globalKey]) g[globalKey] = createLogger();
export const logger = g[globalKey] as pino.Logger;

export function createChildLogger(module: string) {
  return logger.child({ module });
}
