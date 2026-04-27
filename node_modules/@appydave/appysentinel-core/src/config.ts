/**
 * Hierarchical config loader: built-in defaults → env vars → config file.
 *
 * Validated through a Zod schema. Optional file-watch reloads via SIGHUP or
 * a chokidar watcher driven externally.
 *
 * Spec §5.4.
 */

import { promises as fs } from 'node:fs';
import { z } from 'zod';

export interface ConfigLoaderOptions<T> {
  /** Zod schema describing the merged config. */
  schema: z.ZodType<T>;

  /** Static defaults applied first. */
  defaults?: Partial<T>;

  /**
   * Map of env var names → object paths to layer in.
   *
   * Example: `{ LOG_LEVEL: 'logger.level' }` reads `process.env.LOG_LEVEL`
   * and sets `config.logger.level`. Values are strings; coerce inside the
   * Zod schema (via `z.coerce.number()` etc).
   */
  env?: Record<string, string>;

  /** Optional path to a JSON config file. Missing file is not an error. */
  filePath?: string;

  /**
   * Custom env source (defaults to process.env). Useful for tests.
   */
  envSource?: NodeJS.ProcessEnv;
}

export interface ConfigLoader<T> {
  /** Load + validate the merged config. Throws on schema errors. */
  load(): Promise<T>;

  /**
   * Re-read the config file and re-merge env. Returns the new config.
   * Subscribers registered via `onChange` are notified.
   */
  reload(): Promise<T>;

  /** Register a change handler. Returns an unsubscribe function. */
  onChange(handler: (config: T) => void): () => void;

  /** Most recently loaded config, if any. */
  current(): T | undefined;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let node: Record<string, unknown> = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const seg = segments[i]!;
    const next = node[seg];
    if (next === undefined || next === null || typeof next !== 'object') {
      const fresh: Record<string, unknown> = {};
      node[seg] = fresh;
      node = fresh;
    } else {
      node = next as Record<string, unknown>;
    }
  }
  node[segments[segments.length - 1]!] = value;
}

/** Deep merge — plain objects only, arrays replace. */
function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const existing = out[key];
    if (
      existing &&
      typeof existing === 'object' &&
      !Array.isArray(existing) &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      out[key] = deepMerge(
        existing as Record<string, unknown>,
        value as Record<string, unknown>
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await fs.readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error(`config file ${path} must contain a JSON object`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

/**
 * Create a hierarchical config loader.
 *
 * Layering order (later overrides earlier):
 * 1. `options.defaults`
 * 2. JSON file at `options.filePath` (if present)
 * 3. environment variables mapped via `options.env`
 *
 * Validation runs once at the end against `options.schema`.
 */
export function createConfigLoader<T>(options: ConfigLoaderOptions<T>): ConfigLoader<T> {
  const handlers = new Set<(config: T) => void>();
  let lastConfig: T | undefined;
  const envSource = options.envSource ?? process.env;

  const buildOnce = async (): Promise<T> => {
    let merged: Record<string, unknown> = (options.defaults ?? {}) as Record<string, unknown>;

    if (options.filePath) {
      const fileLayer = await readJsonFile(options.filePath);
      if (fileLayer) merged = deepMerge(merged, fileLayer);
    }

    if (options.env) {
      const envOverlay: Record<string, unknown> = {};
      for (const [varName, dottedPath] of Object.entries(options.env)) {
        const raw = envSource[varName];
        if (raw !== undefined) {
          setPath(envOverlay, dottedPath, raw);
        }
      }
      if (Object.keys(envOverlay).length > 0) {
        merged = deepMerge(merged, envOverlay);
      }
    }

    return options.schema.parse(merged);
  };

  return {
    async load() {
      const cfg = await buildOnce();
      lastConfig = cfg;
      return cfg;
    },

    async reload() {
      const cfg = await buildOnce();
      lastConfig = cfg;
      for (const handler of handlers) {
        try {
          handler(cfg);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[appysentinel] config onChange handler error', err);
        }
      }
      return cfg;
    },

    onChange(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },

    current() {
      return lastConfig;
    },
  };
}

export { z };
