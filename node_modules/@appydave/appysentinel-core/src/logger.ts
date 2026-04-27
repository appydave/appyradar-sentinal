/**
 * Pino logger factory with child-logger support.
 *
 * Sentinels emit structured logs. Pino is fast, JSON-by-default, and supports
 * child loggers without context-passing ceremony.
 */

import pino, { type Logger as PinoLogger, type LoggerOptions } from 'pino';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface CreateLoggerOptions {
  /** Component name used as the root binding (default: 'sentinel'). */
  name?: string;
  /** Log level. Reads $LOG_LEVEL or defaults to 'info'. */
  level?: LogLevel;
  /**
   * If true, route through pino-pretty for human-readable dev output.
   * Caller must install `pino-pretty` themselves.
   */
  pretty?: boolean;
  /** Extra bindings included on every log line. */
  bindings?: Record<string, unknown>;
}

/** A small re-export type so consumers don't need to depend on pino directly. */
export type Logger = PinoLogger;

/**
 * Create a configured Pino logger. Convenient defaults; opts in to pretty
 * printing only when explicitly requested.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const level: LogLevel = options.level ?? (process.env['LOG_LEVEL'] as LogLevel) ?? 'info';
  const baseOptions: LoggerOptions = {
    name: options.name ?? 'sentinel',
    level,
    ...(options.bindings ? { base: options.bindings } : {}),
  };

  if (options.pretty) {
    return pino({
      ...baseOptions,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard' },
      },
    });
  }

  return pino(baseOptions);
}
