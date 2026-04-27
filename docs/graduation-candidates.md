# AppyRadar Sentinel — Capability Graduation Tracking

Living record of each collector's current graduation stage and what would trigger promotion.

For the graduation lifecycle doctrine, see:
[`github.com/appydave/appysentinel/blob/main/docs/pattern-catalogue.md`](https://github.com/appydave/appysentinel/blob/main/docs/pattern-catalogue.md) — "Capability Graduation" section.

---

## Graduation stages

| Stage | Name | What it means |
|-------|------|---------------|
| **Core** | Always-inline | Universal machine telemetry — never graduates; belongs in every fleet radar |
| **Inline plugin** | Bespoke collector | Lives inside AppyRadar as a direct SSH collector; AppyDave-specific |
| **Ingest gesture** | External data pull | Pulls from an external data source (wearable, file feed, service); natural candidate for its own sentinel |
| **Graduated** | Standalone sentinel | Has its own always-on process, lifecycle, and expose surface; AppyRadar talks to it via that surface |
| **Blocked** | Candidate, dependency unmet | Should graduate but is blocked on a prerequisite existing first |

---

## Collector inventory

### Core collectors (never graduate — universal)

| Collector | Signal name | Notes |
|-----------|-------------|-------|
| Identity | `machine.identity` | hostname, OS, arch, uptime, load — universal across any fleet |
| System / Memory | `machine.memory` | RAM, CPU cores, memory pressure — universal |
| Disk | `machine.disk` | Volume usage and alert levels — universal |

Source: [`github.com/appydave/appyradar-sentinal/blob/main/src/collectors/parsers.ts`](https://github.com/appydave/appyradar-sentinal/blob/main/src/collectors/parsers.ts)

---

### Inline plugins (AppyDave-specific, bespoke provider set)

These collectors are specific to the AppyDave / AppySentinel ecosystem. Lars and Rony deployments use the same provider set — the data is the same shape; the values differ per fleet.

| Collector | Signal name | Stage | Graduation condition |
|-----------|-------------|-------|---------------------|
| Tools | `machine.tools` | Inline plugin | Could become a configurable `tools-collector` recipe when the tool list is driven by config rather than hardcoded. Low priority. |
| App Status | `machine.app_status` | Inline plugin | Driven by `appsJsonPath` in `sentinel.config.json`. Stays inline until app registry complexity demands its own sentinel. |
| Relay (Syncthing) | `machine.relay` | Inline plugin | Stays inline; Relay is infrastructure, not a domain. |
| Git Repos | `machine.git_repos` | Inline plugin | Stays inline; no natural lifecycle of its own. |
| Brains | `machine.brains` | Inline plugin | Candidate for a Brains Sentinel if the brain system grows its own lifecycle (active monitoring, stale alerts, rebuild triggers). |
| Ansible | `machine.ansible` | Inline plugin | Stays inline; Ansible state is slow-changing and fits a snapshot read. |

Source: [`github.com/appydave/appyradar-sentinal/blob/main/src/collectors/`](https://github.com/appydave/appyradar-sentinal/blob/main/src/collectors/)

---

### Ingest gestures (external data pulls — natural graduation candidates)

Ingest gestures pull from external data sources rather than reading machine state. They tend to graduate faster because they represent full domains, not point metrics.

| Collector | Signal name | Stage | Graduation condition |
|-----------|-------------|-------|---------------------|
| OMI | `machine.omi` | Inline (ingest gesture) | Graduate when OMI gets its own always-on pipeline (enrichment, routing, storage). AppyRadar would then read from the OMI Sentinel's expose surface rather than SSH-scraping OMI files. |

---

### Blocked graduation candidates

Collectors that are inline now but should graduate once a prerequisite sentinel exists.

| Collector | Signal name | Stage | Blocked on |
|-----------|-------------|-------|-----------|
| AngelEye | `machine.angeleye` | Inline (blocked) | AngelEye Sentinel must exist first. The current AngelEye is pre-sentinel — it has no expose surface. Once AngelEye is a proper sentinel, AppyRadar drops its SSH-scraping collector and speaks to AngelEye's expose surface instead. |

---

### Future sentinel candidates (named but not yet planned)

| Domain | Current home | Notes |
|--------|-------------|-------|
| Skills & Agents | Inline `machine.skills` collector | As Claude skills, plugins, and agent configurations grow into a managed system, a dedicated Skills & Agents Sentinel becomes the right home. AppyRadar would consume its expose surface. |

---

## The controlled provider model

AppyRadar Sentinel is not a generic fleet radar. It is built for the AppyDave ecosystem and extended to clients (Lars, Rony) who adopt the same stack. The provider set is fixed — what changes per deployment is values, not shape:

- Different machines in `sentinel.config.json`
- Different `appsJsonPath` pointing to the deployment's app registry
- Same collectors, same signal shapes, same MCP tools

This is a deliberate constraint. A generic provider plugin architecture (where each collector is opt-in and configurable) is the long-term direction but is not being built until a second non-AppyDave deployment demands it.

---

## Known issues (carried from PoC, not yet fixed)

- **Relay/OMI parser**: `mode` and `session_id` return `undefined` — format mismatch in the parser
- **Mary machine**: zero skills reported — likely a setup issue on that machine

Source: [`github.com/appydave/appyradar-sentinal/blob/main/src/collectors/parsers.ts`](https://github.com/appydave/appyradar-sentinal/blob/main/src/collectors/parsers.ts)

---

*Updated as collectors graduate or new candidates are identified.*
*Last updated: 2026-04-27*
