/**
 * Pure output parsers for the orchestrator-ssh collector.
 *
 * Rules:
 * - No SSH, no filesystem, no side effects — pure string → typed result.
 * - Never throw on any input (null, undefined, malformed, empty).
 * - Each function accepts the raw sshScript() output string.
 *
 * Mirrors the disk-usage/parser.ts pattern — every function is independently testable.
 */

import { parseKV } from '../ssh/client.js'
import type {
  IdentityPayload,
  SystemPayload,
  MemoryPayload,
  DiskVolumePayload,
  ToolsPayload,
  AppEntry,
  AppStatusPayload,
  RelayPayload,
  OMIPayload,
  SkillsPayload,
  BrainsPayload,
  AnsiblePayload,
  AngelEyePayload,
  GitRepoPayload,
  DriftFinding,
} from '../../types.js'

// ─── System snapshot (batched: identity + system + disk) ───────────────────────

/**
 * Split the compound systemSnapshot output into its three sections.
 * Returns { identity: string, system: string, disk: string }
 */
export function splitSystemSnapshot(raw: string): { identity: string; system: string; disk: string } {
  const sections: Record<string, string[]> = { identity: [], system: [], disk: [] }
  let current: string | null = null

  for (const line of (raw ?? '').split('\n')) {
    const m = line.match(/^--- (\w+) ---$/)
    if (m) { current = m[1] ?? null; continue }
    if (current && current in sections) sections[current]!.push(line)
  }

  return {
    identity: sections['identity']!.join('\n'),
    system:   sections['system']!.join('\n'),
    disk:     sections['disk']!.join('\n'),
  }
}

export function parseIdentity(raw: string): IdentityPayload {
  const kv = parseKV(raw ?? '')
  return {
    hostname: kv['hostname'] ?? '',
    os:       kv['os']       ?? '',
    arch:     kv['arch']     ?? '',
    uptime:   kv['uptime']   ?? '',
    user:     kv['user']     ?? '',
    load_1m:  parseFloat(kv['load_1m'] ?? '0') || 0,
    load_5m:  parseFloat(kv['load_5m'] ?? '0') || 0,
  }
}

export function parseSystem(raw: string): SystemPayload {
  const kv = parseKV(raw ?? '')
  return {
    mem_raw:              kv['mem_raw']              ?? '',
    cpu_cores:            parseInt(kv['cpu_cores']   ?? '0') || 0,
    ram_total_gb:         parseInt(kv['ram_total_gb'] ?? '0') || 0,
    memory_pressure_raw:  kv['memory_pressure_raw']  ?? '',
  }
}

/**
 * Parse memory from SystemPayload.
 *
 * pressure is derived from `sysctl kern.memorystatus_vm_pressure_level`:
 *   "1" → 'ok'  (Normal)
 *   "2" → 'warning'
 *   "4" → 'critical'
 *
 * Falls back to use_pct heuristic only if sysctl value is absent
 * (older macOS or non-macOS).
 */
export function parseMemory(system: SystemPayload): MemoryPayload {
  const memRaw     = system.mem_raw     ?? ''
  const ramTotalGb = system.ram_total_gb ?? 0

  const sizeToGb = (s: string): number => {
    const m = s.match(/^([\d.]+)(G|M)$/)
    if (!m) return 0
    const n = parseFloat(m[1] ?? '0')
    return m[2] === 'G' ? Math.round(n * 10) / 10 : Math.round(n / 102.4) / 10
  }

  const usedStr = memRaw.match(/([\d.]+[GM])\s+used/)?.[1]   ?? ''
  const freeStr = memRaw.match(/([\d.]+[GM])\s+unused/)?.[1] ?? ''

  const used_gb  = sizeToGb(usedStr)
  const free_gb  = sizeToGb(freeStr)
  const total_gb = ramTotalGb || Math.round((used_gb + free_gb) * 10) / 10
  const use_pct  = total_gb > 0 ? Math.round((used_gb / total_gb) * 100) : 0

  // Authoritative macOS pressure from sysctl kern.memorystatus_vm_pressure_level
  const pressureLevel = parseInt(system.memory_pressure_raw ?? '', 10)
  let pressure: 'ok' | 'warning' | 'critical'
  if (pressureLevel === 4) {
    pressure = 'critical'
  } else if (pressureLevel === 2) {
    pressure = 'warning'
  } else if (pressureLevel === 1) {
    pressure = 'ok'
  } else {
    // Fallback heuristic when sysctl unavailable
    pressure = use_pct >= 90 ? 'critical' : use_pct >= 75 ? 'warning' : 'ok'
  }

  return { used_gb, free_gb, total_gb, use_pct, pressure }
}

export function parseDisk(raw: string): DiskVolumePayload[] {
  return (raw ?? '').split('\n').filter(Boolean).map(line => {
    const [filesystem, total_kb, used_kb, avail_kb, use_pct, mount] = line.split('|')
    const pct = parseInt(use_pct ?? '0')
    return {
      filesystem: filesystem ?? '',
      total_gb:   Math.round(parseInt(total_kb ?? '0') / 1024 / 1024 * 10) / 10,
      used_gb:    Math.round(parseInt(used_kb  ?? '0') / 1024 / 1024 * 10) / 10,
      avail_gb:   Math.round(parseInt(avail_kb ?? '0') / 1024 / 1024 * 10) / 10,
      use_pct:    pct,
      mount:      mount ?? '',
      alert:      pct >= 85 ? 'critical' : pct >= 70 ? 'warning' : 'ok',
    }
  })
}

// ─── Tools ────────────────────────────────────────────────────────────────────

export function parseTools(raw: string): ToolsPayload {
  const kv = parseKV(raw ?? '')
  const str = (k: string): string | null => kv[k] ? kv[k]! : null
  const num = (k: string): number | null => {
    const v = kv[k]
    if (!v || v === '') return null
    const n = parseInt(v)
    return isNaN(n) ? null : n
  }
  return {
    ruby:          str('ruby'),
    node:          str('node'),
    bun:           str('bun'),
    python3:       str('python3'),
    ansible:       str('ansible'),
    git:           str('git'),
    brew:          str('brew'),
    claude:        str('claude'),
    tmux:          str('tmux'),
    docker:        str('docker'),
    rbenv:         str('rbenv'),
    ollama:        str('ollama'),
    tailscale:     str('tailscale'),
    brew_outdated: num('brew_outdated'),
  }
}

// ─── Apps ────────────────────────────────────────────────────────────────────

export function parseApps(
  pathRaw: string,
  portListRaw: string,
  apps: AppEntry[]
): AppStatusPayload[] {
  const pathStatus: Record<string, boolean> = {}
  for (const line of (pathRaw ?? '').split('\n').filter(Boolean)) {
    const [key, state] = line.split(':')
    if (key) pathStatus[key] = state === 'exists'
  }

  const listeningPorts = new Set(
    (portListRaw ?? '').split('\n').filter(Boolean).map(Number)
  )

  return apps.map(app => ({
    key:               app.key,
    display:           app.display,
    group:             app.group,
    tier:              app.tier,
    registered_status: app.status,
    path_exists:       pathStatus[app.key] ?? false,
    running:           [app.ports.client, app.ports.server].some(p => p && listeningPorts.has(p)),
    ports: {
      ...(app.ports.client ? { client: { port: app.ports.client, listening: listeningPorts.has(app.ports.client) } } : {}),
      ...(app.ports.server ? { server: { port: app.ports.server, listening: listeningPorts.has(app.ports.server) } } : {}),
    },
  }))
}

// ─── Relay + OMI (from batched script) ───────────────────────────────────────

export function splitRelayAndOMI(raw: string): { relay: string; omi: string } {
  const sections: Record<string, string[]> = { relay: [], omi: [], monthly: [], pending_files: [] }
  let current: string | null = null

  for (const line of (raw ?? '').split('\n')) {
    const m = line.match(/^--- (\S+) ---$/)
    if (m) { current = m[1] ?? null; continue }
    if (current === 'monthly' || current === 'pending_files') {
      sections['omi']!.push(line)
    } else if (current && current in sections) {
      sections[current]!.push(line)
    }
  }

  return {
    relay: sections['relay']!.join('\n'),
    omi:   sections['omi']!.join('\n'),
  }
}

export function parseRelay(raw: string): RelayPayload {
  const lines = (raw ?? '').split('\n').filter(Boolean)
  const kv = parseKV(raw ?? '')

  if (kv['relay_exists'] === 'false') return { exists: false }

  const folders = lines.filter(l => l.startsWith('folder:')).map(l => {
    const [, rest] = l.split('folder:')
    const [name, count, last_modified] = (rest ?? '').split('|')
    return { name: name ?? '', file_count: parseInt(count ?? '0') || 0, last_modified: last_modified ?? null }
  })

  return {
    exists: true,
    syncthing_running: kv['syncthing_running'] === 'true',
    folders,
  }
}

export function parseOMI(raw: string): OMIPayload {
  const lines = (raw ?? '').split('\n').filter(Boolean)
  const kv    = parseKV(raw ?? '')

  if (kv['omi_exists'] === 'false') return { exists: false }

  const monthly: Record<string, number> = {}
  for (const line of lines.filter(l => l.startsWith('month:'))) {
    const [, rest] = line.split('month:')
    const [month, count] = (rest ?? '').split('|')
    if (month) monthly[month] = parseInt(count ?? '0') || 0
  }

  const sample_pending = lines
    .filter(l => l.startsWith('pending_file:'))
    .map(l => l.replace('pending_file:', ''))

  return {
    exists:            true,
    total_files:       parseInt(kv['omi_total']    ?? '0') || 0,
    enriched_files:    parseInt(kv['omi_enriched'] ?? '0') || 0,
    pending_files:     parseInt(kv['omi_pending']  ?? '0') || 0,
    newest_file:       kv['omi_newest'] ?? null,
    oldest_file:       kv['omi_oldest'] ?? null,
    monthly_breakdown: monthly,
    sample_pending,
  }
}

// ─── Agent state (skills + brains + ansible from batched script) ─────────────

export function splitAgentState(raw: string): { skills: string; brains: string; ansible: string } {
  const sections: Record<string, string[]> = { skills: [], brains: [], ansible: [] }
  let current: string | null = null

  for (const line of (raw ?? '').split('\n')) {
    const m = line.match(/^--- (\w+) ---$/)
    if (m) { current = m[1] ?? null; continue }
    if (current && current in sections) sections[current]!.push(line)
  }

  return {
    skills:  sections['skills']!.join('\n'),
    brains:  sections['brains']!.join('\n'),
    ansible: sections['ansible']!.join('\n'),
  }
}

export function parseSkills(raw: string): SkillsPayload {
  const lines = (raw ?? '').split('\n').filter(Boolean)
  const kv    = parseKV(raw ?? '')
  return {
    global_skills: lines.filter(l => l.startsWith('global:')).map(l => l.replace('global:', '')),
    plugins:       lines.filter(l => l.startsWith('plugin:')).map(l => l.replace('plugin:', '')),
    commands:      lines.filter(l => l.startsWith('command:')).map(l => l.replace('command:', '')),
    claude_version: kv['claude_version'] ?? null,
  }
}

export function parseBrains(raw: string): BrainsPayload {
  const lines = (raw ?? '').split('\n').filter(Boolean)
  const kv    = parseKV(raw ?? '')

  if (kv['brains_exists'] === 'false') return { exists: false }

  const brains = lines.filter(l => l.startsWith('brain:')).map(l => {
    const [, rest] = l.split('brain:')
    const [name, status, activity_level, last_major_update, file_count] = (rest ?? '').split('|')
    return {
      name:              name              ?? '',
      status:            status            ?? '',
      activity_level:    activity_level    ?? '',
      last_major_update: last_major_update ?? '',
      file_count:        parseInt(file_count ?? '0') || 0,
    }
  })

  const stale = brains.filter(b => {
    if (!b.last_major_update) return false
    const days = (Date.now() - new Date(b.last_major_update).getTime()) / 86400000
    return days > 60
  })

  return {
    exists:      true,
    total:       brains.length,
    stale_count: stale.length,
    by_activity: {
      high:   brains.filter(b => b.activity_level === 'high').length,
      medium: brains.filter(b => b.activity_level === 'medium').length,
      low:    brains.filter(b => b.activity_level === 'low').length,
      none:   brains.filter(b => b.activity_level === 'none').length,
    },
    brains,
  }
}

export function parseAnsible(raw: string): AnsiblePayload {
  const lines = (raw ?? '').split('\n').filter(Boolean)
  const kv    = parseKV(raw ?? '')

  if (kv['ansible_exists'] === 'false') return { exists: false }

  return {
    exists:          true,
    playbooks:       lines.filter(l => l.startsWith('playbook:')).map(l => l.replace('playbook:', '')),
    roles:           lines.filter(l => l.startsWith('role:')).map(l => l.replace('role:', '')),
    inventory_hosts: lines.filter(l => l.startsWith('host:')).map(l => l.replace('host:', '')),
  }
}

// ─── AngelEye ─────────────────────────────────────────────────────────────────

export function parseAngelEye(raw: string): AngelEyePayload {
  const lines = (raw ?? '').split('\n').filter(Boolean)
  const kv    = parseKV(raw ?? '')

  if (kv['installed'] === 'false') return { installed: false }

  const session_types_24h: Record<string, number> = {}
  for (const line of lines) {
    const m = line.match(/^type_(\w+):(\d+)$/)
    if (m) session_types_24h[m[1]!.toUpperCase()] = parseInt(m[2] ?? '0')
  }

  return {
    installed:         true,
    running:           kv['running']           === 'true',
    total_sessions:    parseInt(kv['total_sessions']    ?? '0') || 0,
    active_sessions:   parseInt(kv['active_sessions']   ?? '0') || 0,
    sessions_24h:      parseInt(kv['sessions_24h']      ?? '0') || 0,
    top_project:       kv['top_project']        || null,
    top_project_count: parseInt(kv['top_project_count'] ?? '0') || 0,
    session_types_24h,
  }
}

// ─── Git repos ────────────────────────────────────────────────────────────────

export function parseGitRepos(raw: string): GitRepoPayload[] {
  return (raw ?? '').split('\n').filter(Boolean).map(line => {
    const [path, branch, dirty, unpushed, last_commit, remote] = line.split('|')
    return {
      path:              path        ?? '',
      branch:            branch      || null,
      dirty_files:       parseInt(dirty    ?? '0') || 0,
      unpushed_commits:  parseInt(unpushed ?? '0') || 0,
      last_commit:       last_commit || null,
      remote:            remote      || null,
    }
  })
}

// ─── Drift ──────────────────────────────────────────────────────────────────────

/**
 * Parse driftScript() output into findings.
 *
 * Input is one pipe-delimited line per violation: rule|subject|severity|detail
 * An empty result is a PASS, not a failure — silence means no rule fired. That
 * distinction matters: an empty disk collector means "SSH returned nothing",
 * but an empty drift collector means "nothing is wrong". Do not wire this into
 * the ssh_empty error path.
 */
export function parseDrift(raw: string): DriftFinding[] {
  if (!raw) return []
  const findings: DriftFinding[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('---')) continue
    const [rule, subject, severity, ...rest] = t.split('|')
    if (!rule || !subject) continue
    const sev = severity === 'critical' || severity === 'warning' ? severity : 'info'
    findings.push({ rule, subject, severity: sev, detail: rest.join('|') || '' })
  }
  return findings
}
