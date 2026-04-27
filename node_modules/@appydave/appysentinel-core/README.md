# @appydave/appysentinel-core

Runtime library for AppySentinel — the per-machine, observer-only telemetry collector boilerplate.

This package ships the **seven baked-in primitives** that every Sentinel uses (spec §5):

1. **Signal envelope** — common outer contract (`Signal<P>`)
2. **SignalBus** — internal pub/sub
3. **Lifecycle harness** — start / stop / reload / health, with SIGINT/SIGTERM/SIGHUP wiring
4. **ConfigLoader** — defaults → file → env, Zod-validated, reloadable
5. **atomicWrite** — temp-file + rename helper
6. **SerialQueue** — promise-chain serialisation primitive
7. **Logger** — pre-configured Pino with child-logger support

Plus the convenience factory `createSentinel()` that wires them all together.

## Installation

```bash
bun add @appydave/appysentinel-core
# or
npm install @appydave/appysentinel-core
```

## Usage

```typescript
import { createSentinel } from '@appydave/appysentinel-core';

const sentinel = createSentinel({
  name: 'my-sentinel',
  machine: process.env.MACHINE_NAME ?? 'unknown',
});

sentinel.on((signal) => {
  console.log(signal.kind, signal.name, signal.payload);
});

sentinel.lifecycle.onStart(async () => {
  // wire collectors here
});

sentinel.lifecycle.onStop(async (reason) => {
  // flush + close handles
});

await sentinel.start();

sentinel.emit({
  source: 'demo',
  kind: 'event',
  name: 'sentinel.started',
  payload: { example: true },
});
```

## What this library is not

- **Not a collector** — `watch-directory`, `poll-command`, etc. are *recipes* (markdown specs), not bundled code.
- **Not a transport** — `http-push`, `otlp-push`, etc. are recipes.
- **Not an interface** — REST / MCP / Socket.io are recipes.

Recipes are generated into your project by the `configure-sentinel` agent at scaffold time. Core is intentionally just the plumbing.

## Module map

| Subpath | Exports |
|---------|---------|
| (root) `@appydave/appysentinel-core` | everything |
| `/signal` | `Signal`, `SignalKind`, `SignalPayload`, `mintSignal` |
| `/bus` | `createSignalBus`, `SignalBus` |
| `/lifecycle` | `createLifecycle`, `Lifecycle` |
| `/config` | `createConfigLoader`, `z` |
| `/atomic-write` | `atomicWrite` |
| `/serial-queue` | `SerialQueue` |
| `/logger` | `createLogger`, `Logger` |

## Stack

TypeScript strict, ESM, ULID for ids, Zod for schemas, Pino for logs. Bun-recommended runtime; works on Node ≥ 20.

## License

MIT
