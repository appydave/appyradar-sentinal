/**
 * @appydave/appysentinel-core — runtime library entry point.
 *
 * Re-exports every primitive plus the `createSentinel()` factory. Most
 * scaffolded projects only need the default factory and the Signal types.
 */

export {
  type Signal,
  type SignalKind,
  type SignalSeverity,
  type SignalPayload,
  type SignalInput,
  type SignalContext,
  SIGNAL_SCHEMA_VERSION,
  mintSignal,
} from './signal.js';

export {
  type SignalBus,
  type SignalBusOptions,
  type SignalHandler,
  type BusErrorHook,
  createSignalBus,
} from './bus.js';

export {
  type Lifecycle,
  type LifecycleStatus,
  type StopReason,
  type HealthReport,
  type StartHook,
  type StopHook,
  type ReloadHook,
  type CreateLifecycleOptions,
  createLifecycle,
} from './lifecycle.js';

export {
  type ConfigLoader,
  type ConfigLoaderOptions,
  createConfigLoader,
  z,
} from './config.js';

export { atomicWrite, type AtomicWriteOptions } from './atomic-write.js';

export { SerialQueue } from './serial-queue.js';

export { createLogger, type Logger, type LogLevel, type CreateLoggerOptions } from './logger.js';

export {
  type Sentinel,
  type CreateSentinelOptions,
  createSentinel,
} from './create-sentinel.js';
