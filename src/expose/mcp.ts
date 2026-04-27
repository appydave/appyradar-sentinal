#!/usr/bin/env bun
/**
 * AppyRadar Sentinel — MCP Server
 *
 * Read-only layer over snapshots/sentinel-latest.json.
 * Communicates via stdio (Claude Desktop / Claude Code MCP).
 *
 * See docs/mcp-surface.md for the full tool surface design and handover notes.
 *
 * Run: bun run src/expose/mcp.ts
 * Or add to Claude Desktop MCP config:
 *   { "command": "bun", "args": ["run", "/path/to/src/expose/mcp.ts"] }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'node:url'
import type { FleetSnapshot, MachineSnapshot } from '../types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SNAPSHOT_PATH = join(__dirname, '..', '..', 'snapshots', 'sentinel-latest.json')
const STALE_THRESHOLD_MINUTES = 60

// ─── Snapshot loader ──────────────────────────────────────────────────────────

function loadSnapshot(): { snapshot: FleetSnapshot | null; error: string | null; age_minutes: number } {
  if (!existsSync(SNAPSHOT_PATH)) {
    return { snapshot: null, error: 'No snapshot available. Run: bun run src/collect.ts --skip-git', age_minutes: -1 }
  }
  try {
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as FleetSnapshot
    const age_minutes = Math.round((Date.now() - new Date(snapshot.generated_at).getTime()) / 60_000)
    return { snapshot, error: null, age_minutes }
  } catch {
    return { snapshot: null, error: 'Failed to parse snapshot file', age_minutes: -1 }
  }
}

function withSnapshot<T>(fn: (s: FleetSnapshot, age: number) => T): T | { error: string } {
  const { snapshot, error, age_minutes } = loadSnapshot()
  if (!snapshot || error) return { error: error ?? 'Unknown error' }
  return fn(snapshot, age_minutes)
}

function worstDiskAlert(machine: MachineSnapshot): 'ok' | 'warning' | 'critical' {
  if (!machine.disk?.length) return 'ok'
  if (machine.disk.some(d => d.alert === 'critical')) return 'critical'
  if (machine.disk.some(d => d.alert === 'warning'))  return 'warning'
  return 'ok'
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'appyradar-sentinel', version: '0.1.0' },
  { capabilities: { tools: {} } }
)

// ─── List tools ───────────────────────────────────────────────────────────────

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
      description: 'Git repos with uncommitted changes or unpushed commits (requires git scan).',
      inputSchema: {
        type: 'object',
        properties: { machine: { type: 'string', description: 'Specific machine, or omit for all.' } },
        required: [],
      },
    },
  ],
}))

// ─── Call tool ────────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }] })

  switch (name) {

    // ── fleet_status ─────────────────────────────────────────────────────────
    case 'fleet_status': return text(withSnapshot((s, age) => ({
      generated_at:    s.generated_at,
      data_age_minutes: age,
      stale:           age > STALE_THRESHOLD_MINUTES,
      online:          s.summary.online,
      total:           s.summary.total_machines,
      offline_machines: s.summary.offline_machines,
      machines: s.machines.map(m => ({
        machine:           m.machine,
        status:            m.status,
        memory_pressure:   m.memory?.pressure    ?? null,
        memory_use_pct:    m.memory?.use_pct     ?? null,
        disk_alert:        worstDiskAlert(m),
        apps_running:      m.app_status?.filter(a => a.running).length ?? 0,
        apps_running_names: m.app_status?.filter(a => a.running).map(a => a.display) ?? [],
        collection_errors: m.collection_errors.length,
        claude_version:    m.skills?.claude_version ?? null,
        skills_count:      m.skills?.global_skills?.length ?? 0,
      })),
    })))

    // ── machine_detail ───────────────────────────────────────────────────────
    case 'machine_detail': return text(withSnapshot((s, age) => {
      const m = s.machines.find(m => m.machine === (args as any)?.machine)
      if (!m) return { error: `Machine '${(args as any)?.machine}' not found. Available: ${s.machines.map(m => m.machine).join(', ')}` }
      return { data_age_minutes: age, ...m }
    }))

    // ── running_apps ─────────────────────────────────────────────────────────
    case 'running_apps': return text(withSnapshot((s, age) => {
      const machines = (args as any)?.machine
        ? s.machines.filter(m => m.machine === (args as any).machine)
        : s.machines.filter(m => m.status === 'online')

      return {
        data_age_minutes: age,
        apps: machines.flatMap(m =>
          (m.app_status ?? []).map(a => ({
            machine: m.machine,
            app:     a.key,
            display: a.display,
            running: a.running,
            ports:   a.ports,
          }))
        ).filter(a => a.running),
      }
    }))

    // ── disk_usage ───────────────────────────────────────────────────────────
    case 'disk_usage': return text(withSnapshot((s, age) => {
      const machines = (args as any)?.machine
        ? s.machines.filter(m => m.machine === (args as any).machine)
        : s.machines.filter(m => m.status === 'online')

      return {
        data_age_minutes: age,
        volumes: machines.flatMap(m =>
          (m.disk ?? []).map(d => ({
            machine: m.machine,
            ...d,
          }))
        ),
      }
    }))

    // ── alerts ───────────────────────────────────────────────────────────────
    case 'alerts': return text(withSnapshot((s, age) => {
      const alerts: Array<{ machine: string; kind: string; level: string; detail: string }> = []

      if (age > STALE_THRESHOLD_MINUTES) {
        alerts.push({ machine: 'fleet', kind: 'stale_data', level: 'warning',
          detail: `Snapshot is ${age} minutes old (threshold: ${STALE_THRESHOLD_MINUTES}m)` })
      }

      for (const m of s.machines) {
        if (m.status !== 'online') {
          alerts.push({ machine: m.machine, kind: 'offline', level: 'warning',
            detail: `Status: ${m.status}` })
          continue
        }

        if (m.memory && m.memory.pressure !== 'ok') {
          alerts.push({ machine: m.machine, kind: 'memory', level: m.memory.pressure,
            detail: `${m.memory.use_pct}% used, pressure: ${m.memory.pressure}` })
        }

        for (const vol of (m.disk ?? [])) {
          if (vol.alert !== 'ok') {
            alerts.push({ machine: m.machine, kind: 'disk', level: vol.alert,
              detail: `${vol.mount}: ${vol.use_pct}% (${vol.used_gb}G / ${vol.total_gb}G)` })
          }
        }

        if (m.collection_errors.length > 0) {
          alerts.push({ machine: m.machine, kind: 'collection_error', level: 'warning',
            detail: `${m.collection_errors.length} collector(s) failed: ${m.collection_errors.map(e => e.collector).join(', ')}` })
        }
      }

      return { data_age_minutes: age, alert_count: alerts.length, alerts }
    }))

    // ── skills_diff ──────────────────────────────────────────────────────────
    case 'skills_diff': return text(withSnapshot((s, age) => {
      const online = s.machines.filter(m => m.status === 'online' && m.skills)
      if (!online.length) return { error: 'No online machines with skills data' }

      // Reference: machine with most skills
      const reference = online.reduce((best, m) =>
        (m.skills?.global_skills.length ?? 0) > (best.skills?.global_skills.length ?? 0) ? m : best
      )
      const refSkills = new Set(reference.skills!.global_skills)

      return {
        data_age_minutes: age,
        reference_machine: reference.machine,
        machines: online.map(m => {
          const machineSkills = new Set(m.skills!.global_skills)
          return {
            machine:       m.machine,
            skill_count:   m.skills!.global_skills.length,
            plugin_count:  m.skills!.plugins.length,
            claude_version: m.skills!.claude_version,
            missing_skills: [...refSkills].filter(s => !machineSkills.has(s)),
            extra_skills:   [...machineSkills].filter(s => !refSkills.has(s)),
          }
        }),
      }
    }))

    // ── git_dirty ────────────────────────────────────────────────────────────
    case 'git_dirty': return text(withSnapshot((s, age) => {
      const machines = (args as any)?.machine
        ? s.machines.filter(m => m.machine === (args as any).machine)
        : s.machines.filter(m => m.status === 'online')

      const dirty = machines.flatMap(m =>
        (m.git_repos ?? [])
          .filter(r => r.dirty_files > 0 || r.unpushed_commits > 0)
          .map(r => ({ machine: m.machine, ...r }))
      )

      return {
        data_age_minutes: age,
        note: dirty.length === 0 && machines.some(m => !m.git_repos?.length)
          ? 'Git scan not available — run without --skip-git for git data'
          : undefined,
        total: dirty.length,
        repos: dirty,
      }
    }))

    default:
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: `Unknown tool: ${name}` }) }] }
  }
})

// ─── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
