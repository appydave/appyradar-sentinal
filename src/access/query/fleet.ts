/**
 * Fleet query functions — read side of the Access zone.
 *
 * Pure functions over FleetSnapshot. No transport knowledge.
 * Each function returns QueryResult<T> — data + freshness metadata.
 * Bindings (MCP, HTTP, CLI) call these and wrap the result in their protocol format.
 */

import type { QueryResult } from '@appydave/appysentinel-core'
import type { FleetSnapshot, MachineSnapshot } from '../../types.js'
import { minutesUntilDriftDue, DEFAULT_DRIFT_INTERVAL_HOURS } from '../../collect/drift-schedule.js'

const STALE_THRESHOLD_MS = 60 * 60 * 1_000

function makeResult<T>(data: T, snapshot: FleetSnapshot): QueryResult<T> {
  const data_age_ms = Date.now() - new Date(snapshot.generated_at).getTime()
  return {
    data,
    generated_at: snapshot.generated_at,
    data_age_ms,
    stale: data_age_ms > STALE_THRESHOLD_MS,
  }
}

/**
 * Worst disk alert across a machine's volumes.
 *
 * Returns 'unknown' — NOT 'ok' — when there is no disk data. A machine that has
 * never reported has not been found healthy; it has not been measured. Every
 * other field in getFleetStatus() signals absence with `?? null`, and this one
 * used to be the exception: on 2026-08-04 four offline machines rendered as
 * `disk_alert: "ok"` with every real metric null, which reads on a dashboard as
 * a green fleet. A default that looks like good news is worse than a blank.
 */
function worstDiskAlert(machine: MachineSnapshot): 'ok' | 'warning' | 'critical' | 'unknown' {
  if (!machine.disk?.length) return 'unknown'
  if (machine.disk.some(d => d.alert === 'critical')) return 'critical'
  if (machine.disk.some(d => d.alert === 'warning'))  return 'warning'
  return 'ok'
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function getFleetStatus(snapshot: FleetSnapshot) {
  return makeResult({
    online:           snapshot.summary.online,
    total:            snapshot.summary.total_machines,
    offline_machines: snapshot.summary.offline_machines,
    machines: snapshot.machines.map(m => ({
      machine:            m.machine,
      status:             m.status,
      memory_pressure:    m.memory?.pressure     ?? null,
      memory_use_pct:     m.memory?.use_pct      ?? null,
      disk_alert:         worstDiskAlert(m),
      apps_running:       m.app_status?.filter(a => a.running).length ?? 0,
      apps_running_names: m.app_status?.filter(a => a.running).map(a => a.display) ?? [],
      collection_errors:  m.collection_errors.length,
      claude_version:     m.skills?.claude_version ?? null,
      skills_count:       m.skills?.global_skills?.length ?? 0,
    })),
  }, snapshot)
}

export function getMachineDetail(snapshot: FleetSnapshot, machineName: string) {
  const m = snapshot.machines.find(m => m.machine === machineName)
  if (!m) {
    return { error: `Machine '${machineName}' not found. Available: ${snapshot.machines.map(m => m.machine).join(', ')}` }
  }
  return makeResult(m, snapshot)
}

export function getRunningApps(snapshot: FleetSnapshot, machineName?: string) {
  const machines = machineName
    ? snapshot.machines.filter(m => m.machine === machineName)
    : snapshot.machines.filter(m => m.status === 'online')

  return makeResult(
    machines.flatMap(m =>
      (m.app_status ?? []).map(a => ({
        machine: m.machine,
        app:     a.key,
        display: a.display,
        running: a.running,
        ports:   a.ports,
      }))
    ).filter(a => a.running),
    snapshot
  )
}

export function getDiskUsage(snapshot: FleetSnapshot, machineName?: string) {
  const machines = machineName
    ? snapshot.machines.filter(m => m.machine === machineName)
    : snapshot.machines.filter(m => m.status === 'online')

  return makeResult(
    machines.flatMap(m =>
      (m.disk ?? []).map(d => ({ machine: m.machine, ...d }))
    ),
    snapshot
  )
}

export function getAlerts(snapshot: FleetSnapshot) {
  const alerts: Array<{ machine: string; kind: string; level: string; detail: string }> = []
  const data_age_ms = Date.now() - new Date(snapshot.generated_at).getTime()

  if (data_age_ms > STALE_THRESHOLD_MS) {
    alerts.push({ machine: 'fleet', kind: 'stale_data', level: 'warning',
      detail: `Snapshot is ${Math.round(data_age_ms / 60_000)} minutes old (threshold: 60m)` })
  }

  for (const m of snapshot.machines) {
    if (m.status !== 'online') {
      alerts.push({ machine: m.machine, kind: 'offline', level: 'warning', detail: `Status: ${m.status}` })
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

  return makeResult({ alert_count: alerts.length, alerts }, snapshot)
}

export function getSkillsDiff(snapshot: FleetSnapshot) {
  const online = snapshot.machines.filter(m => m.status === 'online' && m.skills)
  if (!online.length) {
    return { error: 'No online machines with skills data' }
  }

  const reference = online.reduce((best, m) =>
    (m.skills?.global_skills.length ?? 0) > (best.skills?.global_skills.length ?? 0) ? m : best
  )
  const refSkills = new Set(reference.skills!.global_skills)

  return makeResult({
    reference_machine: reference.machine,
    machines: online.map(m => {
      const machineSkills = new Set(m.skills!.global_skills)
      return {
        machine:        m.machine,
        skill_count:    m.skills!.global_skills.length,
        plugin_count:   m.skills!.plugins.length,
        claude_version: m.skills!.claude_version,
        missing_skills: [...refSkills].filter(s => !machineSkills.has(s)),
        extra_skills:   [...machineSkills].filter(s => !refSkills.has(s)),
      }
    }),
  }, snapshot)
}

export function getGitDirty(snapshot: FleetSnapshot, machineName?: string) {
  const machines = machineName
    ? snapshot.machines.filter(m => m.machine === machineName)
    : snapshot.machines.filter(m => m.status === 'online')

  return makeResult(
    machines.flatMap(m =>
      (m.git_repos ?? [])
        .filter(r => r.dirty_files > 0 || r.unpushed_commits > 0)
        .map(r => ({ machine: m.machine, ...r }))
    ),
    snapshot
  )
}

/**
 * Drift findings across the fleet — rule violations, not measurements.
 *
 * ⚠️ ONLINE ≠ CHECKED. Drift runs on its own ~12h interval, so on most cycles a
 * machine is online with `drift === undefined` — meaning *not checked*, which is
 * NOT the same as checked-and-clean (`drift === []`). Counting online machines as
 * checked, or collapsing `undefined` into `[]` with `?? []`, reports an unexamined
 * machine as healthy. Both of those bugs existed here between 2026-08-05 and
 * 2026-08-06.
 *
 * PRIOR ART — this is the third instance of one defect class in this codebase:
 *   1. `worstDiskAlert()` returned 'ok' for machines that had never reported disk.
 *   2. `track()` records an empty collector result as an ERROR, which is right for
 *      every collector except drift, where empty means "no rule fired".
 *   3. This function counted online-but-unchecked machines as checked.
 * In each case a value meaning "no data" rendered as a value meaning "fine".
 * **Whenever absence and success can look identical, make them different types.**
 *
 * `driftRuns` is passed in rather than read from disk — this module is documented
 * as pure functions over FleetSnapshot, and reading state here would break that.
 */
export function getDriftFindings(
  snapshot: FleetSnapshot,
  opts: {
    machine?: string
    severity?: 'info' | 'warning' | 'critical'
    /** machine -> ISO timestamp of last drift run, for the not-checked ETA. */
    driftRuns?: Record<string, string>
    driftIntervalHours?: number
  } = {}
) {
  const machines = opts.machine
    ? snapshot.machines.filter(m => m.machine === opts.machine)
    : snapshot.machines

  // Deliberately NOT `m.drift ?? []` — see the header. An unchecked machine
  // contributes no findings AND must not be counted as clean.
  const checked   = machines.filter(m => m.drift !== undefined)
  const unchecked = machines.filter(m => m.status === 'online' && m.drift === undefined)

  const findings = checked.flatMap(m =>
    m.drift!.map(d => ({ machine: m.machine, ...d }))
  ).filter(f => !opts.severity || f.severity === opts.severity)

  const rank = { critical: 0, warning: 1, info: 2 } as const
  findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.rule.localeCompare(b.rule))

  return makeResult({
    finding_count: findings.length,
    machines_checked: checked.length,
    /** Online but not drift-checked this cycle. Their state is UNKNOWN, not clean. */
    machines_not_checked: unchecked.map(m => ({
      machine: m.machine,
      minutes_until_due: opts.driftRuns
        ? minutesUntilDriftDue(m.machine, opts.driftRuns, opts.driftIntervalHours ?? DEFAULT_DRIFT_INTERVAL_HOURS)
        : null,
    })),
    by_rule: findings.reduce<Record<string, number>>((acc, f) => {
      acc[f.rule] = (acc[f.rule] ?? 0) + 1
      return acc
    }, {}),
    findings,
  }, snapshot)
}
