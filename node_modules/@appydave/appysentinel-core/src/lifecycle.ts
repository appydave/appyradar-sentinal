/**
 * Lifecycle harness — start, stop, reload, health.
 *
 * Coordinates graceful shutdown across the Sentinel:
 * - Registers SIGINT / SIGTERM / SIGHUP listeners on first `start()`.
 * - SIGINT/SIGTERM trigger `stop(reason)` exactly once.
 * - SIGHUP triggers `reload()`.
 * - Hooks fire in registration order on start, reverse order on stop.
 * - `health()` is a synchronous snapshot suitable for `/health` endpoints.
 *
 * Spec §5.3.
 */

export type StopReason = 'sigint' | 'sigterm' | 'reload' | 'fatal' | 'manual';

export type LifecycleStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';

export interface HealthReport {
  status: LifecycleStatus;
  startedAt?: string;
  stoppedAt?: string;
  uptimeMs?: number;
  hooks: { start: number; stop: number; reload: number };
  lastError?: string;
}

export type StartHook = () => void | Promise<void>;
export type StopHook = (reason: StopReason) => void | Promise<void>;
export type ReloadHook = () => void | Promise<void>;

export interface Lifecycle {
  start(): Promise<void>;
  stop(reason?: StopReason): Promise<void>;
  reload(): Promise<void>;
  health(): HealthReport;

  /** Register a hook that runs during `start()`. Returns an unsubscribe fn. */
  onStart(hook: StartHook): () => void;
  /** Register a hook that runs during `stop()`. Reverse-order. */
  onStop(hook: StopHook): () => void;
  /** Register a hook that runs during `reload()` / SIGHUP. */
  onReload(hook: ReloadHook): () => void;
}

export interface CreateLifecycleOptions {
  /**
   * Whether to wire OS signal handlers (SIGINT/SIGTERM/SIGHUP) automatically.
   * Defaults to true in production. Set false in tests.
   */
  installSignalHandlers?: boolean;
  /** Optional log hook. */
  log?: (level: 'info' | 'warn' | 'error', msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * Build a Lifecycle. The returned object is independent — multiple Sentinels
 * in the same process each get their own (though OS signals will fan out).
 */
export function createLifecycle(options: CreateLifecycleOptions = {}): Lifecycle {
  const startHooks: StartHook[] = [];
  const stopHooks: StopHook[] = [];
  const reloadHooks: ReloadHook[] = [];
  const installSignalHandlers = options.installSignalHandlers ?? true;
  const log =
    options.log ??
    (() => {
      /* default: silent */
    });

  let status: LifecycleStatus = 'idle';
  let startedAt: Date | undefined;
  let stoppedAt: Date | undefined;
  let lastError: string | undefined;
  let stopPromise: Promise<void> | undefined;
  let signalHandlersInstalled = false;

  const installHandlers = (lifecycle: Lifecycle): void => {
    if (signalHandlersInstalled || !installSignalHandlers) return;
    signalHandlersInstalled = true;

    const handle = (reason: StopReason) => () => {
      log('info', `lifecycle: received signal`, { reason });
      void lifecycle.stop(reason).then(() => {
        // Once everything has shut down, exit cleanly so the process doesn't hang.
        process.exit(0);
      });
    };

    process.once('SIGINT', handle('sigint'));
    process.once('SIGTERM', handle('sigterm'));
    process.on('SIGHUP', () => {
      log('info', 'lifecycle: received SIGHUP, reloading');
      void lifecycle.reload().catch((err) => {
        log('error', 'lifecycle: reload failed', { err: String(err) });
      });
    });
  };

  const lifecycle: Lifecycle = {
    async start() {
      if (status === 'starting' || status === 'running') return;
      status = 'starting';
      lastError = undefined;
      startedAt = new Date();
      stoppedAt = undefined;

      try {
        for (const hook of startHooks) {
          await hook();
        }
        status = 'running';
        installHandlers(lifecycle);
        log('info', 'lifecycle: started');
      } catch (err) {
        status = 'failed';
        lastError = String(err);
        log('error', 'lifecycle: start failed', { err: lastError });
        throw err;
      }
    },

    async stop(reason: StopReason = 'manual') {
      if (status === 'stopped' || status === 'idle') return;
      if (stopPromise) return stopPromise;

      status = 'stopping';
      log('info', 'lifecycle: stopping', { reason });

      stopPromise = (async () => {
        // Reverse order — last-in, first-out.
        for (let i = stopHooks.length - 1; i >= 0; i -= 1) {
          const hook = stopHooks[i]!;
          try {
            await hook(reason);
          } catch (err) {
            log('error', 'lifecycle: stop hook threw', { err: String(err) });
          }
        }
        status = 'stopped';
        stoppedAt = new Date();
        log('info', 'lifecycle: stopped');
      })();

      return stopPromise;
    },

    async reload() {
      if (status !== 'running') {
        log('warn', 'lifecycle: reload requested but not running', { status });
        return;
      }
      log('info', 'lifecycle: reloading');
      for (const hook of reloadHooks) {
        try {
          await hook();
        } catch (err) {
          log('error', 'lifecycle: reload hook threw', { err: String(err) });
        }
      }
    },

    health(): HealthReport {
      const report: HealthReport = {
        status,
        hooks: {
          start: startHooks.length,
          stop: stopHooks.length,
          reload: reloadHooks.length,
        },
      };
      if (startedAt) {
        report.startedAt = startedAt.toISOString();
        report.uptimeMs = Date.now() - startedAt.getTime();
      }
      if (stoppedAt) report.stoppedAt = stoppedAt.toISOString();
      if (lastError) report.lastError = lastError;
      return report;
    },

    onStart(hook) {
      startHooks.push(hook);
      return () => {
        const idx = startHooks.indexOf(hook);
        if (idx >= 0) startHooks.splice(idx, 1);
      };
    },

    onStop(hook) {
      stopHooks.push(hook);
      return () => {
        const idx = stopHooks.indexOf(hook);
        if (idx >= 0) stopHooks.splice(idx, 1);
      };
    },

    onReload(hook) {
      reloadHooks.push(hook);
      return () => {
        const idx = reloadHooks.indexOf(hook);
        if (idx >= 0) reloadHooks.splice(idx, 1);
      };
    },
  };

  return lifecycle;
}
