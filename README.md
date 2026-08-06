# appyradar-sentinal

> ## ⚠️ Naming — read this first
>
> Three similarly-named things exist. Confusing them has twice come close to deleting the running
> application, so this is stated here rather than buried in `docs/`.
>
> | Name | What it actually is |
> |---|---|
> | **`appyradar-sentinal`** (this repo + directory) | **⬅ THIS IS APPYRADAR.** The real, running application. `launchd` executes `src/main.ts` from here; the MCP server loads `src/access/bindings/mcp.ts` from here. **The misspelling is historical** — a June 2026 rename was started and never finished. |
> | `appyradar-sentinel` *(correct spelling)* | A **652 KB stub**. Two commits, no running code. It exists only to hold the correctly-spelled repo name as the rename target. **Not an application.** |
> | `appysentinel` | A **different project entirely** — the framework AppyRadar is built on. Nothing to do with the rename. Do not "consolidate" it. |
>
> **Deleting "the obviously misspelt one" destroys production.** The misspelt one is the live app.
>
> Three further directories — `appyradar`, `appyradar-design-archive-2026-04`, `appyradar-sentinal-safe`
> — were deleted on 2026-08-05. They were design snapshots and an April copy, superseded and unreferenced.
>
> **Until the rename lands, always qualify the name**: write *"AppyRadar (`appyradar-sentinal`)"* in
> commit messages, reports and docs — never the bare word "AppyRadar", which is ambiguous across all
> three. Rename plan: [`docs/migration-sentinal-to-sentinel.md`](docs/migration-sentinal-to-sentinel.md).

Fleet telemetry collector for the AppyDave machine network. Built on [AppySentinel](https://github.com/appydave/appysentinal).

SSHes into 5 machines (macbook-pro, mac-mini-m4, mac-mini-m2, jan, mary), collects system state, writes `snapshots/sentinel-latest.json`, and exposes 13 MCP tools for querying and controlling the fleet from Claude Code.

## Drift detection — scope and privacy

Six rules check for resource drift (unrotated logs, upstream repos that lost their blob filter,
orphaned git artifacts, pnpm store version splits, frozen backups, bloated SQLite). See
[`docs/proposal-drift-detection.md`](docs/proposal-drift-detection.md).

**What drift reads — and does not**

| Reads | Never reads |
|---|---|
| File **sizes** (`stat`, `find -size`) | ❌ File **contents** — no file is ever opened or transmitted |
| File **paths** and modification times | ❌ Message, document or media content |
| SQLite **pragmas** (`page_count`, `freelist_count`, `page_size`) | ❌ SQLite **rows** — no `SELECT` is ever run |
| `git config remote.origin.promisor` | ❌ Commit contents, diffs, or branch names |

Findings therefore contain paths and sizes only. That is still information about a machine's
layout — hence the scope note below.

**⚠️ Fleet scope is not yet confirmed**

Drift currently runs on **all five configured machines**, including Jan's and Mary's. It has already
proved its worth across the fleet — it found an 80 MB orphaned `tmp_pack` on Jan's machine within
minutes of shipping — but running it there **was not explicitly agreed**, and findings surface paths
under other people's home directories.

**Do not extend what drift collects on machines you do not own until that is confirmed.** If it needs
limiting, `pause_collection` stops a machine entirely; a drift-specific opt-out does not exist yet
and should be added before any new rule is introduced.

**Cost and cadence**

These rules walk the filesystem, so they run on their **own interval (default 12h)**, *not* on every
~10-minute collection cycle. Configure with `driftIntervalHours` in `sentinel.config.json` or the
`DRIFT_INTERVAL_HOURS` env var.

On-demand is the primary path — the interval is only a backstop:

```
run_drift                 # MCP: queue drift on the next tick, all machines
run_drift { machine }     # ...or one machine
drift_findings            # MCP: read the findings
```

State lives in `state/drift-runs.json` as **timestamps, not a cycle counter** — so a daemon restart
does not reset the clock and cause every machine to run at once.


## Run (dev)

```bash
bun src/main.ts       # live collection loop — Ctrl-C to stop
bun run test          # 102 tests
bun run typecheck     # TypeScript check
```

## Install as always-on service

```bash
bash scripts/install-service.sh    # macOS (launchd) or Linux (systemd)
bash scripts/uninstall-service.sh  # remove
```

Service restarts automatically on crash and on login.

## Register MCP tools with Claude Code

```bash
claude mcp add --scope user appyradar-sentinel -- bun /absolute/path/to/src/access/bindings/mcp.ts
```

Use `--scope user` so the tools are available in all Claude Code sessions, not just this project folder. Restart Claude Code after registering.

## MCP tools

**Query (read snapshot):** `fleet_status`, `machine_detail`, `running_apps`, `disk_usage`, `alerts`, `skills_diff`, `git_dirty`

**Command (control sentinel):** `pause_collection`, `resume_collection`, `trigger_collection`, `investigate_machine`, `add_machine`, `remove_machine`

## Configure

Copy `sentinel.config.example.json` → `sentinel.config.json` and fill in your machine names and hosts. Config is gitignored.

## License

MIT
