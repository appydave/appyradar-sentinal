---
name: configure-sentinel
description: |
  Configure a freshly-scaffolded AppySentinel project. Interviews the developer
  about interface, input collectors, storage, transport, and runtime supervisor;
  generates code for chosen recipes; smoke-tests the result.

  Use this skill on a project scaffolded by `create-appysentinel` that has
  not yet been configured (`appysentinel.json` shows empty `recipes` arrays).
---

# configure-sentinel

> **Status: interview-ready.** The interview questions and recipe descriptions
> below are informed by the AppyRadar PoC (2026-04-27). Generate recipe code
> once the developer answers the questions — do not implement anything without
> asking first.

## Step 1 — Read project state

Before the interview, read:
- `appysentinel.json` — name, machine, current recipe selections
- `package.json` — dependency baseline
- `src/main.ts` — current Sentinel wiring
- `.env.example` — current required environment variables

## Step 2 — Interview the developer

Ask these questions **in order**. Capture answers before generating anything.

### Q1 — What does this Sentinel collect?

Choose zero or more input collectors:

| Option | What it does |
|--------|-------------|
| `watch-directory` | Chokidar file watcher — detects creates/changes/deletes in a local path |
| `watch-logfile` | Tail a log file with rotation detection and line parsing |
| `poll-http` | Periodic GET against an HTTP endpoint; emits response + latency |
| `poll-command` | Run a shell command on a timer; emits stdout/stderr/exit-code |
| `orchestrator-ssh` | **PoC-validated.** SSH from this machine to a fleet of remote machines. No remote agent install. Compound bash scripts (multiple checks per SSH connection). Emits `machine.snapshot` (state) + `machine.offline` (event) per machine. Config: list of `{ name, host }`. Needs: `ssh` on PATH, key-based auth to each host. See `appyradar-sentinal-safe/docs/orchestrator-ssh-recipe.md` for full spec. |
| `hook-receiver` | HTTP webhook that accepts external push events and emits Signals |
| `subprocess-wrap` | Spawn + supervise a long-running subprocess; stream its output into Signals |
| `snapshot-capture` | Combine multiple signals into a periodic structured snapshot of system state |

### Q2 — Is this data about what IS, or what HAPPENED?

This determines storage. Ask directly:

> "Will the consumer mostly ask 'what is the current state?' or 'what events occurred over time?'"

- **Current state** → `snapshot-store` (single overwriting JSON file, always-current)
- **Historical events** → `jsonl-store` (append-only, indexed)
- **Recent-only, ephemeral** → `memory-buffer` (in-memory ring buffer, lost on restart)
- **No local storage** → `none`

**`snapshot-store` convention** (PoC-validated): write to `snapshots/sentinel-latest.json` via `AtomicWrite`. Optionally archive a dated copy alongside it. Consumers do one `JSON.parse` — no cursors, no pagination.

**Do not default silently** — ask this question explicitly. Choosing the wrong storage breaks downstream consumers.

### Q3 — Does the consumer need to know how fresh the data is?

If yes → `mcp-expose` is the right expose surface. MCP responses must include a `data_age_seconds` field (or equivalent) on every tool response. Agents need freshness metadata to decide whether to trigger a recollect.

### Q4 — How will this Sentinel be read?

Choose zero or more expose surfaces:

| Option | What it does |
|--------|-------------|
| `mcp-expose` | **PoC-validated.** MCP server (stdio). Read-only over `snapshot-store`. Tool design: one summary tool, one detail tool, domain-specific aggregated tools. One command-like tool (`trigger_collect`) is acceptable — it spawns a subprocess and returns immediately; does not violate observer-only. Data-age field is first-class on every response. See `appyradar-sentinal-safe/docs/mcp-surface.md` for full tool surface spec. |
| `api-expose` | Hono HTTP API with Zod + OpenAPI. Foundation surface; reachable by any HTTP client. |
| `cli-expose` | Shell tool that queries the local Sentinel. For developer composition (pipe to jq/grep) and on-machine agent loops. |
| `none-yet` | Skip expose for now; add later. |

### Q5 — Does data need to leave this machine?

Choose zero or more transports (most Sentinels start with none):

`http-push` / `socketio-push` / `otlp-push` / `supabase-push` / `file-relay`

### Q6 — Does data need semantic enrichment?

Choose zero or more (most Sentinels start with none):

`deterministic-classifier` (rules-based) / `heuristic-classifier` (regex/pattern) / `llm-classifier` (LLM call)

### Q7 — Runtime supervisor

How will this Sentinel run permanently? (launchd and systemd scripts are already in `scripts/` — this step registers them.)

`register-as-launchd` (macOS) / `register-as-systemd` (Linux) / `register-as-pm2` / `register-as-docker` / `none`

---

## Step 3 — Confirm before generating

Summarise the choices back to the developer. Get explicit confirmation before writing any files.

---

## Step 4 — Generate

For each chosen recipe:

1. Create `src/recipes/<recipe-slug>.ts` following the recipe pattern:
   ```typescript
   export function myCollector(sentinel: Sentinel, options: { ... }) {
     sentinel.lifecycle.onStart(async () => { /* start timers/connections */ });
     sentinel.lifecycle.onStop(async () => { /* clean up */ });
   }
   ```
2. Wire it in `src/main.ts` before `sentinel.start()`.
3. Add required deps to `package.json` (recipes own their deps).
4. Add required env vars to `.env.example`.
5. Update `appysentinel.json` recipe arrays.

**For `orchestrator-ssh`**: read `appyradar-sentinal-safe/src/` before generating — the PoC already has working `ssh/client.ts`, `collectors/bash-scripts.ts`, `collectors/parsers.ts`, and `collectors/orchestrator.ts`. Copy and adapt; do not rewrite from scratch.

**For `mcp-expose`**: read `appyradar-sentinal-safe/src/expose/mcp.ts` before generating — the PoC MCP server is working and tested.

**For `snapshot-store`**: use `AtomicWrite` from `@appydave/appysentinel-core`. Do not use `writeFileSync` directly.

---

## Step 5 — Smoke test

```bash
bun src/main.ts   # let it run ~5 seconds, then Ctrl-C
```

Verify at least one Signal appears in the log output. Report success or surface diagnostics.

---

## What this skill will NOT do

- Make architectural choices without asking.
- Touch the seven baked-in primitives (`@appydave/appysentinel-core`).
- Run `git commit`.
- Skip the confirmation step (Step 3).

---

## Reference

- PoC handover (durable): `appyradar-sentinal-safe/docs/HANDOVER.md`
- orchestrator-ssh spec: `appyradar-sentinal-safe/docs/orchestrator-ssh-recipe.md`
- MCP surface spec: `appyradar-sentinal-safe/docs/mcp-surface.md`
- SSH batching ADR: `appyradar-sentinal-safe/docs/ssh-batching.md`
- AppySentinel spec §5–§8 (in `appysentinal/docs/appysentinel-spec.md` while repo exists)
