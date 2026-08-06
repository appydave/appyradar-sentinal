/**
 * Drift run scheduling — decides WHEN the drift rules run, separately from the
 * collection cycle.
 *
 * WHY THIS EXISTS
 *   Drift rules are expensive, not merely chatty. Two of them walk the
 *   filesystem (`~/dev` for orphaned pack files, Application Support for large
 *   SQLite) and a third stats every `.git` under ~/dev/upstream/repos — 115
 *   repos on the M4. The collection cycle runs every ~10 minutes; the facts
 *   these rules discover change on a scale of DAYS.
 *
 *   Running them every cycle spends real I/O and CPU competing with the very
 *   disk and memory pressure the collector exists to observe.
 *
 * WHY TIMESTAMPS, NOT A CYCLE COUNTER
 *   A counter resets when the daemon restarts, so every restart would re-run
 *   drift on every machine at once — a stampede, and restarts are exactly when
 *   the machine is already busy. Persisting the last run time means a restart
 *   changes nothing about when drift is next due.
 */

import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'path'
import { atomicWrite } from '@appydave/appysentinel-core'
import { STATE_DIR } from '../constants.js'

const DRIFT_RUNS_PATH = join(STATE_DIR, 'drift-runs.json')

/** Default cadence when `driftIntervalHours` is absent from config. */
export const DEFAULT_DRIFT_INTERVAL_HOURS = 12

type DriftRuns = Record<string, string>   // machine -> ISO timestamp of last run

export function readDriftRuns(): DriftRuns {
  if (!existsSync(DRIFT_RUNS_PATH)) return {}
  try {
    return JSON.parse(readFileSync(DRIFT_RUNS_PATH, 'utf8')) as DriftRuns
  } catch {
    // A corrupt state file must not stop collection. Worst case drift runs
    // once more than needed — the opposite failure (never running) is silent.
    return {}
  }
}

export async function recordDriftRun(machine: string, at: Date = new Date()): Promise<void> {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
  const runs = readDriftRuns()
  runs[machine] = at.toISOString()
  await atomicWrite(DRIFT_RUNS_PATH, JSON.stringify(runs, null, 2))
}

/**
 * Is drift due for this machine?
 *
 * A machine never seen before is always due — first contact should establish a
 * baseline rather than wait 12 hours. An unparseable stored timestamp is also
 * treated as due, for the same reason a corrupt state file is: running twice is
 * cheap, never running is invisible.
 */
export function isDriftDue(
  machine: string,
  runs: DriftRuns,
  intervalHours: number = DEFAULT_DRIFT_INTERVAL_HOURS,
  now: Date = new Date()
): boolean {
  const last = runs[machine]
  if (!last) return true
  const lastMs = new Date(last).getTime()
  if (Number.isNaN(lastMs)) return true
  return now.getTime() - lastMs >= intervalHours * 3_600_000
}

/** Minutes until drift is next due — for reporting. Zero means due now. */
export function minutesUntilDriftDue(
  machine: string,
  runs: DriftRuns,
  intervalHours: number = DEFAULT_DRIFT_INTERVAL_HOURS,
  now: Date = new Date()
): number {
  const last = runs[machine]
  if (!last) return 0
  const lastMs = new Date(last).getTime()
  if (Number.isNaN(lastMs)) return 0
  const dueMs = lastMs + intervalHours * 3_600_000
  return Math.max(0, Math.round((dueMs - now.getTime()) / 60_000))
}
