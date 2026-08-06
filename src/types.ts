/**
 * AppyRadar Sentinel — Domain Types
 *
 * These types define the payload shapes for each collector.
 * They are structurally compatible with AppySentinel's SignalPayload
 * (which is an empty interface marker) — no import needed until the
 * harness is wired up.
 *
 * When AppySentinel integration arrives, each payload interface will be
 * emitted as:
 *   sentinel.emit({ kind: 'state'|'metric', name: 'machine.memory', source: 'orchestrator-ssh', payload: result })
 *
 * Pattern: §6.4 of AppySentinel spec (Payload interface pattern).
 * Recipe: C2 orchestrator-ssh, I2 snapshot-store.
 */

// ─── Configuration ─────────────────────────────────────────────────────────────

export interface MachineConfig {
  name: string   // logical name ('macbook-pro', 'mac-mini-m4', etc.)
  host: string   // Tailscale hostname used for SSH
}

export interface AppEntry {
  key: string
  display: string
  path: string
  ports: { client: number | null; server: number | null }
  group: string
  tier: number
  status: string
  notes: string
}

// ─── Per-collector payloads ─────────────────────────────────────────────────────

/** kind: state | name: machine.identity */
export interface IdentityPayload {
  hostname: string
  os: string
  arch: string
  uptime: string
  user: string
  load_1m: number
  load_5m: number
}

/** kind: state | name: machine.system */
export interface SystemPayload {
  mem_raw: string
  cpu_cores: number
  ram_total_gb: number
  memory_pressure_raw: string  // output of `memory_pressure` command
}

/** kind: metric | name: machine.memory */
export interface MemoryPayload {
  used_gb: number
  free_gb: number
  total_gb: number
  use_pct: number
  /** 'ok' | 'warning' | 'critical' — from macOS `memory_pressure` command, not use_pct heuristic */
  pressure: 'ok' | 'warning' | 'critical'
}

/** kind: metric | name: machine.disk.volume — one per volume */
export interface DiskVolumePayload {
  filesystem: string
  total_gb: number
  used_gb: number
  avail_gb: number
  use_pct: number
  mount: string
  alert: 'ok' | 'warning' | 'critical'
}

/** kind: state | name: machine.tools */
export interface ToolsPayload {
  ruby: string | null
  node: string | null
  bun: string | null
  python3: string | null
  ansible: string | null
  git: string | null
  brew: string | null
  claude: string | null
  tmux: string | null
  docker: string | null
  rbenv: string | null
  ollama: string | null
  tailscale: string | null
  brew_outdated: number | null
}

/** kind: state | name: machine.app — one per registered app */
export interface AppStatusPayload {
  key: string
  display: string
  group: string
  tier: number
  registered_status: string
  path_exists: boolean
  running: boolean
  ports: {
    client?: { port: number; listening: boolean }
    server?: { port: number; listening: boolean }
  }
}

/** kind: state | name: machine.relay */
export interface RelayPayload {
  exists: boolean
  syncthing_running?: boolean
  folders?: Array<{ name: string; file_count: number; last_modified: string | null }>
}

/** kind: state | name: machine.omi */
export interface OMIPayload {
  exists: boolean
  total_files?: number
  enriched_files?: number
  pending_files?: number
  newest_file?: string | null
  oldest_file?: string | null
  monthly_breakdown?: Record<string, number>
  sample_pending?: string[]
}

/** kind: state | name: machine.skills */
export interface SkillsPayload {
  global_skills: string[]
  plugins: string[]
  commands: string[]
  claude_version: string | null
}

/** kind: state | name: machine.brains */
export interface BrainsPayload {
  exists: boolean
  total?: number
  stale_count?: number
  by_activity?: { high: number; medium: number; low: number; none: number }
  brains?: Array<{
    name: string
    status: string
    activity_level: string
    last_major_update: string
    file_count: number
  }>
}

/** kind: state | name: machine.ansible */
export interface AnsiblePayload {
  exists: boolean
  playbooks?: string[]
  roles?: string[]
  inventory_hosts?: string[]
}

/** kind: state | name: machine.angeleye */
export interface AngelEyePayload {
  installed: boolean
  running?: boolean
  total_sessions?: number
  active_sessions?: number
  sessions_24h?: number
  top_project?: string | null
  top_project_count?: number
  session_types_24h?: Record<string, number>
}

/** kind: state | name: machine.git_repo — one per repo */
export interface GitRepoPayload {
  path: string
  branch: string | null
  dirty_files: number
  unpushed_commits: number
  last_commit: string | null
  remote: string | null
}

// ─── Drift findings ─────────────────────────────────────────────────────────────

/**
 * A rule violation detected on a machine — resource drift, not a measurement.
 *
 * Every rule here was earned by a real incident during the 2026-07/08 disk
 * investigations; none are speculative. See docs/proposal-drift-detection.md.
 *
 * NOTE ON SHAPE: this is the *observation* of a violation at one point in time.
 * A finding with a lifecycle (first_seen / last_seen / resolved_at) is a
 * different thing, built by folding a series of these together. Do not add
 * timestamps here — the collector reports what is true now, and the store
 * decides whether that is new.
 */
export interface DriftFinding {
  /** Stable rule id, e.g. 'log.unrotated'. Used as the dedup key with `subject`. */
  rule: string
  /** What the rule fired on — a path, repo name, or store version. */
  subject: string
  severity: 'info' | 'warning' | 'critical'
  /** Human-readable specifics: sizes, rates, versions. */
  detail: string
}

// ─── Collection errors ──────────────────────────────────────────────────────────

/** Attached per-collector when sshScript returns empty. Distinguishes silent fail from valid empty. */
export interface CollectionError {
  collector: string
  reason: 'ssh_empty' | 'parse_error' | 'not_found'
  detail?: string
}

// ─── Machine result ─────────────────────────────────────────────────────────────

/** The full per-machine result from collectMachine(). Emitted as a single 'state' signal. */
export interface MachineSnapshot {
  machine: string
  host: string
  status: 'online' | 'offline' | 'auth_failure'
  checked_at: string
  collection_errors: CollectionError[]

  // Only present when status === 'online':
  identity?: IdentityPayload
  system?: SystemPayload
  memory?: MemoryPayload
  disk?: DiskVolumePayload[]
  tools?: ToolsPayload
  app_status?: AppStatusPayload[]
  relay?: RelayPayload
  omi?: OMIPayload
  skills?: SkillsPayload
  brains?: BrainsPayload
  ansible?: AnsiblePayload
  angeleye?: AngelEyePayload
  git_repos?: GitRepoPayload[]
  drift?: DriftFinding[]
}

// ─── Top-level snapshot (snapshot-store shape) ──────────────────────────────────

/** Written to snapshots/sentinel-latest.json by the snapshot-store pattern. */
export interface FleetSnapshot {
  schema_version: '1.3'
  generated_at: string
  summary: {
    total_machines: number
    online: number
    offline: number
    offline_machines: string[]
    apps_registered: number
  }
  machines: MachineSnapshot[]
}
