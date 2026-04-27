/**
 * `createSentinel()` — the factory that wires every primitive into a single
 * Sentinel object. This is the entry point used by every scaffolded project.
 *
 * Returned object exposes:
 * - `start()` / `stop()` / `reload()` — delegated to the lifecycle harness
 * - `emit(input)` — mints a Signal and publishes it on the bus
 * - `on(handler)` — subscribe to all Signals
 * - `bus` / `lifecycle` / `logger` — escape hatches for advanced use
 *
 * Spec §5 ties everything together; this is the binding.
 */

import { ulid } from 'ulid';
import { createSignalBus, type SignalBus } from './bus.js';
import { createLifecycle, type Lifecycle } from './lifecycle.js';
import { createLogger, type Logger } from './logger.js';
import {
  mintSignal,
  type Signal,
  type SignalContext,
  type SignalInput,
  type SignalPayload,
} from './signal.js';

export interface CreateSentinelOptions {
  /**
   * Logical name for this Sentinel. Surfaces in logs and as the default
   * `sentinel_id` prefix.
   */
  name: string;

  /**
   * Machine identifier — written into every Signal envelope. Typically
   * `process.env.MACHINE_NAME` or `os.hostname()`.
   */
  machine: string;

  /**
   * Unique ID for this Sentinel instance. Defaults to `<name>-<ulid>`.
   * Use a stable value if you run multiple instances and want them
   * identifiable across restarts.
   */
  sentinelId?: string;

  /** Optional pre-built logger. If omitted, one is created with `name`. */
  logger?: Logger;

  /** Optional pre-built bus. If omitted, one is created. */
  bus?: SignalBus;

  /** Optional pre-built lifecycle. If omitted, one is created. */
  lifecycle?: Lifecycle;

  /** Skip OS signal handler installation. Default: false in prod, true in tests. */
  installSignalHandlers?: boolean;
}

export interface Sentinel {
  /** Logical name. */
  readonly name: string;
  /** Machine identifier. */
  readonly machine: string;
  /** Sentinel instance ID. */
  readonly sentinelId: string;
  /** The Pino logger. */
  readonly logger: Logger;
  /** The internal SignalBus. */
  readonly bus: SignalBus;
  /** The lifecycle harness. */
  readonly lifecycle: Lifecycle;

  /** Mint a Signal from a partial input and emit it. Returns the Signal. */
  emit<P extends SignalPayload>(input: SignalInput<P>): Signal<P>;

  /**
   * Mint and emit, awaiting all subscribers. Use sparingly — only when
   * back-pressure matters.
   */
  emitAndWait<P extends SignalPayload>(input: SignalInput<P>): Promise<Signal<P>>;

  /** Subscribe to every Signal. Returns unsubscribe. */
  on(handler: (signal: Signal) => void | Promise<void>): () => void;

  /** Start the lifecycle. */
  start(): Promise<void>;
  /** Stop the lifecycle. */
  stop(reason?: 'sigint' | 'sigterm' | 'reload' | 'fatal' | 'manual'): Promise<void>;
  /** Trigger reload hooks. */
  reload(): Promise<void>;
}

/**
 * Build a Sentinel. The returned object owns its bus, lifecycle, and logger
 * unless they were supplied via options.
 *
 * No work is performed until `start()` is called.
 */
export function createSentinel(options: CreateSentinelOptions): Sentinel {
  const sentinelId = options.sentinelId ?? `${options.name}-${ulid()}`;
  const logger = options.logger ?? createLogger({ name: options.name });

  const bus =
    options.bus ??
    createSignalBus({
      onError: (err, signal) => {
        logger.error({ err, signalId: signal.id }, 'signal handler error');
      },
    });

  const lifecycle =
    options.lifecycle ??
    createLifecycle({
      installSignalHandlers: options.installSignalHandlers,
      log: (level, msg, meta) => {
        logger[level]?.(meta ?? {}, msg);
      },
    });

  const context: SignalContext = {
    machine: options.machine,
    sentinel_id: sentinelId,
  };

  const sentinel: Sentinel = {
    name: options.name,
    machine: options.machine,
    sentinelId,
    logger,
    bus,
    lifecycle,

    emit(input) {
      const signal = mintSignal(input, context);
      bus.emit(signal);
      return signal;
    },

    async emitAndWait(input) {
      const signal = mintSignal(input, context);
      await bus.emitAndWait(signal);
      return signal;
    },

    on(handler) {
      return bus.on(handler);
    },

    async start() {
      await lifecycle.start();
    },

    async stop(reason = 'manual') {
      await lifecycle.stop(reason);
    },

    async reload() {
      await lifecycle.reload();
    },
  };

  return sentinel;
}
