/**
 * Fleet query functions — read side of the Access zone.
 *
 * Pure functions over FleetSnapshot. No transport knowledge.
 * Each function returns QueryResult<T> — data + freshness metadata.
 * Bindings (MCP, HTTP, CLI) call these and wrap the result in their protocol format.
 */

import type { QueryResult } from '@appydave/appysentinel-core'
import type { FleetSnapshot, MachineSnapshot } from '../../types.js'

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

function worstDiskAlert(machine: MachineSnapshot): 'ok' | 'warning' | 'critical' {
  if (!machine.disk?.length) return 'ok'
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
