/**
 * Fleet command functions — write side of the Access zone.
 *
 * Stateless file operations. Commands read/write sentinel.config.json and
 * state/*.json. The collection loop reads state/ on each tick.
 * No shared memory. No runtime references. No singletons.
 *
 * Effects reach the loop via files:
 *   state/paused.json  ← read by loop before each machine
 *   state/trigger.json ← read by loop at start of each tick, then deleted
 */

import { readFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWrite } from '@appydave/appysentinel-core'
import { CONFIG_PATH, SNAPSHOT_DIR, SNAPSHOT_LATEST, STATE_DIR } from '../../constants.js'
import { collectMachine } from '../../collect/collectors/orchestrator.js'
import type { MachineConfig, AppEntry, FleetSnapshot, MachineSnapshot } from '../../types.js'

// ── File helpers (all stateless) ─────────────────────────────────────────────

function ensureStateDir() { mkdirSync(STATE_DIR, { recursive: true }) }

export function readPausedMachines(): string[] {
  const p = join(STATE_DIR, 'paused.json')
  if (!existsSync(p)) return []
  return JSON.parse(readFileSync(p, 'utf8')) as string[]
}

async function writePausedMachines(machines: string[]) {
  ensureStateDir()
  await atomicWrite(join(STATE_DIR, 'paused.json'), JSON.stringify(machines, null, 2))
}

function readConfig() {
  if (!existsSync(CONFIG_PATH)) throw new Error('sentinel.config.json not found')
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as {
    machines: MachineConfig[]
    appsJsonPath: string
    collectIntervalMinutes: number
    skipGit: boolean
  }
}

async function writeConfig(cfg: object) {
  await atomicWrite(CONFIG_PATH, JSON.stringify(cfg, null, 2))
}

function readApps(appsJsonPath: string): AppEntry[] {
  if (!existsSync(appsJsonPath)) return []
  const raw = JSON.parse(readFileSync(appsJsonPath, 'utf8'))
  return Object.entries(raw.apps).map(([key, v]: [string, any]) => ({
    key, display: v.display, path: v.path, ports: v.ports,
    group: v.group, tier: v.tier, status: v.status, notes: v.notes,
  }))
}

function readSnapshot(): FleetSnapshot | null {
  if (!existsSync(SNAPSHOT_LATEST)) return null
  return JSON.parse(readFileSync(SNAPSHOT_LATEST, 'utf8')) as FleetSnapshot
}

async function patchSnapshot(machine: MachineSnapshot) {
  const snapshot = readSnapshot()
  if (!snapshot) return
  const idx = snapshot.machines.findIndex(m => m.machine === machine.machine)
  if (idx >= 0) {
    snapshot.machines[idx] = machine
  } else {
    snapshot.machines.push(machine)
  }
  const online  = snapshot.machines.filter(m => m.status === 'online')
  const offline = snapshot.machines.filter(m => m.status !== 'online')
  snapshot.summary.total_machines   = snapshot.machines.length
  snapshot.summary.online           = online.length
  snapshot.summary.offline          = offline.length
  snapshot.summary.offline_machines = offline.map(m => m.machine)
  snapshot.generated_at             = new Date().toISOString()
  mkdirSync(SNAPSHOT_DIR, { recursive: true })
  await atomicWrite(SNAPSHOT_LATEST, JSON.stringify(snapshot, null, 2))
}

// ── Commands ──────────────────────────────────────────────────────────────────

export async function pauseCollection(machineName: string): Promise<{ ok: boolean; paused: string[] }> {
  const paused = readPausedMachines()
  if (!paused.includes(machineName)) paused.push(machineName)
  await writePausedMachines(paused)
  return { ok: true, paused }
}

export async function resumeCollection(machineName: string): Promise<{ ok: boolean; paused: string[] }> {
  const paused = readPausedMachines().filter(m => m !== machineName)
  await writePausedMachines(paused)
  return { ok: true, paused }
}

/**
 * Force the expensive drift rules to run on the next tick, bypassing the ~12h
 * interval. This is the PRIMARY path for getting fresh drift data — the
 * interval is only a backstop so findings do not go stale unattended.
 */
export async function runDrift(machineName?: string): Promise<{ ok: boolean; note: string }> {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
  await atomicWrite(
    join(STATE_DIR, 'trigger.json'),
    JSON.stringify({ requested_at: new Date().toISOString(), machine: machineName ?? null, drift: true }, null, 2)
  )
  return {
    ok: true,
    note: `Drift rules queued for ${machineName ?? 'all machines'}; they run on the next collection tick. These walk the filesystem, so expect the cycle to take longer than usual.`,
  }
}

export async function triggerCollection(machineName?: string): Promise<{ ok: boolean; note: string }> {
  ensureStateDir()
  await atomicWrite(
    join(STATE_DIR, 'trigger.json'),
    JSON.stringify({ requested_at: new Date().toISOString(), machine: machineName ?? null }, null, 2)
  )
  return { ok: true, note: 'Collection queued — runs at the start of the next loop tick.' }
}

export async function removeMachine(machineName: string): Promise<{ ok: boolean; machines: MachineConfig[] }> {
  const cfg = readConfig()
  const before = cfg.machines.length
  cfg.machines = cfg.machines.filter(m => m.name !== machineName)
  if (cfg.machines.length === before) throw new Error(`Machine '${machineName}' not found.`)
  await writeConfig(cfg)
  // Clean up paused state if present
  const paused = readPausedMachines().filter(m => m !== machineName)
  await writePausedMachines(paused)
  return { ok: true, machines: cfg.machines }
}

export async function investigateMachine(machineName: string): Promise<MachineSnapshot> {
  const cfg = readConfig()
  const machine = cfg.machines.find(m => m.name === machineName)
  if (!machine) throw new Error(`Machine '${machineName}' not found. Add it first with addMachine().`)
  const apps   = readApps(cfg.appsJsonPath)
  const result = await collectMachine(machine, apps, { skipGit: cfg.skipGit })
  await patchSnapshot(result)
  return result
}

// addMachine auto-investigates so you know immediately if the machine is reachable.
export async function addMachine(machine: MachineConfig): Promise<{ ok: boolean; machines: MachineConfig[]; investigation: MachineSnapshot }> {
  const cfg = readConfig()
  if (cfg.machines.find(m => m.name === machine.name)) throw new Error(`Machine '${machine.name}' already exists.`)
  cfg.machines.push(machine)
  await writeConfig(cfg)
  const investigation = await investigateMachine(machine.name)
  return { ok: true, machines: cfg.machines, investigation }
}
