/**
 * SignalBus — internal pub/sub for emitting Signals from collectors and
 * subscribing from transports / stores / interfaces.
 *
 * Design notes:
 * - Sync emit, optionally async handlers. Handlers returning a promise are
 *   awaited inside `emit()` only when callers use `emitAndWait`. Plain `emit()`
 *   is fire-and-forget — handler errors are caught and logged via the supplied
 *   onError hook so that one bad subscriber cannot bring down the bus.
 * - `on()` returns an unsubscribe function. Idempotent.
 * - The bus is intentionally tiny — no wildcard topic matching, no priorities.
 *   Filtering is the subscriber's job (`signal.kind`, `signal.source`, ...).
 */

import type { Signal, SignalPayload } from './signal.js';

/** Handler invoked for every Signal emitted on the bus. */
export type SignalHandler = (signal: Signal) => void | Promise<void>;

/** Hook invoked when a subscriber throws or rejects. */
export type BusErrorHook = (err: unknown, signal: Signal) => void;

export interface SignalBusOptions {
  /**
   * Called when any handler throws or its promise rejects. Defaults to a
   * console.error so that subscriber errors are not silently swallowed.
   */
  onError?: BusErrorHook;
}

export interface SignalBus {
  /**
   * Emit a Signal. Returns immediately. Handler errors are reported via
   * the configured onError hook but do not propagate to the caller.
   */
  emit<P extends SignalPayload>(signal: Signal<P>): void;

  /**
   * Emit a Signal and await every handler. Use sparingly — only when
   * back-pressure is meaningful (e.g. critical store flush before shutdown).
   */
  emitAndWait<P extends SignalPayload>(signal: Signal<P>): Promise<void>;

  /**
   * Subscribe to all Signals. Returns an unsubscribe function.
   */
  on(handler: SignalHandler): () => void;

  /**
   * Number of active subscribers. Useful for tests + diagnostics.
   */
  size(): number;
}

/**
 * Create a new in-memory SignalBus. Each Sentinel owns one.
 */
export function createSignalBus(options: SignalBusOptions = {}): SignalBus {
  const handlers = new Set<SignalHandler>();
  const onError: BusErrorHook =
    options.onError ??
    ((err, signal) => {
      // eslint-disable-next-line no-console
      console.error('[appysentinel] signal handler error', { signalId: signal.id, err });
    });

  return {
    emit(signal) {
      for (const handler of handlers) {
        try {
          const result = handler(signal);
          if (result && typeof (result as Promise<void>).then === 'function') {
            (result as Promise<void>).catch((err) => onError(err, signal));
          }
        } catch (err) {
          onError(err, signal);
        }
      }
    },

    async emitAndWait(signal) {
      for (const handler of handlers) {
        try {
          await handler(signal);
        } catch (err) {
          onError(err, signal);
        }
      }
    },

    on(handler) {
      handlers.add(handler);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        handlers.delete(handler);
      };
    },

    size() {
      return handlers.size;
    },
  };
}
