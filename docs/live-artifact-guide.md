# AppyRadar Sentinel — Live Artifact Guide

This document gives you everything needed to build a live HTML artifact that reads from and controls the AppyRadar Sentinel fleet telemetry system. Paste this into a new Claude Code session.

---

## What you are building

A browser-based live dashboard that:
- Auto-refreshes fleet data from `sentinel-latest.json` (written every 10 minutes by the sentinel service)
- Calls the sentinel's MCP tools directly via Claude Code when you ask questions
- Displays fleet health, alerts, running apps, skills drift, and disk usage in AppyDave brand style
- Optionally: lets you trigger collection, pause/resume machines, or investigate a specific machine

---

## Architecture

The sentinel runs as a background launchd service on mac-mini-m4. It writes to:
```
/Users/davidcruwys/dev/ad/apps/appyradar-sentinal/snapshots/sentinel-latest.json
```

**Two ways to make the artifact "live":**

### Option A — Bun file server (recommended)
Run a tiny Bun HTTP server that serves the snapshot JSON with CORS headers. The HTML page polls it on an interval.

```typescript
// serve-snapshot.ts — run with: bun serve-snapshot.ts
import { serve } from 'bun'
import { readFileSync } from 'fs'

const SNAPSHOT = '/Users/davidcruwys/dev/ad/apps/appyradar-sentinal/snapshots/sentinel-latest.json'

serve({
  port: 5082,
  fetch(req) {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json',
    }
    try {
      return new Response(readFileSync(SNAPSHOT, 'utf8'), { headers })
    } catch {
      return new Response(JSON.stringify({ error: 'snapshot not found' }), { status: 404, headers })
    }
  },
})

console.log('Snapshot server running at http://localhost:5082')
```

The HTML artifact fetches `http://localhost:5082` and auto-refreshes every 60 seconds.

### Option B — Claude reads MCP tools directly
Ask Claude in the session to call the MCP tools and render the result as an HTML artifact. Claude has access to all 13 sentinel MCP tools in any Claude Code session (user-scoped). No server needed — just ask.

---

## MCP Tools Reference

All 13 tools are registered at user scope. Available in any Claude Code session.

### Query tools — read sentinel-latest.json

| Tool | Inputs | What it returns |
|------|--------|-----------------|
| `fleet_status` | none | All machines: online/offline, memory%, disk alert, running apps, Claude version, skill count |
| `machine_detail` | `machine: string` | Full snapshot for one machine — all collectors |
| `running_apps` | `machine?: string` | Apps currently listening on ports (fleet-wide or one machine) |
| `disk_usage` | `machine?: string` | All disk volumes with use% and alert level |
| `alerts` | none | All current warning/critical conditions across the fleet |
| `skills_diff` | none | Claude skills present on each machine vs reference machine — surfaces drift |
| `git_dirty` | `machine?: string` | Git repos with uncommitted changes (requires `skipGit: false` in config) |

### Command tools — control the sentinel

| Tool | Inputs | What it does |
|------|--------|-------------|
| `pause_collection` | `machine: string` | Stops collecting that machine on loop ticks. Writes `state/paused.json`. |
| `resume_collection` | `machine: string` | Re-enables collection. Removes from `state/paused.json`. |
| `trigger_collection` | `machine?: string` | Queues immediate collection cycle. Respects paused machines. |
| `investigate_machine` | `machine: string` | Runs immediate SSH collection on one machine, patches snapshot now. Returns MachineSnapshot. |
| `add_machine` | `name: string, host: string` | Adds to config + auto-investigates. Returns updated fleet + investigation result. |
| `remove_machine` | `machine: string` | Removes from config. Cleans up paused state. |

---

## Real data shapes (from live session 2026-04-28)

### fleet_status response
```json
{
  "data": {
    "online": 5,
    "total": 5,
    "offline_machines": [],
    "machines": [
      {
        "machine": "macbook-pro",
        "status": "online",
        "memory_pressure": "ok",
        "memory_use_pct": 96,
        "disk_alert": "warning",
        "apps_running": 0,
        "apps_running_names": [],
        "collection_errors": 0,
        "claude_version": "2.1.119 (Claude Code)",
        "skills_count": 52
      },
      {
        "machine": "mac-mini-m4",
        "status": "online",
        "memory_pressure": "warning",
        "memory_use_pct": 96,
        "disk_alert": "warning",
        "apps_running": 1,
        "apps_running_names": ["Signal Studio"],
        "collection_errors": 0,
        "claude_version": "2.1.89 (Claude Code)",
        "skills_count": 54
      },
      {
        "machine": "mac-mini-m2",
        "status": "online",
        "memory_pressure": "ok",
        "memory_use_pct": 91,
        "disk_alert": "ok",
        "apps_running": 0,
        "apps_running_names": [],
        "collection_errors": 0,
        "claude_version": "2.1.51 (Claude Code)",
        "skills_count": 51
      },
      {
        "machine": "jan",
        "status": "online",
        "memory_pressure": "warning",
        "memory_use_pct": 94,
        "disk_alert": "ok",
        "apps_running": 1,
        "apps_running_names": ["FliHub"],
        "collection_errors": 0,
        "claude_version": "2.1.121 (Claude Code)",
        "skills_count": 17
      },
      {
        "machine": "mary",
        "status": "online",
        "memory_pressure": "ok",
        "memory_use_pct": 94,
        "disk_alert": "ok",
        "apps_running": 0,
        "apps_running_names": [],
        "collection_errors": 0,
        "claude_version": "2.1.85 (Claude Code)",
        "skills_count": 0
      }
    ]
  },
  "generated_at": "2026-04-28T05:05:10.234Z",
  "data_age_ms": 47195,
  "stale": false
}
```

### alerts response
```json
{
  "data": {
    "alert_count": 9,
    "alerts": [
      { "machine": "macbook-pro", "kind": "disk", "level": "warning", "detail": "/System/Volumes/Data: 78% (690.7G / 926.4G)" },
      { "machine": "mac-mini-m4", "kind": "memory", "level": "warning", "detail": "96% used, pressure: warning" },
      { "machine": "mac-mini-m4", "kind": "disk", "level": "warning", "detail": "/System/Volumes/Data: 71% (287.2G / 460.4G)" },
      { "machine": "mac-mini-m4", "kind": "disk", "level": "warning", "detail": "/Volumes/T7: 76% (945.5G / 1257.5G)" },
      { "machine": "jan", "kind": "memory", "level": "warning", "detail": "94% used, pressure: warning" }
    ]
  }
}
```

### running_apps response
```json
{
  "data": [
    {
      "machine": "mac-mini-m4",
      "app": "signal-studio",
      "display": "Signal Studio",
      "running": true,
      "ports": { "client": { "port": 6040, "listening": true }, "server": { "port": 6041, "listening": true } }
    },
    {
      "machine": "jan",
      "app": "flihub",
      "display": "FliHub",
      "running": true,
      "ports": { "server": { "port": 5101, "listening": true } }
    }
  ]
}
```

### skills_diff response (abbreviated)
```json
{
  "data": {
    "reference_machine": "mac-mini-m4",
    "machines": [
      { "machine": "macbook-pro", "skill_count": 52, "claude_version": "2.1.119", "missing_skills": ["agents","archon"], "extra_skills": ["elevenlabs-agents"] },
      { "machine": "jan", "skill_count": 17, "claude_version": "2.1.121", "missing_skills": ["adapt","agents",...53 total], "extra_skills": ["hyperframes","gsap","remotion-best-practices",...16 total] },
      { "machine": "mary", "skill_count": 0, "claude_version": "2.1.85", "missing_skills": [...all], "extra_skills": [] }
    ]
  }
}
```

---

## Fleet facts (for context)

- **5 machines**: macbook-pro, mac-mini-m4 (orchestrator), mac-mini-m2, jan (video/animation specialist), mary (user machine — no dev setup)
- **Collection interval**: 10 minutes (configurable, requires restart)
- **skipGit: true** — git_dirty always returns empty until changed to false + restart
- **jan** is intentionally diverged — video/animation stack (hyperframes, remotion, gsap) not on other machines
- **mary** has 0 skills — Claude installed, nothing configured
- **mac-mini-m2** is the oldest Claude version (2.1.51 vs jan's 2.1.121)

---

## AppyDave Brand Guidelines

### Personality
Warm, confident, builder-energy. A senior developer who loves craft — approachable but not casual. Evidence-first, personality second. Cream and warmth as default; darkness as deliberate contrast, never decoration.

### Color System (non-negotiable)

```css
:root {
  --brand-brown: #342d2d;        /* Primary dark — text, headings, structure */
  --brand-gold: #ccba9d;         /* Warm secondary — borders, subtle highlights */
  --brand-yellow: #ffde59;       /* Primary CTA — buttons, badges, attention */
  --brand-amber: #c8841a;        /* Numbered sequences (01/02/03), one-off accents only */
  --brand-muted: #7a6e5e;        /* Supporting body text, secondary labels */
  --brand-near-white: #faf5ec;   /* Primary page background */
  --brand-surface: #f0ebe4;      /* Secondary surface, section alternates */
  --brand-linen: #e8e0d4;        /* Tertiary warm surface, card backgrounds */
  --brand-border: #d4cdc4;       /* Dividers, column rules, table borders */
  --brand-chrome: #1a1515;       /* Dark chrome (use instead of pure black) */
  --brand-dark-surface: #25201e; /* Dark sections, contrast beats */
  --brand-blue: #2E91FC;         /* Cool accent only — links, small elements. Never background fill */
}
```

### Contrast Pairings (WCAG-compliant)
| Background | Text | Accent |
|------------|------|--------|
| Brown `#342d2d` | White `#ffffff` | Gold or Yellow |
| Near-white `#faf5ec` | Brown `#342d2d` | Amber for accents |
| Surface `#f0ebe4` | Brown `#342d2d` | Amber or Gold |
| Dark-surface `#25201e` | White `#ffffff` | Yellow or Gold |
| Yellow `#ffde59` | Brown `#342d2d` | — |

### Typography

```html
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Oswald:wght@200..700&family=Roboto:ital,wght@0,100..900;1,100..900&family=Roboto+Mono&display=swap" rel="stylesheet">
```

```css
h1 { font-family: 'Bebas Neue', Arial, sans-serif; }
h2, h3, h4, h5, h6 { font-family: 'Oswald', Arial, sans-serif; text-transform: uppercase; }
body, p, ul, ol, a { font-family: 'Roboto', Arial, sans-serif; }
code, pre { font-family: 'Roboto Mono', monospace; }
```

| Font | Role |
|------|------|
| Bebas Neue | Logo, ghost watermarks, standalone display moments only |
| Oswald | Headlines, nav, CTAs, section labels — uppercase always |
| Roboto | Body text, paragraphs, descriptions |
| Roboto Mono | Code blocks, terminal output |

### Design Principles
1. **Warm cream is the default, darkness is a guest.** `#faf5ec` and `#f0ebe4` are primary backgrounds. Dark sections (`#25201e`) for deliberate contrast beats only.
2. **Typography is the structure.** Bebas Neue for display moments. Oswald labels the world. Roboto carries the meaning.
3. **Amber for sequences, yellow for action.** Yellow `#ffde59` is the primary CTA colour. Amber `#c8841a` is for numbered sequences only.
4. **Blue is a cool guest in a warm house.** Never blue as a background fill. Links and small accents only.
5. **Evidence before pitch.** Lead with stats and data. Personality follows.
6. **One CTA per section.**

### Don'ts
- Pure black (`#000`) — use `#1a1515` or `#25201e`
- Glassmorphism
- Dark theme as default mode
- Amber as primary CTA
- Inventing colours not in the palette
- Multiple CTAs in the same section
- Bebas Neue for nav links (use Oswald)

---

## Prompt for Claude Code (paste this to start)

```
I want to build a live HTML dashboard for AppyRadar Sentinel — a fleet telemetry system that monitors 5 machines via SSH.

The sentinel is already running as a background service on this machine. It writes fresh data to:
  /Users/davidcruwys/dev/ad/apps/appyradar-sentinal/snapshots/sentinel-latest.json

I also have 13 MCP tools available in this session (user-scoped) under the `appyradar-sentinel` server:
- Query tools: fleet_status, machine_detail, running_apps, disk_usage, alerts, skills_diff, git_dirty
- Command tools: pause_collection, resume_collection, trigger_collection, investigate_machine, add_machine, remove_machine

Please:
1. First call fleet_status and alerts to get real current data
2. Build a single-file HTML dashboard (serve-snapshot.ts + index.html) using the Bun file server approach:
   - serve-snapshot.ts serves sentinel-latest.json at http://localhost:5082 with CORS headers
   - index.html fetches from that endpoint and auto-refreshes every 60 seconds
3. Design it in AppyDave brand style (DESIGN.md attached — warm cream backgrounds, brown text, yellow CTAs, Oswald + Roboto fonts)
4. Dashboard should show:
   - Fleet header: N/N machines online, last updated timestamp, data age
   - Machine cards: one per machine, showing memory bar, disk status, running apps, Claude version, skills count
   - Alerts panel: all current warnings/criticals
   - Running apps strip: what's listening across the fleet right now
5. Make it feel like a real ops dashboard — clean, scannable, data-first

Use the real data shapes from the MCP tools (call them to get live examples before building).
```

---

## Notes for the session

- The sentinel collects every 10 minutes automatically. The dashboard will be at most 10 minutes stale.
- If you want fresher data mid-session, ask Claude to call `trigger_collection` via the MCP tool.
- If a machine is about to go offline, use `pause_collection` to skip it so the loop doesn't waste time on SSH timeouts.
- `investigate_machine` is instant — runs SSH collection right now and patches the snapshot, no waiting for the next cycle.
- `git_dirty` is always empty because `skipGit: true` in config — change it and restart the service if you want git data.
