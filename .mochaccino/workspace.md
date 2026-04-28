# AppyRadar Sentinel — Mochaccino Workspace

**Purpose**: Documentation and mock UI exploration for AppyRadar Sentinel — the AppySentinel-based fleet telemetry collector for the AppyDave machine network.

**Workspace type**: Parallel

**Provenance tool**: `src/expose/mcp.ts` — MCP server reading `snapshots/sentinel-latest.json`. Also readable directly as JSON. No custom tool creation needed.

---

## Workspaces

### docs/
**Mode**: Text-to-documentation
**Audience**: Collaborators, clients (Lars-type), self (spec/code validation)
**Data**: Hand-crafted from source files — `src/types.ts`, `docs/graduation-candidates.md`, `src/expose/mcp.ts`
**Lifecycle**: Long-lived, updated as system evolves

### mockui/
**Mode**: UI mockup
**Audience**: Self — dashboard direction-finding before building AppyRadar dashboard
**Data**: Real fleet data from `snapshots/sentinel-latest.json` (PoC snapshot as seed; replaced on next live run)
**Lifecycle**: Exploratory sprint — retire once real dashboard is built from these designs
