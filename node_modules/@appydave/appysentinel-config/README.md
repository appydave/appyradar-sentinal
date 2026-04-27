# @appydave/appysentinel-config

Shared ESLint, TypeScript, Vitest, and Prettier configurations for AppySentinel projects — the headless Bun/Node telemetry-collector boilerplate.

Modeled on `@appydave/appystack-config`, trimmed to match the AppySentinel stack spine: **Bun + TypeScript + Hono + Zod + Pino + chokidar + Vitest**. There is no React variant — Sentinels are headless.

## Installation

```bash
bun add -D @appydave/appysentinel-config
# or
npm install --save-dev @appydave/appysentinel-config
```

## Usage

### ESLint

```javascript
// eslint.config.js
import sentinelConfig from '@appydave/appysentinel-config/eslint/base';

export default [
  ...sentinelConfig,
  // your overrides
];
```

### TypeScript

```json
{
  "extends": "@appydave/appysentinel-config/typescript/node",
  "compilerOptions": {
    // your overrides
  },
  "include": ["src"]
}
```

Use `typescript/base` if you want to compose your own paths and emit settings.

### Vitest

```typescript
// vitest.config.ts
import { mergeConfig, defineConfig } from 'vitest/config';
import sentinelConfig from '@appydave/appysentinel-config/vitest/node';

export default mergeConfig(
  sentinelConfig,
  defineConfig({
    // your overrides
  })
);
```

### Prettier

In `package.json`:

```json
{
  "prettier": "@appydave/appysentinel-config/prettier"
}
```

Or copy the ignore file:

```bash
cp node_modules/@appydave/appysentinel-config/prettier/.prettierignore .prettierignore
```

## Why a separate config package?

- **Consistency** — every Sentinel-style project follows the same standards.
- **Maintainability** — update once, benefit everywhere.
- **No bikeshedding** — the rules are decided.

## Difference from `@appydave/appystack-config`

| Aspect | appystack-config | appysentinel-config |
|--------|------------------|---------------------|
| Target | RVETS web apps | Headless telemetry collectors |
| ESLint | Has React variant | Base only — no React/JSX |
| Vitest | `server` + `client` (jsdom) | `node` only |
| TS | `base` + `node` + `react` | `base` + `node` |

## License

MIT
