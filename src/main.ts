/**
 * AppyRadar Sentinel — lifecycle entry point.
 *
 * Wires the orchestrator-ssh collector into the AppySentinel harness:
 *   - lifecycle.onStart → schedules collection via setInterval
 *   - collectMachine() → one MachineSnapshot per machine
 *   - sentinel.emit()  → emits each snapshot as a Signal
 *   - atomicWrite      → writes fleet snapshot file crash-safely
 *
 * Known issues (carried from PoC):
 *   - Relay/OMI parser: mode + session_id return undefined (format mismatch)
 *   - Mary machine: zero skills reported (likely setup issue on that machine)
 */

import { createSentinel, atomicWrite } from '@appydave/appysentinel-core';
import { hostname } from 'node:os';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectMachine } from './collectors/orchestrator.js';
import type { MachineConfig, AppEntry, FleetSnapshot } from './types.js';

const MACHINES: MachineConfig[] = [
  { name: 'macbook-pro', host: 'macbook-pro' },
  { name: 'mac-mini-m4', host: 'mac-mini-m4' },
  { name: 'mac-mini-m2', host: 'mac-mini-m2' },
  { name: 'jan',         host: 'jans-mac-mini' },
  { name: 'mary',        host: 'marys-mac-mini' },
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPS_JSON_PATH = `${process.env['HOME']}/.config/appydave/apps.json`;
const SNAPSHOT_DIR = join(__dirname, '..', 'snapshots');
const COLLECT_INTERVAL_MS = 10 * 60 * 1_000; // 10 minutes

function loadApps(): AppEntry[] {
  if (!existsSync(APPS_JSON_PATH)) return [];
  const raw = JSON.parse(readFileSync(APPS_JSON_PATH, 'utf8'));
  return Object.entries(raw.apps).map(([key, v]: [string, any]) => ({
    key,
    display: v.display,
    path: v.path,
    ports: v.ports,
    group: v.group,
    tier: v.tier,
    status: v.status,
    notes: v.notes,
  }));
}

const sentinel = createSentinel({
  name: 'appyradar-sentinal',
  machine: process.env['MACHINE_NAME'] ?? hostname(),
});

sentinel.on((signal) => {
  sentinel.logger.info(
    { kind: signal.kind, name: signal.name, source: signal.source },
    'signal'
  );
});

sentinel.lifecycle.onStart(async () => {
  async function runCollection() {
    sentinel.logger.info('collection cycle starting');
    const apps = loadApps();
    const results = [];

    for (const machine of MACHINES) {
      const data = await collectMachine(machine, apps, {
        skipGit: true,
        log: (msg) => sentinel.logger.info(msg),
      });
      results.push(data);

      sentinel.emit({
        source: 'orchestrator-ssh',
        kind: 'state',
        name: 'machine.snapshot',
        payload: data,
      });
    }

    const online  = results.filter(r => r.status === 'online');
    const offline = results.filter(r => r.status !== 'online');

    const snapshot: FleetSnapshot = {
      schema_version: '1.3',
      generated_at: new Date().toISOString(),
      summary: {
        total_machines:   MACHINES.length,
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
      source: 'snapshot-store',
      kind: 'event',
      name: 'fleet.snapshot.written',
      payload: { online: online.length, offline: offline.length, total: MACHINES.length },
    });

    sentinel.logger.info(
      { online: online.length, offline: offline.length, total: MACHINES.length },
      'collection cycle complete'
    );
  }

  // First run immediately, then on interval.
  await runCollection();
  setInterval(
    () => { runCollection().catch(err => sentinel.logger.error(err, 'collection failed')); },
    COLLECT_INTERVAL_MS
  );
});

await sentinel.start();

sentinel.logger.info('appyradar-sentinal is running. Press Ctrl-C to stop.');
