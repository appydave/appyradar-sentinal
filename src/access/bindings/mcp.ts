#!/usr/bin/env bun
/**
 * AppyRadar Sentinel — MCP binding.
 *
 * Thin protocol adapter. Loads the snapshot, calls query/fleet.ts functions,
 * wraps results in MCP tool response format. No business logic here.
 *
 * Transport: stdio (Claude Code / Claude Desktop).
 * Run: bun run src/access/bindings/mcp.ts
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'node:url'
import type { FleetSnapshot } from '../../types.js'
import {
  getFleetStatus,
  getMachineDetail,
  getRunningApps,
  getDiskUsage,
  getAlerts,
  getSkillsDiff,
  getGitDirty,
} from '../query/fleet.js'
import {
  pauseCollection,
  resumeCollection,
  triggerCollection,
  addMachine,
  removeMachine,
  investigateMachine,
} from '../command/fleet.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SNAPSHOT_PATH = join(__dirname, '..', '..', '..', 'snapshots', 'sentinel-latest.json')

// ─── Snapshot loader ──────────────────────────────────────────────────────────

function loadSnapshot(): { snapshot: FleetSnapshot | null; error: string | null } {
  if (!existsSync(SNAPSHOT_PATH)) {
    return { snapshot: null, error: 'No snapshot available. Run: bun src/main.ts' }
  }
  try {
    return { snapshot: JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as FleetSnapshot, error: null }
  } catch {
    return { snapshot: null, error: 'Failed to parse snapshot file' }
  }
}

function withSnapshot<T>(fn: (s: FleetSnapshot) => T): T | { error: string } {
  const { snapshot, error } = loadSnapshot()
  if (!snapshot || error) return { error: error ?? 'Unknown error' }
  return fn(snapshot)
}

// ─── MCP server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'appyradar-sentinel', version: '0.2.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'fleet_status',
      description: 'Summary of all machines: online/offline, memory pressure, disk alerts, running apps.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'machine_detail',
      description: 'Full snapshot for one machine — all collectors.',
      inputSchema: {
        type: 'object',
        properties: { machine: { type: 'string', description: 'Machine name (e.g. macbook-pro, mac-mini-m4)' } },
        required: ['machine'],
      },
    },
    {
      name: 'running_apps',
      description: 'Which registered apps are currently listening on ports.',
      inputSchema: {
        type: 'object',
        properties: { machine: { type: 'string', description: 'Specific machine, or omit for all.' } },
        required: [],
      },
    },
    {
      name: 'disk_usage',
      description: 'Disk volumes and alert levels across machines.',
      inputSchema: {
        type: 'object',
        properties: { machine: { type: 'string', description: 'Specific machine, or omit for all.' } },
        required: [],
      },
    },
    {
      name: 'alerts',
      description: 'All current warning/critical conditions across the fleet.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'skills_diff',
      description: 'Compare Claude skills across all machines — surfaces drift between machines.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'git_dirty',
      description: 'Git repos with uncommitted changes or unpushed commits.',
      inputSchema: {
        type: 'object',
        properties: { machine: { type: 'string', description: 'Specific machine, or omit for all.' } },
        required: [],
      },
    },
    // ── Commands ────────────────────────────────────────────────────────────────
    {
      name: 'pause_collection',
      description: 'Stop collecting data for a machine on the next loop tick.',
      inputSchema: {
        type: 'object',
        properties: { machine: { type: 'string', description: 'Machine name to pause.' } },
        required: ['machine'],
      },
    },
    {
      name: 'resume_collection',
      description: 'Re-enable collection for a previously paused machine.',
      inputSchema: {
        type: 'object',
        properties: { machine: { type: 'string', description: 'Machine name to resume.' } },
        required: ['machine'],
      },
    },
    {
      name: 'trigger_collection',
      description: 'Queue an immediate collection cycle (runs at the next loop tick). Optionally target one machine.',
      inputSchema: {
        type: 'object',
        properties: { machine: { type: 'string', description: 'Specific machine, or omit for all.' } },
        required: [],
      },
    },
    {
      name: 'investigate_machine',
      description: 'Run a one-off immediate collection for one machine and patch the snapshot now. Use for onboarding, post-maintenance, or debugging.',
      inputSchema: {
        type: 'object',
        properties: { machine: { type: 'string', description: 'Machine name to investigate.' } },
        required: ['machine'],
      },
    },
    {
      name: 'add_machine',
      description: 'Add a new machine to the fleet config and immediately investigate it.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Logical name (e.g. macbook-pro).' },
          host: { type: 'string', description: 'SSH hostname or Tailscale name.' },
        },
        required: ['name', 'host'],
      },
    },
    {
      name: 'remove_machine',
      description: 'Remove a machine from the fleet config.',
      inputSchema: {
        type: 'object',
        properties: { machine: { type: 'string', description: 'Machine name to remove.' } },
        required: ['machine'],
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }] })
  const machine = (args as any)?.machine as string | undefined

  switch (name) {
    case 'fleet_status':   return text(withSnapshot(s => getFleetStatus(s)))
    case 'machine_detail': return text(withSnapshot(s => getMachineDetail(s, machine!)))
    case 'running_apps':   return text(withSnapshot(s => getRunningApps(s, machine)))
    case 'disk_usage':     return text(withSnapshot(s => getDiskUsage(s, machine)))
    case 'alerts':         return text(withSnapshot(s => getAlerts(s)))
    case 'skills_diff':    return text(withSnapshot(s => getSkillsDiff(s)))
    case 'git_dirty':          return text(withSnapshot(s => getGitDirty(s, machine)))
    // Commands
    case 'pause_collection':   return text(await pauseCollection(machine!))
    case 'resume_collection':  return text(await resumeCollection(machine!))
    case 'trigger_collection': return text(await triggerCollection(machine))
    case 'investigate_machine':return text(await investigateMachine(machine!))
    case 'add_machine':        return text(await addMachine({ name: (args as any).name, host: (args as any).host }))
    case 'remove_machine':     return text(await removeMachine(machine!))
    default:                   return text({ error: `Unknown tool: ${name}` })
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
