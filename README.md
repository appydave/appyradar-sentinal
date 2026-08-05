# appyradar-sentinal

Fleet telemetry collector for the AppyDave machine network. Built on [AppySentinel](https://github.com/appydave/appysentinal).

SSHes into 5 machines (macbook-pro, mac-mini-m4, mac-mini-m2, jan, mary), collects system state, writes `snapshots/sentinel-latest.json`, and exposes 13 MCP tools for querying and controlling the fleet from Claude Code.

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
