/**
 * AppyRadar Sentinel — lifecycle entry point.
 *
 * Wires the orchestrator-ssh collector into the AppySentinel harness:
 *   - createConfigLoader  → reads sentinel.config.json (gitignored, per-deployment)
 *   - lifecycle.onStart   → schedules collection via setInterval
 *   - collectMachine()    → one MachineSnapshot per machine
 *   - sentinel.emit()     → emits each snapshot as a Signal on the bus
 *   - atomicWrite         → writes fleet snapshot file crash-safely
 *
 * Command signals (written by access/command/fleet.ts, read here):
 *   state/paused.json    → machines to skip this tick
 *   state/trigger.json   → request immediate collection (deleted after reading)
 *
 * Configuration: copy sentinel.config.example.json → sentinel.config.json
 * and fill in your machines and appsJsonPath before running.
 */

import { createSentinel, atomicWrite, createConfigLoader, z } from '@appydave/appysentinel-core'
import { hostname } from 'node:os'
import { readFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { collectMachine } from './collect/collectors/orchestrator.js'
import {
  readDriftRuns, recordDriftRun, isDriftDue,
  DEFAULT_DRIFT_INTERVAL_HOURS,
} from './collect/drift-schedule.js'
import { readPausedMachines } from './access/command/fleet.js'
import type { AppEntry, FleetSnapshot } from './types.js'
import { CONFIG_PATH, SNAPSHOT_DIR, SNAPSHOT_LATEST, STATE_DIR } from './constants.js'

// ─── Config schema ────────────────────────────────────────────────────────────

const SentinelConfigSchema = z.object({
  machines: z.array(z.object({
    name: z.string(),
    host: z.string(),
  })),
  appsJsonPath:           z.string(),
  collectIntervalMinutes: z.number(),
  skipGit:                z.boolean(),
  /** How often the expensive drift rules run, independent of the collect cycle. */
  driftIntervalHours:     z.number().optional(),
})

const configLoader = createConfigLoader({
  schema:   SentinelConfigSchema,
  defaults: {
    machines:               [],
    appsJsonPath:           `${process.env['HOME'] ?? '~'}/.config/appydave/apps.json`,
    collectIntervalMinutes: 10,
    skipGit:                true,
    driftIntervalHours:     DEFAULT_DRIFT_INTERVAL_HOURS,
  },
  filePath: CONFIG_PATH,
  env: {
    APPS_JSON_PATH:           'appsJsonPath',
    COLLECT_INTERVAL_MINUTES: 'collectIntervalMinutes',
    SKIP_GIT:                 'skipGit',
    DRIFT_INTERVAL_HOURS:     'driftIntervalHours',
  },
})

// ─── App registry ─────────────────────────────────────────────────────────────

function loadApps(appsJsonPath: string): AppEntry[] {
  if (!existsSync(appsJsonPath)) return []
  const raw = JSON.parse(readFileSync(appsJsonPath, 'utf8'))
  return Object.entries(raw.apps).map(([key, v]: [string, any]) => ({
    key,
    display: v.display,
    path:    v.path,
    ports:   v.ports,
    group:   v.group,
    tier:    v.tier,
    status:  v.status,
    notes:   v.notes,
  }))
}

// ─── Trigger file ─────────────────────────────────────────────────────────────

function consumeTrigger(): { machine: string | null; drift?: boolean } | null {
  const triggerPath = join(STATE_DIR, 'trigger.json')
  if (!existsSync(triggerPath)) return null
  try {
    const trigger = JSON.parse(readFileSync(triggerPath, 'utf8')) as { machine: string | null; drift?: boolean }
    unlinkSync(triggerPath)
    return trigger
  } catch {
    return null
  }
}

// ─── Sentinel ─────────────────────────────────────────────────────────────────

const sentinel = createSentinel({
  name:    'appyradar-sentinal',
  machine: process.env['MACHINE_NAME'] ?? hostname(),
})

sentinel.on((signal) => {
  sentinel.logger.info(
    { kind: signal.kind, name: signal.name, source: signal.source },
    'signal'
  )
})

sentinel.lifecycle.onStart(async () => {
  const cfg = await configLoader.load()

  if (cfg.machines.length === 0) {
    sentinel.logger.warn('No machines configured. Copy sentinel.config.example.json → sentinel.config.json and add your machines.')
    return
  }

  sentinel.logger.info({ machines: cfg.machines.map(m => m.name) }, 'fleet configured')

  async function runCollection(forceMachine?: string | null, forceDrift = false) {
    const paused = readPausedMachines()
    const apps   = loadApps(cfg.appsJsonPath)

    const machines = forceMachine
      ? cfg.machines.filter(m => m.name === forceMachine)
      : cfg.machines.filter(m => !paused.includes(m.name))

    if (paused.length > 0 && !forceMachine) {
      sentinel.logger.info({ paused }, 'skipping paused machines')
    }

    // Drift is throttled independently of the collection cycle — the rules walk
    // the filesystem and their findings change over days. `forceDrift` is the
    // on-demand path (run_drift); the interval is only the backstop.
    const driftIntervalHours = cfg.driftIntervalHours ?? DEFAULT_DRIFT_INTERVAL_HOURS
    const driftRuns = readDriftRuns()

    const results = []
    for (const machine of machines) {
      const runDrift = forceDrift || isDriftDue(machine.name, driftRuns, driftIntervalHours)
      const data = await collectMachine(machine, apps, {
        skipGit: cfg.skipGit,
        runDrift,
        // debug, not info: this is per-machine progress chatter ("✓ online",
        // "tools...", "angeleye...") meant for an attached terminal. Under
        // launchd, stdout is redirected to a file that nothing rotates, so at
        // info level it wrote ~333k lines / 48 MB of spinner text to disk.
        // The outcome of each cycle is still recorded by the emit() below and
        // the 'collection cycle complete' summary.
        log: (msg) => sentinel.logger.debug(msg),
      })
      results.push(data)

      // Record only on success. A failed SSH must not push the next attempt
      // 12 hours out — an unreachable machine should be retried, not skipped.
      if (runDrift && data.status === 'online') {
        await recordDriftRun(machine.name)
      }

      sentinel.emit({
        source:  'orchestrator-ssh',
        kind:    'state',
        name:    'machine.snapshot',
        payload: data,
      })
    }

    const online  = results.filter(r => r.status === 'online')
    const offline = results.filter(r => r.status !== 'online')

    const snapshot: FleetSnapshot = {
      schema_version: '1.3',
      generated_at:   new Date().toISOString(),
      summary: {
        total_machines:   cfg.machines.length,
        online:           online.length,
        offline:          offline.length,
        offline_machines: offline.map(r => r.machine),
        apps_registered:  apps.length,
      },
      machines: results,
    }

    mkdirSync(SNAPSHOT_DIR, { recursive: true })
    const json = JSON.stringify(snapshot, null, 2)
    const date = new Date().toISOString().split('T')[0]
    await atomicWrite(join(SNAPSHOT_DIR, `sentinel-${date}.json`), json)
    await atomicWrite(SNAPSHOT_LATEST, json)

    sentinel.emit({
      source:  'snapshot-store',
      kind:    'event',
      name:    'fleet.snapshot.written',
      payload: { online: online.length, offline: offline.length, total: cfg.machines.length },
    })

    sentinel.logger.info(
      { online: online.length, offline: offline.length, total: cfg.machines.length },
      'collection cycle complete'
    )
  }

  // First run immediately, then on interval.
  await runCollection()

  const intervalMs = cfg.collectIntervalMinutes * 60 * 1_000
  setInterval(() => {
    // Consume trigger file if present — lets a command request a specific machine or full cycle.
    const trigger = consumeTrigger()
    const forceMachine = trigger?.machine ?? undefined
    const forceDrift = trigger?.drift === true
    if (trigger) sentinel.logger.info({ machine: forceMachine ?? 'all', drift: forceDrift }, 'triggered collection')
    runCollection(forceMachine, forceDrift).catch(err => sentinel.logger.error(err, 'collection failed'))
  }, intervalMs)
})

await sentinel.start()

sentinel.logger.info('appyradar-sentinal is running. Press Ctrl-C to stop.')
