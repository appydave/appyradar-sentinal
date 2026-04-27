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
 * Configuration: copy sentinel.config.example.json → sentinel.config.json
 * and fill in your machines and appsJsonPath before running.
 *
 * Known issues (carried from PoC — see docs/graduation-candidates.md):
 *   - Relay/OMI parser: mode + session_id return undefined (format mismatch)
 *   - Mary machine: zero skills reported (likely setup issue on that machine)
 */

import { createSentinel, atomicWrite, createConfigLoader, z } from '@appydave/appysentinel-core';
import { hostname } from 'node:os';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectMachine } from './collectors/orchestrator.js';
import type { AppEntry, FleetSnapshot } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '..', 'sentinel.config.json');
const SNAPSHOT_DIR = join(__dirname, '..', 'snapshots');

// ─── Config schema ────────────────────────────────────────────────────────────

const SentinelConfigSchema = z.object({
  machines: z.array(z.object({
    name: z.string(),
    host: z.string(),
  })),
  appsJsonPath:           z.string(),
  collectIntervalMinutes: z.number(),
  skipGit:                z.boolean(),
});

const configLoader = createConfigLoader({
  schema:   SentinelConfigSchema,
  defaults: {
    machines:               [],
    appsJsonPath:           `${process.env['HOME'] ?? '~'}/.config/appydave/apps.json`,
    collectIntervalMinutes: 10,
    skipGit:                true,
  },
  filePath: CONFIG_PATH,
  env: {
    APPS_JSON_PATH:            'appsJsonPath',
    COLLECT_INTERVAL_MINUTES:  'collectIntervalMinutes',
    SKIP_GIT:                  'skipGit',
  },
});

// ─── App registry ─────────────────────────────────────────────────────────────

function loadApps(appsJsonPath: string): AppEntry[] {
  if (!existsSync(appsJsonPath)) return [];
  const raw = JSON.parse(readFileSync(appsJsonPath, 'utf8'));
  return Object.entries(raw.apps).map(([key, v]: [string, any]) => ({
    key,
    display: v.display,
    path:    v.path,
    ports:   v.ports,
    group:   v.group,
    tier:    v.tier,
    status:  v.status,
    notes:   v.notes,
  }));
}

// ─── Sentinel ─────────────────────────────────────────────────────────────────

const sentinel = createSentinel({
  name:    'appyradar-sentinal',
  machine: process.env['MACHINE_NAME'] ?? hostname(),
});

sentinel.on((signal) => {
  sentinel.logger.info(
    { kind: signal.kind, name: signal.name, source: signal.source },
    'signal'
  );
});

sentinel.lifecycle.onStart(async () => {
  const cfg = await configLoader.load();

  if (cfg.machines.length === 0) {
    sentinel.logger.warn('No machines configured. Copy sentinel.config.example.json → sentinel.config.json and add your machines.');
    return;
  }

  sentinel.logger.info({ machines: cfg.machines.map(m => m.name) }, 'fleet configured');

  async function runCollection() {
    const apps    = loadApps(cfg.appsJsonPath);
    const results = [];

    for (const machine of cfg.machines) {
      const data = await collectMachine(machine, apps, {
        skipGit: cfg.skipGit,
        log: (msg) => sentinel.logger.info(msg),
      });
      results.push(data);

      sentinel.emit({
        source:  'orchestrator-ssh',
        kind:    'state',
        name:    'machine.snapshot',
        payload: data,
      });
    }

    const online  = results.filter(r => r.status === 'online');
    const offline = results.filter(r => r.status !== 'online');

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
    };

    mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const json = JSON.stringify(snapshot, null, 2);
    const date = new Date().toISOString().split('T')[0];
    await atomicWrite(join(SNAPSHOT_DIR, `sentinel-${date}.json`), json);
    await atomicWrite(join(SNAPSHOT_DIR, 'sentinel-latest.json'), json);

    sentinel.emit({
      source:  'snapshot-store',
      kind:    'event',
      name:    'fleet.snapshot.written',
      payload: { online: online.length, offline: offline.length, total: cfg.machines.length },
    });

    sentinel.logger.info(
      { online: online.length, offline: offline.length, total: cfg.machines.length },
      'collection cycle complete'
    );
  }

  // First run immediately, then on interval.
  await runCollection();
  const intervalMs = cfg.collectIntervalMinutes * 60 * 1_000;
  setInterval(
    () => { runCollection().catch(err => sentinel.logger.error(err, 'collection failed')); },
    intervalMs
  );
});

await sentinel.start();

sentinel.logger.info('appyradar-sentinal is running. Press Ctrl-C to stop.');
