# AppyRadar Sentinel — Session Handover

**STOP. Do not take any action yet.**
Read this document in full. When done, summarise what you understand and ask David what he wants to work on in this session. Do not assume the next steps listed below are your instructions for today.

---

## What this project is

AppyRadar Sentinel is a headless, always-on fleet telemetry collector built on `@appydave/appysentinel-core@0.2.0`. It SSHes into David's 5 machines (macbook-pro, mac-mini-m4, mac-mini-m2, jan, mary), collects system state, and writes a `snapshots/sentinel-latest.json` file. A CQRS-lite Access zone exposes that data via query functions and accepts commands that control the sentinel's own behaviour.

It has never been run against live machines in its current form. The snapshot file does not exist. That is expected and is the starting point for the next session.

---

## Current state (commit 4876541)

**Fully implemented, typechecks clean, 102 tests passing:**

```
src/
├── collect/
│   ├── ssh/client.ts              SSH transport (sshStatus, sshScript)
│   └── collectors/
│       ├── bash-scripts.ts        Bash script templates — 8 collectors
│       ├── parsers.ts             SSH output → typed structs
│       └── orchestrator.ts        collectMachine() — coordinates one machine
├── access/
│   ├── query/fleet.ts             7 pure query functions → QueryResult<T>
│   ├── command/fleet.ts           6 stateless command functions
│   └── bindings/mcp.ts            MCP binding — query tools only (stdio)
├── deliver/index.ts               stub
├── constants.ts                   shared paths (CONFIG_PATH, SNAPSHOT_DIR, STATE_DIR)
├── main.ts                        collection loop with trigger/pause file polling
└── types.ts
```

**Commands implemented (in `access/command/fleet.ts`):**
- `pauseCollection(machine)` — writes `state/paused.json`
- `resumeCollection(machine)` — updates `state/paused.json`
- `triggerCollection(machine?)` — writes `state/trigger.json`, loop consumes on next tick
- `addMachine({ name, host })` — writes config + auto-investigates
- `removeMachine(name)` — writes config + cleans paused state
- `investigateMachine(name)` — runs collectMachine() now, patches snapshot, returns result

**Commands are not yet exposed through any binding.** They exist as functions but nothing calls them externally yet.

---

## What does not exist yet

1. **The MCP command tools** — `access/bindings/mcp.ts` only has the 7 query tools. The 6 command functions need to be added as MCP tools to the same file.

2. **The HTTP command server on :5082** — the port is reserved in `apps.json`. The sentinel does not start an HTTP server yet. This is needed for remote command access (Lars use case).

3. **MCP registration with Claude Code** — the binding has never been registered. To do this:
   ```bash
   claude mcp add appyradar-sentinel -- bun src/access/bindings/mcp.ts
   ```
   This only works after `bun src/main.ts` has run at least once (snapshot must exist).

4. **Live test with Mary** — the plan is to remove Mary from config, add her back via `addMachine`, and use `investigateMachine` as the integration test to verify SSH access and snapshot quality.

---

## Key architectural decisions (do not re-litigate without reading the reasoning)

**CQRS-lite in the Access zone only.** Collect and Deliver are not CQRS. The Access zone has Query (read, stateless, pure functions over snapshot), Command (write, stateless file operations), and Bindings (thin protocol adapters — MCP/HTTP/CLI — that call into query/ or command/).

**Commands are stateless.** They communicate effects to the collection loop via files in `state/` (gitignored). The loop reads `state/paused.json` before each machine and `state/trigger.json` at the start of each tick. No shared memory, no singletons.

**`investigateMachine` is distinct from `triggerCollection`.** Investigate runs immediately and returns a result. Trigger queues a collection for the next loop tick. Both are needed.

**MCP transport is stdio.** Claude Code spawns the binding as a child process. No port needed for queries. Port 5082 is reserved for the future HTTP command server only.

---

## AppySentinel spec updates needed (not done — David to do in the AppySentinel repo)

The following should be added to `docs/appysentinel-spec.md` under the Command section (§7.3):

1. **Commands are stateless.** They do not hold runtime references. Effects that need to reach the collection loop are communicated via files in `state/`. The loop reads these at the top of each tick. This keeps command functions pure and the loop as the single stateful actor.

2. **The `state/` directory convention.** Gitignored. Common files: `paused.json` (machines to skip), `trigger.json` (one-shot collection request, consumed and deleted by loop). Command implementations write here; the loop reads here.

3. **`investigateMachine` as a named command pattern.** A command that runs a one-off collection for a single machine, patches the result into the fleet snapshot immediately, and returns the `MachineSnapshot`. Does not wait for the next scheduled tick. The correct tool for machine onboarding (called automatically by `addMachine`), post-maintenance verification, and debugging.

---

## Config and environment

`sentinel.config.json` is gitignored. Copy `sentinel.config.example.json` and fill in hosts.
David's machine names: macbook-pro, mac-mini-m4, mac-mini-m2, jan, mary.

The sentinel requires Tailscale network access for SSH collection to succeed.

---

## Suggested focus for the next session (options — ask David which one)

- **Option A — First live run**: run `bun src/main.ts`, watch collection, inspect `snapshots/sentinel-latest.json`, register MCP binding, test query tools in Claude Code.
- **Option B — Wire command tools into MCP binding**: add the 6 command functions as MCP tools in `access/bindings/mcp.ts`, then test `investigateMachine('mary')` via Claude Code.
- **Option C — HTTP command server**: stand up a small Hono server in `access/bindings/http.ts` on port 5082, wire commands through it.
- **Option D — Mary integration test**: remove Mary, add her back via command, investigate her, verify snapshot quality.

Options B+D together make the most sense as a single session — they form a complete test of the command layer end-to-end.
